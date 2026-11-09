import { describe, expect, it } from 'vitest';
import { recost, roundTrips, verdictStats, type FillRow, type RoundTrip } from '../src/round-trips.js';

const buy = (symbol: string, at: number, costUsdc: number, fee: number): FillRow => ({
  symbol, at, side: 'buy', costUsdc, fee,
});
const sell = (symbol: string, at: number, receivedUsdc: number, pnlNet: number): FillRow => ({
  symbol, at, side: 'sell', receivedUsdc, pnlNet,
});

describe('roundTrips', () => {
  it('nets the entry fee that the sell row pnlNet omits', () => {
    // Journaled stop: pnlNet -23.33, but the 1.01 entry fee makes it -24.34.
    const [t] = roundTrips([buy('BTC/USDC', 1, 1014.65, 1.01), sell('BTC/USDC', 2, 990.31, -23.33)]);
    expect(t.net).toBeCloseTo(990.31 - 1014.65 - 1.01, 6);
    expect(t.openedAt).toBe(1);
    expect(t.closedAt).toBe(2);
  });

  it('counts a trade that only covers its exit fee as a loss', () => {
    const trips = roundTrips([buy('X', 1, 1000, 1), sell('X', 2, 1000.5, 0.5)]);
    expect(trips[0].net).toBeCloseTo(-0.5, 6);
  });

  it('costs a pre-costUsdc buy row (2026-08-07 schema) from quantity x fillPrice', () => {
    const old: FillRow = { symbol: 'X', at: 1, side: 'buy', quantity: 2, fillPrice: 500, fee: 2.6 };
    expect(roundTrips([old, sell('X', 2, 1003, 0)])[0].net).toBeCloseTo(1003 - 1000 - 2.6, 6);
  });

  it('pairs per symbol when accounts interleave, and skips a still-open buy', () => {
    const trips = roundTrips([
      buy('A', 1, 100, 0.1),
      buy('B', 2, 200, 0.2),
      sell('B', 3, 210, 9.8),
      sell('A', 4, 90, -10.1),
      buy('A', 5, 100, 0.1), // open — not a round trip yet
    ]);
    expect(trips.map((t) => [t.symbol, Number(t.net.toFixed(2))])).toEqual([
      ['B', 9.8],
      ['A', -10.1],
    ]);
  });
});

const MONTH = (y: number, m: number, d = 15) => Date.UTC(y, m - 1, d);
const trip = (symbol: string, closedAt: number, net: number, notional = 1000): RoundTrip => ({
  symbol, openedAt: closedAt - 1, closedAt, net, returnPct: (net / notional) * 100,
  entryNotional: notional, exitNotional: notional + net,
});

describe('verdictStats', () => {
  it('reports PF, win rate, return on pooled capital and the best-month share', () => {
    const s = verdictStats([trip('A', MONTH(2027, 1), 30), trip('B', MONTH(2027, 1), -10), trip('A', MONTH(2027, 2), 20)], 20_000);
    expect(s.count).toBe(3);
    expect(s.net).toBeCloseTo(40);
    expect(s.netReturnPct).toBeCloseTo(0.2);
    expect(s.profitFactor).toBeCloseTo(5);
    expect(s.winRate).toBeCloseTo(2 / 3);
    expect(s.bestMonth).toBe('2027-01');
    expect(s.bestMonthShare).toBeCloseTo(20 / 40);
    expect(s.perPair.map((p) => [p.symbol, p.count, p.net])).toEqual([['A', 2, 50], ['B', 1, -10]]);
  });

  it('fires the PF kill only at >= 100 trades (§7.4)', () => {
    const losers = Array.from({ length: 99 }, (_, i) => trip('A', MONTH(2027, 1) + i, -1));
    expect(verdictStats(losers, 1).killProfitFactor).toBe(false);
    expect(verdictStats([...losers, trip('A', MONTH(2027, 2), -1)], 1).killProfitFactor).toBe(true);
  });

  it('fires the 3-month kill on consecutive negative months; an empty month breaks the run (C3 i)', () => {
    const broken = [trip('A', MONTH(2027, 1), -1), trip('A', MONTH(2027, 2), -1), trip('A', MONTH(2027, 4), -1)];
    expect(verdictStats(broken, 1).killThreeMonths).toBe(null);
    const run = [...broken, trip('A', MONTH(2027, 5), -1), trip('A', MONTH(2027, 6), -1)];
    expect(verdictStats(run, 1).killThreeMonths).toBe('2027-06');
  });

  it('measures max drawdown of the pooled closed-trade equity', () => {
    const s = verdictStats([trip('A', 1, 100), trip('A', 2, -150), trip('A', 3, 30)], 1000);
    expect(s.maxDrawdownPct).toBeCloseTo((150 / 1100) * 100);
  });
});

describe('recost', () => {
  it('charges the extra half-spread above the modeled slippage on both legs', () => {
    const t = recost(trip('A', 1, 10, 1000), 0.0005, 0.0003);
    expect(t.net).toBeCloseTo(10 - 0.0002 * (1000 + 1010));
  });
});
