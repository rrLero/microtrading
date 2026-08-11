import { describe, expect, it } from 'vitest';
import { runBacktest, type BacktestConfig } from '../src/backtest/engine.js';
import { computeMetrics, normCdf, normInv } from '../src/backtest/metrics.js';
import { buildWalkForwardWindows } from '../src/backtest/walk-forward.js';
import { computeEntryPlan, DEFAULT_RISK } from '../src/risk.js';
import type { Candle, Signal, Strategy } from '../src/types.js';

const H = 3_600_000;

function mk(i: number, o: number, h: number, l: number, c: number): Candle {
  return { timestamp: i * H, open: o, high: h, low: l, close: c, volume: 1 };
}

/** Strategy that enters once at a given candle index and never exits. */
function enterAt(index: number): Strategy {
  return {
    id: 'test-enter',
    params: { index },
    warmupCandles: 1,
    onCandle(ctx): Signal {
      if (!ctx.position && ctx.candles1h.length - 1 === index) return { kind: 'enter-long', reason: 'test' };
      return { kind: 'hold' };
    },
  };
}

const CFG: BacktestConfig = {
  initialEquity: 10_000,
  costs: { takerFeeRate: 0.0026, slippageRate: 0.0003 },
  risk: { ...DEFAULT_RISK, volCircuitBreakerPercentile: 100 },
  atrPeriod: 3,
};

describe('risk sizing', () => {
  it('sizes so that a stop fill loses exactly riskPerTradePct', () => {
    const plan = computeEntryPlan(10_000, 100, 2, DEFAULT_RISK)!; // stop distance 4
    expect(plan.stopPrice).toBeCloseTo(96);
    // loss at stop = qty * 4 = 1% of 10k = 100 → qty = 25; notional 2500 ≤ 10% cap? No: cap = 1000/100 = 10
    expect(plan.quantity).toBeCloseTo(10); // notional cap binds — the gap backstop
  });

  it('returns null on degenerate ATR', () => {
    expect(computeEntryPlan(10_000, 100, 0, DEFAULT_RISK)).toBeNull();
    expect(computeEntryPlan(10_000, 100, NaN, DEFAULT_RISK)).toBeNull();
  });
});

describe('backtest engine', () => {
  it('fills entries at the NEXT candle open (no look-ahead)', () => {
    const candles = [mk(0, 100, 101, 99, 100), mk(1, 100, 101, 99, 100), mk(2, 100, 101, 99, 100), mk(3, 100, 101, 99, 100), mk(4, 105, 106, 104, 105), mk(5, 105, 106, 104, 105)];
    const res = runBacktest(candles, enterAt(3), CFG);
    expect(res.trades).toHaveLength(1);
    // signal at candle 3 → fill at candle 4's open (105), not candle 3's close (100)
    expect(res.trades[0]!.entryPrice).toBeCloseTo(105 * 1.0003, 3);
    expect(res.trades[0]!.entryTs).toBe(4 * H);
  });

  it('charges fees and slippage on both sides', () => {
    const candles = Array.from({ length: 8 }, (_, i) => mk(i, 100, 101, 99, 100));
    const res = runBacktest(candles, enterAt(4), CFG);
    const t = res.trades[0]!;
    expect(t.exitReason).toBe('end-of-data');
    expect(t.fees).toBeGreaterThan(0);
    // flat price + costs → strictly negative PnL
    expect(t.pnl).toBeLessThan(0);
  });

  it('stop fills pessimistically at the open when the market gaps through it', () => {
    // wild candles so ATR(3) is large enough; entry at candle 5 open=100
    const candles = [
      mk(0, 100, 104, 96, 100),
      mk(1, 100, 104, 96, 100),
      mk(2, 100, 104, 96, 100),
      mk(3, 100, 104, 96, 100),
      mk(4, 100, 104, 96, 100),
      mk(5, 100, 104, 99, 100), // entry fills here at open≈100; ATR≈8 → stop≈84
      mk(6, 60, 61, 55, 58), // massive gap DOWN through the stop
      mk(7, 58, 59, 57, 58),
    ];
    const res = runBacktest(candles, enterAt(4), CFG);
    const t = res.trades[0]!;
    expect(t.exitReason).toBe('stop');
    // pessimistic: fill at min(stop, open) = open 60, not the stop price ~84
    expect(t.exitPrice).toBeLessThanOrEqual(60);
  });

  it('exposure and equity curve are consistent', () => {
    const candles = Array.from({ length: 30 }, (_, i) => mk(i, 100 + i, 101 + i, 99 + i, 100 + i));
    const res = runBacktest(candles, enterAt(10), CFG);
    expect(res.equityCurve).toHaveLength(30);
    const m = computeMetrics(res, 1);
    expect(m.nTrades).toBe(1);
    expect(m.exposurePct).toBeGreaterThan(0);
  });
});

describe('walk-forward windows', () => {
  it('builds rolling 18/6 windows stepping 6 months', () => {
    const from = Date.UTC(2020, 0, 1);
    const to = Date.UTC(2025, 0, 1);
    const w = buildWalkForwardWindows(from, to);
    expect(w.length).toBeGreaterThanOrEqual(5);
    // contiguous: test starts where train ends; step = 6 months
    for (const win of w) {
      expect(win.testFrom).toBe(win.trainTo);
      expect(win.testTo).toBeLessThanOrEqual(to);
    }
    expect(new Date(w[1]!.trainFrom).getUTCMonth()).toBe((new Date(w[0]!.trainFrom).getUTCMonth() + 6) % 12);
  });
});

describe('normal functions (deflated Sharpe plumbing)', () => {
  it('normCdf and normInv are consistent inverses', () => {
    for (const p of [0.05, 0.5, 0.95, 0.999]) {
      expect(normCdf(normInv(p))).toBeCloseTo(p, 3);
    }
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normInv(0.975)).toBeCloseTo(1.96, 2);
  });
});
