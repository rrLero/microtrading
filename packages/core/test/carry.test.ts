import { describe, expect, it } from 'vitest';
import {
  CARRY_COSTS, assertHoldoutUnspent, carryMetrics, carryVerdict, joinBars, pickDevBest, runCarry, trailingApr,
  type CarryBar, type CarryMetrics, type CarryRun, type FundingPrint,
} from '../src/carry.js';
import type { Candle } from '../src/types.js';

const H = 3_600_000;
const T0 = Date.UTC(2023, 0, 1);
const C = 10_000;
const ROUND_TRIP_COST = 2 * (C / 2) * (0.001 + 0.0003) + 2 * (C / 2) * (0.00055 + 0.0003); // 21.5

/** n hourly bars; price(i) gives the open and close of bar i on both legs. */
const bars = (n: number, price: (i: number) => number = () => 100): CarryBar[] =>
  Array.from({ length: n }, (_, i) => ({
    ts: T0 + i * H, spotOpen: price(i), spotClose: price(i + 1), perpOpen: price(i), perpClose: price(i + 1),
  }));
const prints = (rates: number[]): FundingPrint[] => rates.map((rate, i) => ({ ts: T0 + (i + 1) * 8 * H, rate }));
const run = (b: CarryBar[], f: FundingPrint[], k = 0, enterApr = 0, exitApr = 0) =>
  runCarry(b, f, { k, enterApr, exitApr }, CARRY_COSTS, C, T0, T0 + b.length * H);

describe('runCarry', () => {
  it('carry pays the short on positive funding and charges it on negative', () => {
    const qty = C / 2 / (100 * 1.0003);
    expect(run(bars(30), prints([0.001, 0.001, 0.001])).fundingEarned).toBeCloseTo(3 * 0.001 * qty * 100, 6);
    expect(run(bars(54), prints([0.001, 0.001, 0.001, -0.001, -0.001, -0.001])).fundingEarned).toBeCloseTo(0, 6);
    expect(run(bars(30), prints([-0.001])).fundingEarned).toBeLessThan(0);
  });

  it('enters above enterApr and exits below exitApr', () => {
    const r = run(bars(32), prints([0.2 / 1095, 0.2 / 1095, -0.1 / 1095]), 1, 0.1, 0);
    expect(r.roundTrips).toBe(1);
    expect(r.barsInMarket).toBe(16); // bars 8..23: in at 08:00 open, out at 24:00 open
  });

  it('charges both legs fees and slippage on a round trip', () => {
    const r = run(bars(10), []);
    expect(C - r.finalEquity).toBeCloseTo(ROUND_TRIP_COST, 0);
    expect(r.costsPaid).toBeCloseTo(ROUND_TRIP_COST, 0);
  });

  it('closes an open position at the window end with exit costs', () => {
    const r = run(bars(10), []);
    expect(r.roundTrips).toBe(1);
    expect(r.equity.at(-1)!.equity).toBeCloseTo(r.finalEquity, 6);
  });

  it('is price-neutral when BTC doubles', () => {
    const r = run(bars(100, (i) => 100 + i), []);
    expect(C - r.finalEquity).toBeGreaterThan(0);
    expect(C - r.finalEquity).toBeLessThan(3 * ROUND_TRIP_COST); // one trip + one rebalance at higher notional
  });

  it('rebalances when perp rises 50% above entry', () => {
    expect(run(bars(100, (i) => 100 + i), []).rebalances).toBe(1);
    expect(run(bars(40, (i) => 100 + i), []).rebalances).toBe(0);
  });
});

describe('trailingApr', () => {
  it('signal ignores prints after the decision time', () => {
    const f = prints([0.0001, 0.0002, 0.0003]);
    const S = f[2]!.ts;
    expect(trailingApr([...f, { ts: S + 1, rate: 9 }], S, 3)).toBe(trailingApr(f, S, 3));
    expect(trailingApr(f, S, 3)).toBeCloseTo(0.0002 * 1095, 9);
    expect(trailingApr(f, S, 4)).toBeNull();
  });
});

