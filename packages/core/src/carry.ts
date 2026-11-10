import type { Candle } from './types.js';

/**
 * V2 funding-rate carry (SPEC §7.5 D5): spot BTC long + equal-quantity perp short,
 * 1x on capital. Pure — the backtest CLI and a future paper loop call the same code.
 */
export interface FundingPrint { ts: number; rate: number } // rate per 8h settlement, fraction
export interface CarryBar { ts: number; spotOpen: number; spotClose: number; perpOpen: number; perpClose: number }
/** k = trailing prints for the signal; k = 0 means always on (C1). APRs are fractions. */
export interface CarryParams { k: number; enterApr: number; exitApr: number }
export interface CarryCosts { spotFee: number; perpFee: number; slippage: number }
export const CARRY_COSTS: CarryCosts = { spotFee: 0.001, perpFee: 0.00055, slippage: 0.0003 };
export interface CarryRun {
  equity: { ts: number; equity: number }[];
  finalEquity: number;
  roundTrips: number;
  rebalances: number;
  fundingEarned: number;
  costsPaid: number;
  barsInMarket: number;
}

const PRINTS_PER_YEAR = 3 * 365;
const REBALANCE_AT = 1.5; // perp mark vs perp entry: restore 1x before margin bites

/** Bars where both legs exist; a bar missing either leg is skipped and counted, never interpolated. */
export function joinBars(spot: Candle[], perp: Candle[]): { bars: CarryBar[]; skipped: number } {
  const p = new Map(perp.map((c) => [c.timestamp, c]));
  const s = new Set(spot.map((c) => c.timestamp));
  const bars: CarryBar[] = [];
  for (const c of spot) {
    const q = p.get(c.timestamp);
    if (q) bars.push({ ts: c.timestamp, spotOpen: c.open, spotClose: c.close, perpOpen: q.open, perpClose: q.close });
  }
  const skipped = s.size + p.size - 2 * bars.length;
  return { bars: bars.sort((a, b) => a.ts - b.ts), skipped };
}

/** Mean of the last k prints with ts <= atTs, annualised; null if fewer than k exist. */
export function trailingApr(funding: FundingPrint[], atTs: number, k: number): number | null {
  const past = funding.filter((f) => f.ts <= atTs);
  if (k <= 0 || past.length < k) return null;
  const last = past.slice(-k);
  return (last.reduce((a, f) => a + f.rate, 0) / k) * PRINTS_PER_YEAR;
}

export function runCarry(
  allBars: CarryBar[], funding: FundingPrint[], p: CarryParams, costs: CarryCosts,
  capital: number, fromTs: number, toTs: number,
): CarryRun {
  const bars = allBars.filter((b) => b.ts >= fromTs && b.ts < toTs);
  const sorted = [...funding].sort((a, b) => a.ts - b.ts);
  const settlements = sorted.filter((f) => f.ts >= fromTs && f.ts < toTs);
  const s = costs.slippage;
  let cash = capital, qty = 0, perpEntry = 0, openedAt = -1;
  let roundTrips = 0, rebalances = 0, fundingEarned = 0, costsPaid = 0, barsInMarket = 0;
  let next = 0, pendingRebalance = false, everOpened = false;
  const equity: CarryRun['equity'] = [];

  const open = (spotPx: number, perpPx: number, ts: number) => {
    const spotFill = spotPx * (1 + s), perpFill = perpPx * (1 - s);
    qty = cash / 2 / spotFill;
    const fees = costs.spotFee * qty * spotFill + costs.perpFee * qty * perpFill;
    cash -= qty * spotFill + fees;
    costsPaid += fees + qty * (spotFill - spotPx) + qty * (perpPx - perpFill);
    perpEntry = perpFill;
    openedAt = ts;
    everOpened = true;
  };
  const close = (spotPx: number, perpPx: number) => {
    const spotFill = spotPx * (1 - s), perpFill = perpPx * (1 + s);
    const fees = costs.spotFee * qty * spotFill + costs.perpFee * qty * perpFill;
    cash += qty * spotFill + qty * (perpEntry - perpFill) - fees;
    costsPaid += fees + qty * (spotPx - spotFill) + qty * (perpFill - perpPx);
    qty = 0;
  };

  for (const bar of bars) {
    if (pendingRebalance && qty > 0) {
      close(bar.spotOpen, bar.perpOpen);
      open(bar.spotOpen, bar.perpOpen, bar.ts);
      rebalances++;
    }
    pendingRebalance = false;

    while (next < settlements.length && settlements[next]!.ts <= bar.ts) {
      const S = settlements[next++]!;
      if (qty > 0 && openedAt < S.ts) {
        const pay = S.rate * qty * bar.perpOpen; // positive funding: longs pay shorts
        cash += pay;
        fundingEarned += pay;
      }
      if (p.k > 0) {
        const apr = trailingApr(sorted, S.ts, p.k);
        if (apr === null) continue;
        if (qty === 0 && apr > p.enterApr) open(bar.spotOpen, bar.perpOpen, bar.ts);
        else if (qty > 0 && apr < p.exitApr) {
          close(bar.spotOpen, bar.perpOpen);
          roundTrips++;
        }
      }
    }
    if (p.k === 0 && !everOpened) open(bar.spotOpen, bar.perpOpen, bar.ts);

    if (qty > 0) {
      barsInMarket++;
      if (bar.perpClose >= REBALANCE_AT * perpEntry) pendingRebalance = true;
    }
    equity.push({ ts: bar.ts, equity: cash + qty * bar.spotClose + qty * (perpEntry - bar.perpClose) });
  }

  const last = bars.at(-1);
  if (last && qty > 0) {
    close(last.spotClose, last.perpClose);
    roundTrips++;
    equity[equity.length - 1] = { ts: last.ts, equity: cash };
  }
  return { equity, finalEquity: cash, roundTrips, rebalances, fundingEarned, costsPaid, barsInMarket };
}

