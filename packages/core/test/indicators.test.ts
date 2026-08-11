import { describe, expect, it } from 'vitest';
import { atr, rsi, sma } from '../src/indicators/indicators.js';
import { aggregate1hTo4h, alignToTimeframe, validateSeries } from '../src/candles.js';
import type { Candle } from '../src/types.js';

const H = 3_600_000;

function candle(i: number, o: number, h: number, l: number, c: number, v = 1): Candle {
  return { timestamp: i * H, open: o, high: h, low: l, close: c, volume: v };
}

describe('sma', () => {
  it('computes the rolling mean and NaN-pads warmup', () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
    expect(out[2]).toBeCloseTo(2);
    expect(out[3]).toBeCloseTo(3);
    expect(out[4]).toBeCloseTo(4);
  });

  it('rejects invalid periods', () => {
    expect(() => sma([1], 0)).toThrow(RangeError);
  });
});

describe('rsi (Wilder)', () => {
  it('matches the canonical all-gains / all-losses extremes', () => {
    const up = rsi([1, 2, 3, 4, 5, 6, 7], 3);
    expect(up[3]).toBeCloseTo(100);
    const down = rsi([7, 6, 5, 4, 3, 2, 1], 3);
    expect(down[3]).toBeCloseTo(0);
  });

  it('oscillates symmetrically around 50 for a perfectly alternating series', () => {
    const closes = [10, 11, 10, 11, 10, 11, 10, 11, 10, 11];
    const out = rsi(closes, 4);
    // initial window has equal gains and losses → exactly 50
    expect(out[4]).toBeCloseTo(50);
    // Wilder smoothing then oscillates: consecutive values straddle 50, bounded
    const a = out[out.length - 2]!;
    const b = out[out.length - 1]!;
    expect(Math.min(a, b)).toBeLessThan(50);
    expect(Math.max(a, b)).toBeGreaterThan(50);
    expect(Math.abs(a - 50)).toBeLessThan(15);
    expect(Math.abs(b - 50)).toBeLessThan(15);
  });

  it('NaN-pads until index `period`', () => {
    const out = rsi([1, 2, 3, 4, 5], 3);
    expect(out[2]).toBeNaN();
    expect(out[3]).not.toBeNaN();
  });
});

describe('atr (Wilder)', () => {
  it('equals the constant range for constant-range candles', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) candles.push(candle(i, 100, 102, 98, 100));
    const out = atr(candles, 5);
    expect(out[4]).toBeNaN();
    expect(out[5]).toBeCloseTo(4);
    expect(out[9]).toBeCloseTo(4);
  });

  it('uses true range across gaps (prev close)', () => {
    const candles: Candle[] = [
      candle(0, 100, 101, 99, 100),
      candle(1, 120, 121, 119, 120), // gap up: TR = high - prevClose = 21
    ];
    const out = atr(candles, 1);
    expect(out[1]).toBeCloseTo(21);
  });
});

describe('candle utilities', () => {
  it('aligns timestamps to timeframe boundaries', () => {
    expect(alignToTimeframe(3 * H + 123, '1h')).toBe(3 * H);
    expect(alignToTimeframe(7 * H, '4h')).toBe(4 * H);
  });

  it('aggregates exactly four 1h candles into one closed 4h candle and drops partial buckets', () => {
    const oneH = [
      candle(0, 10, 15, 9, 12),
      candle(1, 12, 13, 11, 11),
      candle(2, 11, 18, 10, 17),
      candle(3, 17, 19, 16, 18),
      candle(4, 18, 20, 17, 19), // partial next bucket → must be dropped
    ];
    const fourH = aggregate1hTo4h(oneH);
    expect(fourH).toHaveLength(1);
    expect(fourH[0]).toEqual({ timestamp: 0, open: 10, high: 19, low: 9, close: 18, volume: 4 });
  });

  it('validateSeries flags gaps, misalignment, and bad OHLC', () => {
    const ok = [candle(0, 1, 2, 0.5, 1.5), candle(1, 1.5, 2, 1, 1.8)];
    expect(validateSeries(ok, '1h')).toHaveLength(0);

    const gappy = [candle(0, 1, 2, 0.5, 1.5), candle(2, 1.5, 2, 1, 1.8)];
    expect(validateSeries(gappy, '1h').some((p) => p.includes('gap'))).toBe(true);

    const badOhlc = [candle(0, 1, 0.9, 0.5, 1.5)]; // high < open
    expect(validateSeries(badOhlc, '1h').some((p) => p.includes('OHLC'))).toBe(true);
  });
});
