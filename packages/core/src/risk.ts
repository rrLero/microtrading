import type { Candle } from './types.js';

/**
 * Risk engine parameters (SPEC §5). Used identically by the backtester and
 * (later) the live paper loop — one code path.
 */
export interface RiskParams {
  /** Max % of equity lost if the stop fills exactly at the stop price. */
  readonly riskPerTradePct: number;
  /** Stop distance in ATR multiples (SPEC §5.1: current realized volatility only). */
  readonly atrStopMultiple: number;
  /** Hard notional cap as % of equity — the gap-risk backstop (SPEC §5.1). */
  readonly maxNotionalPct: number;
  /** Halt new entries for the UTC day after this % equity loss (SPEC §5.3). */
  readonly dailyLossCutoffPct: number;
  /** No new entries when ATR% exceeds this percentile of its trailing year (SPEC §5.1). */
  readonly volCircuitBreakerPercentile: number;
}

export const DEFAULT_RISK: RiskParams = {
  riskPerTradePct: 1,
  atrStopMultiple: 2,
  maxNotionalPct: 10,
  dailyLossCutoffPct: 3,
  volCircuitBreakerPercentile: 95,
};

export interface EntryPlan {
  readonly quantity: number;
  readonly stopPrice: number;
}

/**
 * Volatility-aware position sizing (SPEC §5.1).
 * Returns null when no valid position exists (zero/NaN ATR, degenerate price).
 */
export function computeEntryPlan(
  equity: number,
  entryPrice: number,
  atrValue: number,
  p: RiskParams,
): EntryPlan | null {
  if (!Number.isFinite(atrValue) || atrValue <= 0 || entryPrice <= 0 || equity <= 0) return null;
  const stopDistance = p.atrStopMultiple * atrValue;
  if (stopDistance >= entryPrice) return null; // stop below zero — market too wild to size
  const stopPrice = entryPrice - stopDistance;

  const riskQty = (equity * p.riskPerTradePct) / 100 / stopDistance;
  const capQty = (equity * p.maxNotionalPct) / 100 / entryPrice;
  const quantity = Math.min(riskQty, capQty);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return { quantity, stopPrice };
}

/**
 * Volatility circuit breaker (SPEC §5.1): true → no new entries.
 * Compares current ATR% (ATR/close) against its percentile over the trailing window.
 */
export function volCircuitBreakerActive(
  candles: readonly Candle[],
  atrSeries: readonly number[],
  index: number,
  percentile: number,
  lookback = 24 * 365,
): boolean {
  const cur = atrSeries[index];
  const close = candles[index]?.close;
  if (cur === undefined || !Number.isFinite(cur) || close === undefined) return false;
  const curPct = cur / close;

  const from = Math.max(0, index - lookback);
  const history: number[] = [];
  for (let i = from; i < index; i++) {
    const a = atrSeries[i];
    const c = candles[i]?.close;
    if (a !== undefined && Number.isFinite(a) && c !== undefined) history.push(a / c);
  }
  if (history.length < 100) return false; // not enough history to judge — don't block
  history.sort((a, b) => a - b);
  const cutoff = history[Math.min(history.length - 1, Math.floor((percentile / 100) * history.length))]!;
  return curPct > cutoff;
}
