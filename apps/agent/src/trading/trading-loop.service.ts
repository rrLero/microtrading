import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  TIMEFRAME_MS,
  aggregate1hTo4h,
  atr,
  computeEntryPlan,
  volCircuitBreakerActive,
  type Candle,
  type Strategy,
} from '@microtrading/core';
import { CandleRepository } from '../market-data/candle-repository.js';
import { IngestionService } from '../market-data/ingestion.service.js';
import { FACTORIES, btFor, type StrategyFamily } from '../experiments/experiment.service.js';
import { PaperBrokerService, type PaperCosts, type PaperState } from './paper-broker.service.js';

/**
 * The hourly paper-trading loop (SPEC Phase 2/3) with CATCH-UP REPLAY:
 * every closed candle since lastProcessedTs is processed in order with
 * backtester-identical semantics — a pending signal from candle t fills at
 * candle t+1's open; stops are checked against every candle (so downtime can
 * never skip a stop that "should" have fired); equity is journaled per candle.
 * Only the newest candle's signal executes at its close (≈ the forming
 * candle's open — the live approximation). Fail-closed on stale data.
 */
@Injectable()
export class TradingLoopService {
  private readonly log = new Logger(TradingLoopService.name);
  private running = false;
  /** Journal-spam guard for very long gaps; older candles beyond this are skipped with an ops note. */
  private static readonly MAX_REPLAY = 500;

  constructor(
    private readonly config: ConfigService,
    private readonly repo: CandleRepository,
    private readonly ingestion: IngestionService,
    private readonly broker: PaperBrokerService,
  ) {}

  private strategy(): Strategy {
    const family = this.config.get<StrategyFamily>('STRATEGY_FAMILY', 'donchian-breakout');
    const params = JSON.parse(
      this.config.get<string>('STRATEGY_PARAMS', '{"entryLookback":40,"exitLookback":10}'),
    ) as Record<string, number>;
    return FACTORIES[family](params);
  }

  // Minute 2 of every hour: candle closed at :00, small buffer for the venue.
  @Cron('2 * * * *')
  async tick(): Promise<void> {
    if (this.config.get('ENABLE_TRADING_LOOP') !== 'true') return;
    if (this.running) {
      this.log.warn('Previous tick still running — skipping.');
      return;
    }
    this.running = true;
    try {
      await this.runOnce();
    } catch (err) {
      this.log.error(`Tick failed (fail-closed: no orders this cycle): ${String(err)}`);
      await this.broker.journalEvent('ops', { event: 'tick-error', error: String(err) });
    } finally {
      this.running = false;
    }
  }

