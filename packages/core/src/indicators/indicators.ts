import type { Candle } from '../types.js';

/**
 * Hand-written indicators (SPEC stack decision: no indicator library).
 * All functions are pure. Input arrays are oldest → newest.
 * Return arrays are aligned with the input: index i is the indicator value
 * at candle i, or NaN while the indicator is still warming up.
 */

/** Simple Moving Average of closes over `period` candles. */
export function sma(closes: readonly number[], period: number): number[] {
  if (period < 1) throw new RangeError(`sma period must be >= 1, got ${period}`);
  const out = new Array<number>(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i]!;
    if (i >= period) sum -= closes[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Relative Strength Index (Wilder's smoothing), the classic 0–100 oscillator.
 * First value appears at index `period` (needs `period` deltas).
 */
export function rsi(closes: readonly number[], period: number): number[] {
  if (period < 1) throw new RangeError(`rsi period must be >= 1, got ${period}`);
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gainSum += d;
    else lossSum -= d;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = toRsi(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

function toRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Average True Range (Wilder's smoothing) — current realized volatility.
 * This is the ONLY volatility measure allowed in risk sizing (SPEC §5.1;
 * sqrt-time scaling is forbidden there, SPEC §2.3).
 * First value appears at index `period` (TR needs a previous close).
 */
export function atr(candles: readonly Candle[], period: number): number[] {
  if (period < 1) throw new RangeError(`atr period must be >= 1, got ${period}`);
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length <= period) return out;

  const tr = (i: number): number => {
    const c = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
  };

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr(i);
  let value = sum / period;
  out[period] = value;

  for (let i = period + 1; i < candles.length; i++) {
    value = (value * (period - 1) + tr(i)) / period;
    out[i] = value;
  }
  return out;
}