describe('joinBars', () => {
  it('skips bars missing either leg and counts them', () => {
    const c = (ts: number): Candle => ({ timestamp: ts, open: 1, high: 1, low: 1, close: 1, volume: 0 });
    const { bars: b, skipped } = joinBars([c(T0), c(T0 + 2 * H)], [c(T0), c(T0 + H), c(T0 + 2 * H)]);
    expect(skipped).toBe(1);
    expect(b.map((x) => x.ts)).toEqual([T0, T0 + 2 * H]);
  });
});

const DAY = 86_400_000;
const fakeRun = (points: [number, number][]): CarryRun => ({
  equity: points.map(([ts, equity]) => ({ ts, equity })), finalEquity: points.at(-1)![1],
  roundTrips: 1, rebalances: 0, fundingEarned: 0, costsPaid: 0, barsInMarket: points.length,
});
const metric = (over: Partial<CarryMetrics>): CarryMetrics => ({
  netApr: 0.05, maxDrawdownPct: 0.01, worst30dReturn: 0, bestMonth: '2025-09', bestMonthShare: 0.2, byYear: [],
  timeInMarket: 1, fundingEarned: 0, costsPaid: 0, roundTrips: 1, rebalances: 0, days: 365, ...over,
});

describe('carryMetrics', () => {
  it('netApr annualises simple return over the run days', () => {
    const m = carryMetrics(fakeRun([[T0, 10_000], [T0 + 365.25 * DAY, 10_400]]), 10_000);
    expect(m.netApr).toBeCloseTo(0.04, 9);
  });

  it('max drawdown is peak-to-trough on marked equity', () => {
    const m = carryMetrics(fakeRun([[T0, 100], [T0 + DAY, 110], [T0 + 2 * DAY, 99], [T0 + 3 * DAY, 120]]), 100);
    expect(m.maxDrawdownPct).toBeCloseTo(0.1, 9);
  });

  it('best-month share is NaN when net is not positive', () => {
    expect(carryMetrics(fakeRun([[T0, 100], [T0 + 40 * DAY, 99]]), 100).bestMonthShare).toBeNaN();
  });

  it('best-month share is the best month over total net', () => {
    // Jan +10, Feb +30 → Feb carries 75%
    const m = carryMetrics(fakeRun([[T0, 100], [T0 + 10 * DAY, 110], [T0 + 40 * DAY, 140]]), 100);
    expect(m.bestMonth).toBe('2023-02');
    expect(m.bestMonthShare).toBeCloseTo(0.75, 9);
  });
});

describe('carryVerdict', () => {
  it('verdict fails at exactly 4% APR and passes above it', () => {
    expect(carryVerdict(metric({ netApr: 0.04 }), null).pass).toBe(false);
    expect(carryVerdict(metric({ netApr: 0.0401 }), null).pass).toBe(true);
  });

  it('verdict marks the C1 comparison not applicable when c1 is null', () => {
    const c = carryVerdict(metric({}), null).criteria.find((x) => x.name === 'beats C1')!;
    expect(c.pass).toBe(true);
    expect(c.detail).toContain('n/a');
    expect(carryVerdict(metric({ netApr: 0.05 }), metric({ netApr: 0.06 })).pass).toBe(false);
  });

  it('fails on concentration and on drawdown', () => {
    expect(carryVerdict(metric({ bestMonthShare: 0.5 }), null).pass).toBe(false);
    expect(carryVerdict(metric({ maxDrawdownPct: 0.05 }), null).pass).toBe(false);
  });
});

describe('pickDevBest', () => {
  it('pickDevBest breaks ties toward the lower index', () => {
    const p = { k: 0, enterApr: 0, exitApr: 0 };
    expect(pickDevBest([{ params: p, m: metric({ netApr: 0.1 }) }, { params: p, m: metric({ netApr: 0.1 }) }])).toBe(0);
    expect(pickDevBest([{ params: p, m: metric({ netApr: 0.1 }) }, { params: p, m: metric({ netApr: 0.2 }) }])).toBe(1);
  });
});

describe('assertHoldoutUnspent', () => {
  it('assertHoldoutUnspent throws when any family has a holdout row', () => {
    expect(() => assertHoldoutUnspent([])).not.toThrow();
    expect(() => assertHoldoutUnspent([{ strategyFamily: 'donchian-breakout' }])).toThrow(/donchian-breakout/);
  });
});
