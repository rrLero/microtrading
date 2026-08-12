import { TIMEFRAME_MS, type Candle, type Strategy } from '../types.js';
import { aggregate1hTo4h } from '../candles.js';
import { atr } from '../indicators/indicators.js';
import { computeEntryPlan, volCircuitBreakerActive, type RiskParams } from '../risk.js';
import { modelFill, type CostParams } from '../fill-model.js';

export type { CostParams };

/**
 * Candle-replay backtest engine (SPEC §6, §7).
 * Timing semantics — identical to the live loop (SPEC §3):
 *  - decisions only on closed candles;
 *  - signal at close of candle t → fill at the OPEN of candle t+1 ± slippage;
 *  - the 4h context contains only 4h candles fully closed at decision time;
 *  - stops are pessimistic: gap through the stop fills at the candle's open.
 * Pessimistic mode (taker-only) is the ONLY mode this engine implements —
 * go/no-go decisions must never rest on optimistic fills (SPEC §6.2).
 */

export interface BacktestConfig {
  readonly initialEquity: number;
  readonly costs: CostParams;
  readonly risk: RiskParams;
  readonly atrPeriod: number;
}

export interface Trade {
  readonly entryTs: number;
  readonly entryPrice: number;
  readonly exitTs: number;
  readonly exitPrice: number;
  readonly quantity: number;
  readonly fees: number;
  readonly pnl: number; // net of fees
  readonly exitReason: 'stop' | 'signal' | 'end-of-data';
}

export interface EquityPoint {
  readonly ts: number;
  readonly equity: number;
}

export interface BacktestResult {
  readonly trades: readonly Trade[];
  readonly equityCurve: readonly EquityPoint[];
  readonly finalEquity: number;
  readonly candlesProcessed: number;
  readonly entriesBlockedByCircuitBreaker: number;
  readonly entriesBlockedByDailyCutoff: number;
}

interface OpenPosition {
  entryTs: number;
  entryPrice: number;
  quantity: number;
  stopPrice: number;
  entryFee: number;
}

export function runBacktest(candles1h: readonly Candle[], strategy: Strategy, cfg: BacktestConfig): BacktestResult {
  const H = TIMEFRAME_MS['1h'];
  const all4h = aggregate1hTo4h(candles1h);
  const atrSeries = atr(candles1h, cfg.atrPeriod);

  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];
  let cash = cfg.initialEquity;
  let position: OpenPosition | null = null;
  let pendingSignal: 'enter-long' | 'exit' | null = null;
  let blockedCb = 0;
  let blockedDaily = 0;

  let dayStartEquity = cfg.initialEquity;
  let currentDay = -1;
  let idx4h = 0; // count of 4h candles closed as of decision time

  const markEquity = (price: number): number => cash + (position ? position.quantity * price : 0);

  const closePosition = (pos: OpenPosition, ts: number, rawPrice: number, reason: Trade['exitReason']): void => {
    const { fillPrice, notional: proceeds, fee: exitFee } = modelFill('sell', rawPrice, pos.quantity, cfg.costs);
    cash += proceeds - exitFee;
    const fees = pos.entryFee + exitFee;
    trades.push({
      entryTs: pos.entryTs,
      entryPrice: pos.entryPrice,
      exitTs: ts,
      exitPrice: fillPrice,
      quantity: pos.quantity,
      fees,
      pnl: proceeds - exitFee - pos.quantity * pos.entryPrice - pos.entryFee,
      exitReason: reason,
    });
  };

  for (let i = 0; i < candles1h.length; i++) {
    const candle = candles1h[i]!;

    // ---- UTC day roll: reset the daily-cutoff baseline
    const day = Math.floor(candle.timestamp / 86_400_000);
    if (day !== currentDay) {
      currentDay = day;
      dayStartEquity = markEquity(candle.open);
    }

    // ---- 1) Execute pending signal from candle t-1 at THIS candle's open
    if (pendingSignal === 'exit' && position) {
      closePosition(position, candle.timestamp, candle.open, 'signal');
      position = null;
    } else if (pendingSignal === 'enter-long' && !position) {
      const equity = markEquity(candle.open);
      const dailyLossHit = equity <= dayStartEquity * (1 - cfg.risk.dailyLossCutoffPct / 100);
      const cbActive = volCircuitBreakerActive(candles1h, atrSeries, i, cfg.risk.volCircuitBreakerPercentile);
      if (dailyLossHit) blockedDaily++;
      else if (cbActive) blockedCb++;
      else {
        const atrVal = atrSeries[i - 1]; // ATR as of the decision candle — no look-ahead
        const plan = atrVal !== undefined ? computeEntryPlan(equity, candle.open, atrVal, cfg.risk) : null;
        if (plan) {
          const { fillPrice, notional: cost, fee } = modelFill('buy', candle.open, plan.quantity, cfg.costs);
          if (cost + fee <= cash) {
            cash -= cost + fee;
            position = {
              entryTs: candle.timestamp,
              entryPrice: fillPrice,
              quantity: plan.quantity,
              stopPrice: plan.stopPrice,
              entryFee: fee,
            };
          }
        }
      }
    }
    pendingSignal = null;

    // ---- 2) Stop check WITHIN this candle (pessimistic: gap fills at open)
    if (position && candle.low <= position.stopPrice) {
      const rawFill = Math.min(position.stopPrice, candle.open);
      closePosition(position, candle.timestamp, rawFill, 'stop');
      position = null;
    }

    // ---- 3) Advance the closed-4h pointer (4h candle closed iff end <= 1h close time)
    const decisionTime = candle.timestamp + H;
    while (idx4h < all4h.length && all4h[idx4h]!.timestamp + TIMEFRAME_MS['4h'] <= decisionTime) idx4h++;

    // ---- 4) Strategy decides on the CLOSED candle t → executes next candle
    if (i + 1 >= strategy.warmupCandles) {
      const signal = strategy.onCandle({
        symbol: 'BACKTEST',
        candles1h: candles1h.slice(0, i + 1),
        candles4h: all4h.slice(0, idx4h),
        position: position
          ? {
              symbol: 'BACKTEST',
              quantity: position.quantity,
              avgEntryPrice: position.entryPrice,
              stopOrderId: 'stop',
              openedAt: position.entryTs,
            }
          : null,
      });
      if (signal.kind === 'enter-long' && !position) pendingSignal = 'enter-long';
      else if (signal.kind === 'exit' && position) pendingSignal = 'exit';
    }

    equityCurve.push({ ts: candle.timestamp, equity: markEquity(candle.close) });
  }

  // ---- Liquidate at the end so open PnL is realized in the stats
  const last = candles1h[candles1h.length - 1];
  if (position && last) {
    closePosition(position, last.timestamp, last.close, 'end-of-data');
    position = null;
  }

  return {
    trades,
    equityCurve,
    finalEquity: cash,
    candlesProcessed: candles1h.length,
    entriesBlockedByCircuitBreaker: blockedCb,
    entriesBlockedByDailyCutoff: blockedDaily,
  };
}
