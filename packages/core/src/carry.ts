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
