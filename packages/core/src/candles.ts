import { TIMEFRAME_MS, type Candle, type Timeframe } from './types.js';

/** Floor a UTC epoch-ms timestamp to its timeframe boundary. */
export function alignToTimeframe(ts: number, tf: Timeframe): number {
  const step = TIMEFRAME_MS[tf];
  return Math.floor(ts / step) * step;
}

/** True if the candle opening at `openTs` is fully closed as of `now`. */
export function isClosed(openTs: number, tf: Timeframe, now: number): boolean {
  return openTs + TIMEFRAME_MS[tf] <= now;
}

/**
 * Aggregate closed 1h candles into closed 4h candles.
 * Only emits a 4h candle when all four constituent hours are present —
 * a partial bucket is a forming candle and is dropped (SPEC §3.3).
 */
export function aggregate1hTo4h(candles1h: readonly Candle[]): Candle[] {
  const buckets = new Map<number, Candle[]>();
  for (const c of candles1h) {
    const key = alignToTimeframe(c.timestamp, '4h');
    const arr = buckets.get(key);
    if (arr) arr.push(c);
    else buckets.set(key, [c]);
  }
  const out: Candle[] = [];
  for (const [key, group] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    if (group.length !== 4) continue; // partial bucket → forming or gappy, drop it
    group.sort((a, b) => a.timestamp - b.timestamp);
    out.push({
      timestamp: key,
      open: group[0]!.open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[3]!.close,
      volume: group.reduce((s, c) => s + c.volume, 0),
    });
  }
  return out;
}

/**
 * Validate a candle series: strictly increasing, boundary-aligned timestamps,
 * sane OHLC relationships. Returns human-readable problems (empty = ok).
 * Data bugs found here are cheaper than data bugs found in a backtest report.
 */
export function validateSeries(candles: readonly Candle[], tf: Timeframe): string[] {
  const problems: string[] = [];
  const step = TIMEFRAME_MS[tf];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (c.timestamp % step !== 0) {
      problems.push(`candle[${i}] timestamp ${c.timestamp} not aligned to ${tf}`);
    }
    if (c.high < c.low || c.high < c.open || c.high < c.close || c.low > c.open || c.low > c.close) {
      problems.push(`candle[${i}] OHLC inconsistent at ${c.timestamp}`);
    }
    if (i > 0) {
      const gap = c.timestamp - candles[i - 1]!.timestamp;
      if (gap <= 0) problems.push(`candle[${i}] not strictly increasing at ${c.timestamp}`);
      else if (gap !== step) problems.push(`gap of ${gap / step} ${tf} candles before ${c.timestamp}`);
    }
  }
  return problems;
}