  async runOnce(): Promise<void> {
    const symbol = this.config.get<string>('SYMBOL', 'BTC/USDC');
    const family = this.config.get<StrategyFamily>('STRATEGY_FAMILY', 'donchian-breakout');
    const bt = btFor(family);
    const costs: PaperCosts = bt.costs;

    // 1) Top up candles via REST; fail-closed on stale data (SPEC §8)
    await this.ingestion.backfill(symbol, new Date(Date.now() - 7 * 86_400_000).toISOString());
    const now = Date.now();
    const lookbackCandles = 2000;
    const since = now - lookbackCandles * TIMEFRAME_MS['1h'];
    const candles1h = (await this.repo.fetchSince(symbol, '1h', since)).filter(
      (c) => c.timestamp + TIMEFRAME_MS['1h'] <= now, // closed only (SPEC §3.1)
    );
    const newest = candles1h[candles1h.length - 1];
    if (!newest || now - (newest.timestamp + TIMEFRAME_MS['1h']) > 15 * 60_000) {
      this.log.error('STALE DATA: newest closed candle too old — no orders this cycle (fail-closed).');
      await this.broker.journalEvent('ops', { event: 'stale-data-halt', lastCandleTs: newest?.timestamp ?? null });
      return;
    }

    // 2) Account state + kill switch
    let state = await this.broker.getOrCreate(symbol, Number(this.config.get('PAPER_INITIAL_CASH', '10000')));
    if (state.killSwitch) {
      if (state.positionQty > 0) state = await this.broker.sell(symbol, state, newest.close, costs, 'kill-switch flatten');
      this.log.warn('Kill switch is ON — flat and halted.');
      return;
    }

    // 3) Determine which candles still need processing (catch-up replay)
    let startIdx = state.lastProcessedTs === null
      ? candles1h.length - 1 // first ever tick: process only the newest candle
      : candles1h.findIndex((c) => c.timestamp > state.lastProcessedTs!);
    if (startIdx === -1) startIdx = candles1h.length; // nothing new
    const missed = candles1h.length - startIdx;
    if (missed <= 0) {
      this.log.log('No new closed candles since last tick.');
      return;
    }
    if (missed > 1) {
      this.log.warn(`Catch-up: replaying ${missed} missed candle(s) since ${new Date(state.lastProcessedTs ?? 0).toISOString()}.`);
      await this.broker.journalEvent('ops', { event: 'catch-up', missed, from: candles1h[startIdx]!.timestamp, to: newest.timestamp });
    }
    if (missed > TradingLoopService.MAX_REPLAY) {
      await this.broker.journalEvent('ops', {
        event: 'catch-up-truncated',
        skipped: missed - TradingLoopService.MAX_REPLAY,
        note: 'gap exceeded MAX_REPLAY; oldest candles processed without journal-per-candle fidelity',
      });
      startIdx = candles1h.length - TradingLoopService.MAX_REPLAY;
    }

    // 4) Shared context: derived 4h + ATR over the full window
    const all4h = aggregate1hTo4h(candles1h);
    const atrSeries = atr(candles1h, bt.atrPeriod);
    const strategy = this.strategy();

    // 5) Process each candle in order — same sequence as the backtest engine:
    //    (a) execute pending signal at THIS candle's open, (b) stop check within
    //    this candle, (c) decide on this closed candle → pending for the next.
    let pendingEnter = false;
    let pendingExit = false;

    for (let i = startIdx; i < candles1h.length; i++) {
      const candle = candles1h[i]!;
      const isNewest = i === candles1h.length - 1;

      // (a) execute pending signal from the previous candle at this open
      if (pendingExit && state.positionQty > 0) {
        state = await this.broker.sell(symbol, state, candle.open, costs, 'signal (replayed at next open)', candle.timestamp);
      } else if (pendingEnter && state.positionQty === 0) {
        state = await this.tryEnter(symbol, state, candles1h, atrSeries, i, candle.open, bt, costs, candle.timestamp);
      }
      pendingEnter = false;
      pendingExit = false;

      // day roll (UTC) at this candle
      const utcDay = new Date(candle.timestamp).toISOString().slice(0, 10);
      state = await this.broker.rollDay(symbol, state, candle.open, utcDay);

      // (b) stop simulation within this candle — pessimistic (gap → open)
      state = await this.broker.checkStop(symbol, state, candle, costs);

      // equity point for this candle
      await this.broker.journalEvent('equity', {
        ts: candle.timestamp,
        equity: this.broker.equity(state, candle.close),
        price: candle.close,
        positionQty: state.positionQty,
      });

      // (c) strategy decision on this CLOSED candle
      if (i + 1 < strategy.warmupCandles) continue;
      const decisionTime = candle.timestamp + TIMEFRAME_MS['1h'];
      const closed4h = all4h.filter((c) => c.timestamp + TIMEFRAME_MS['4h'] <= decisionTime);
      const position =
        state.positionQty > 0
          ? { symbol, quantity: state.positionQty, avgEntryPrice: state.avgEntryPrice, stopOrderId: 'paper-stop', openedAt: state.openedAt ?? 0 }
          : null;
      const signal = strategy.onCandle({ symbol, candles1h: candles1h.slice(0, i + 1), candles4h: closed4h, position });
      await this.broker.journalEvent('decision', {
        strategy: strategy.id,
        candleTs: candle.timestamp,
        close: candle.close,
        signal,
        replayed: !isNewest,
        position: position ? { qty: position.quantity, entry: position.avgEntryPrice, stop: state.stopPrice } : null,
      });

      if (signal.kind === 'exit' && state.positionQty > 0) {
        if (isNewest) {
          state = await this.broker.sell(symbol, state, candle.close, costs, `signal: ${signal.reason}`, candle.timestamp);
        } else {
          pendingExit = true; // fills at the NEXT candle's open — backtest-identical
        }
      } else if (signal.kind === 'enter-long' && state.positionQty === 0) {
        if (isNewest) {
          state = await this.tryEnter(symbol, state, candles1h, atrSeries, i, candle.close, bt, costs, candle.timestamp);
        } else {
          pendingEnter = true;
        }
      }
    }

    await this.broker.setLastProcessedTs(symbol, newest.timestamp);
  }

  /** Entry with full risk enforcement (SPEC §5) at a given reference price. */
  private async tryEnter(
    symbol: string,
    state: PaperState,
    candles1h: readonly Candle[],
    atrSeries: readonly number[],
    fillIndex: number,
    refPrice: number,
    bt: ReturnType<typeof btFor>,
    costs: PaperCosts,
    ts: number,
  ): Promise<PaperState> {
    const equity = this.broker.equity(state, refPrice);
    if (state.dayStartEquity !== null && equity <= state.dayStartEquity * (1 - bt.risk.dailyLossCutoffPct / 100)) {
      await this.broker.journalEvent('risk', { event: 'daily-cutoff-block', equity, dayStartEquity: state.dayStartEquity, candleTs: ts });
      return state;
    }
    if (volCircuitBreakerActive(candles1h, atrSeries, fillIndex, bt.risk.volCircuitBreakerPercentile)) {
      await this.broker.journalEvent('risk', { event: 'vol-circuit-breaker-block', candleTs: ts });
      return state;
    }
    // ATR as of the decision candle (one before the fill candle) — no look-ahead
    const atrVal = atrSeries[Math.max(0, fillIndex - 1)];
    const plan = computeEntryPlan(equity, refPrice, atrVal ?? NaN, bt.risk);
    if (!plan) {
      await this.broker.journalEvent('risk', { event: 'entry-plan-null', candleTs: ts });
      return state;
    }
    return this.broker.buy(symbol, state, refPrice, plan.quantity, plan.stopPrice, costs, 'donchian entry', ts);
  }
}