export interface CarryMetrics {
  netApr: number;
  maxDrawdownPct: number; // fraction
  worst30dReturn: number;
  bestMonth: string | null;
  bestMonthShare: number; // NaN when net <= 0
  byYear: { year: string; ret: number }[];
  timeInMarket: number; // fraction of bars
  fundingEarned: number;
  costsPaid: number;
  roundTrips: number;
  rebalances: number;
  days: number;
}

const DAY = 86_400_000;

/** Period-end equity per key (UTC month or year), and each period's change vs the previous end. */
function periodChanges(eq: CarryRun['equity'], capital: number, key: (ts: number) => string) {
  const ends = new Map<string, number>();
  for (const p of eq) ends.set(key(p.ts), p.equity);
  let prev = capital;
  return [...ends].map(([k, v]) => {
    const out = { key: k, change: v - prev, ret: v / prev - 1 };
    prev = v;
    return out;
  });
}

export function carryMetrics(run: CarryRun, capital: number): CarryMetrics {
  const eq = run.equity;
  const days = eq.length > 1 ? (eq.at(-1)!.ts - eq[0]!.ts) / DAY : 0;
  const net = run.finalEquity - capital;

  let peak = capital, maxDd = 0;
  for (const p of eq) {
    peak = Math.max(peak, p.equity);
    maxDd = Math.max(maxDd, (peak - p.equity) / peak);
  }
  let worst30 = 0;
  for (let i = 0, j = 0; i < eq.length; i++) {
    while (j + 1 < i && eq[j + 1]!.ts <= eq[i]!.ts - 30 * DAY) j++;
    if (eq[i]!.ts - eq[j]!.ts >= 30 * DAY) worst30 = Math.min(worst30, eq[i]!.equity / eq[j]!.equity - 1);
  }
  const months = periodChanges(eq, capital, (ts) => new Date(ts).toISOString().slice(0, 7));
  const best = months.reduce<(typeof months)[number] | null>((b, m) => (b === null || m.change > b.change ? m : b), null);

  return {
    netApr: days > 0 ? (net / capital) * (365.25 / days) : 0,
    maxDrawdownPct: maxDd,
    worst30dReturn: worst30,
    bestMonth: best?.key ?? null,
    bestMonthShare: net > 0 && best ? best.change / net : NaN,
    byYear: periodChanges(eq, capital, (ts) => new Date(ts).toISOString().slice(0, 4)).map((y) => ({ year: y.key, ret: y.ret })),
    timeInMarket: eq.length ? run.barsInMarket / eq.length : 0,
    fundingEarned: run.fundingEarned,
    costsPaid: run.costsPaid,
    roundTrips: run.roundTrips,
    rebalances: run.rebalances,
    days,
  };
}

export interface Criterion { name: string; pass: boolean; detail: string }

/** SPEC §7.5 D5 pass criteria; all must hold. c1 = null when the chosen config IS C1. */
export function carryVerdict(chosen: CarryMetrics, c1: CarryMetrics | null): { pass: boolean; criteria: Criterion[] } {
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const criteria: Criterion[] = [
    { name: 'net APR > 4%', pass: chosen.netApr > 0.04, detail: pct(chosen.netApr) },
    c1
      ? { name: 'beats C1', pass: chosen.netApr > c1.netApr, detail: `${pct(chosen.netApr)} vs C1 ${pct(c1.netApr)}` }
      : { name: 'beats C1', pass: true, detail: 'n/a — chosen config is C1' },
    { name: 'best month < 50%', pass: chosen.bestMonthShare < 0.5, detail: Number.isNaN(chosen.bestMonthShare) ? 'n/a (net <= 0) — fails' : pct(chosen.bestMonthShare) },
    { name: 'max DD < 5%', pass: chosen.maxDrawdownPct < 0.05, detail: pct(chosen.maxDrawdownPct) },
  ];
  return { pass: criteria.every((c) => c.pass), criteria };
}

/** D5 selection rule: highest dev net APR; ties go to the lower grid index. */
export function pickDevBest(results: { params: CarryParams; m: CarryMetrics }[]): number {
  return results.reduce((best, r, i) => (r.m.netApr > results[best]!.m.netApr ? i : best), 0);
}

/** C4: one holdout evaluation in total, across every family. */
export function assertHoldoutUnspent(holdoutRows: { strategyFamily: string }[]): void {
  if (holdoutRows.length) {
    throw new Error(`Holdout already spent by: ${holdoutRows.map((r) => r.strategyFamily).join(', ')} (SPEC §7.5 C4/D5). Refusing.`);
  }
}
