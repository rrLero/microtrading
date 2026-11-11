import { describe, expect, it } from 'vitest';
import { calibration, naiveLabel, scoreCalls } from '../src/analyst-score.js';

const D = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
// Hourly closes falling 1% per day for 40 days.
const closes = Array.from({ length: 40 * 24 }, (_, i) => ({ ts: T0 + i * 3_600_000, close: 100 * 0.99 ** (i / 24) }));

describe('analyst score', () => {
  it('scores forward returns and hits, leaving unclosed horizons undefined', () => {
    const [bear, bull, late] = scoreCalls(
      [
        { asOf: T0, label: 'bear', confidence: 0.8 },
        { asOf: T0, label: 'bull', confidence: 0.6 },
        { asOf: T0 + 35 * D, label: 'bear', confidence: 0.9 },
      ],
      closes,
    );
    expect(bear!.fwd[7]).toBeCloseTo(0.99 ** 7 - 1, 6);
    expect(bear!.hit).toBe(true);
    expect(bull!.hit).toBe(false);
    expect(late!.fwd[30]).toBeUndefined();
    expect(late!.hit).toBeUndefined();

    const cal = calibration([bear!, bull!, late!])!;
    expect(cal.n).toBe(2);
    expect(cal.hitRate).toBe(0.5);
    expect(cal.brier).toBeCloseTo((0.2 ** 2 + 0.6 ** 2) / 2, 9);
  });

  it('baseline labels the trailing 7 days, and is undefined without history', () => {
    const [first, mid] = scoreCalls(
      [{ asOf: T0, label: 'bear', confidence: 0.5 }, { asOf: T0 + 10 * D, label: 'range', confidence: 0.5 }],
      closes,
    );
    expect(first!.baselineLabel).toBeUndefined();
    expect(mid!.baselineLabel).toBe('bear'); // -6.8% over the prior week
    expect(mid!.baselineHit).toBe(true);
    expect(naiveLabel(0.01)).toBe('range');
    expect(naiveLabel(0.05)).toBe('bull');
  });
});
