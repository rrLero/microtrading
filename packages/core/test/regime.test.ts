import { describe, expect, it } from 'vitest';
import {
  DEEP_DRAWDOWN,
  MA_DAYS,
  SLOPE_LOOKBACK_DAYS,
  classifyRegimes,
  dailyCloses,
  regimeByDay,
} from '../src/regime.js';
import type { Candle } from '../src/types.js';

const MS_PER_DAY = 86_400_000;

/** Daily candles from a close series; only `close` and `timestamp` matter here. */
function series(closes: number[], startDay = 0): Candle[] {
  return closes.map((close, i) => ({
    timestamp: (startDay + i) * MS_PER_DAY,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

describe('dailyCloses', () => {
  it('takes the LAST close of each UTC day from intraday candles', () => {
    const intraday: Candle[] = [
      { timestamp: 0, open: 1, high: 1, low: 1, close: 10, volume: 1 },
      { timestamp: 3_600_000, open: 1, high: 1, low: 1, close: 11, volume: 1 },
      { timestamp: 82_800_000, open: 1, high: 1, low: 1, close: 12, volume: 1 }, // 23:00 same day
      { timestamp: MS_PER_DAY, open: 1, high: 1, low: 1, close: 20, volume: 1 },
    ];
    expect(dailyCloses(intraday)).toEqual([
      { day: 0, close: 12 },
      { day: 1, close: 20 },
    ]);
  });

  it('is order-independent', () => {
    const forward = dailyCloses(series([1, 2, 3]));
    const shuffled = dailyCloses([...series([1, 2, 3])].reverse());
    expect(shuffled).toEqual(forward);
  });
});

describe('classifyRegimes', () => {
  const WARM = MA_DAYS + SLOPE_LOOKBACK_DAYS;

  it('leaves warm-up days unclassified rather than defaulting them to a label', () => {
    const days = classifyRegimes(series(Array.from({ length: WARM + 5 }, (_, i) => 100 + i)));
    // Every day before the MA and its lookback are both available must be null.
    expect(days.slice(0, MA_DAYS + SLOPE_LOOKBACK_DAYS - 1).every((d) => d.label === null)).toBe(true);
    expect(days[days.length - 1]!.label).not.toBeNull();
  });

  it('labels a steadily rising series bull', () => {
    const days = classifyRegimes(series(Array.from({ length: WARM + 50 }, (_, i) => 100 + i)));
    expect(days[days.length - 1]!.label).toBe('bull');
    expect(days[days.length - 1]!.drawdown).toBe(0);
  });

  it('labels a deep, sustained decline bear — trend down AND drawdown past the threshold', () => {
    // Rise long enough to warm the MA and set a peak, then fall hard and long
    // enough to roll the 200-day mean over.
    const up = Array.from({ length: WARM }, (_, i) => 100 + i);
    const peak = up[up.length - 1]!;
    const down = Array.from({ length: 260 }, (_, i) => peak * (1 - 0.6 * ((i + 1) / 260)));
    const days = classifyRegimes(series([...up, ...down]));
    const last = days[days.length - 1]!;
    expect(last.drawdown).toBeGreaterThan(DEEP_DRAWDOWN);
    expect(last.label).toBe('bear');
  });

  it('separates the two axes: falling trend but shallow drawdown is topping, not bear', () => {
    // A FLAT base, not a ramp: with a rising ramp the 200-day mean keeps
    // climbing for months purely from the old low values leaving the window,
    // which would swamp a shallow decline and make this case untestable.
    const flat = Array.from({ length: WARM }, () => 100);
    // Drift down by only 5%: MA slope turns negative while the drawdown stays
    // well inside the threshold.
    const drift = Array.from({ length: 150 }, (_, i) => 100 * (1 - 0.05 * ((i + 1) / 150)));
    const days = classifyRegimes(series([...flat, ...drift]));
    const last = days[days.length - 1]!;
    expect(last.drawdown).toBeLessThan(DEEP_DRAWDOWN);
    expect(last.label).toBe('topping');
  });

  it('drawdown is measured from the running peak, never from the series start', () => {
    const days = classifyRegimes(series([100, 200, 150]));
    expect(days[2]!.drawdown).toBeCloseTo(0.25, 10); // 150 off a 200 peak
  });
});

describe('regimeByDay', () => {
  it('omits unclassifiable days so callers cannot silently bucket them', () => {
    const n = MA_DAYS + SLOPE_LOOKBACK_DAYS + 10;
    const map = regimeByDay(series(Array.from({ length: n }, (_, i) => 100 + i)));
    expect(map.size).toBeLessThan(n);
    expect(map.has(0)).toBe(false);
    expect(map.has(n - 1)).toBe(true);
  });
});
