import { execSync } from 'node:child_process';
import { and, asc, desc, eq, gte, lt } from 'drizzle-orm';
import type { Exchange } from 'ccxt';
import {
  CARRY_COSTS, carryMetrics, joinBars, poolRuns, runCarry,
  type CarryBar, type CarryMetrics, type CarryParams, type FundingPrint,
} from '@microtrading/core';
import { universeSymbols } from './universe.js';
import type { DbService } from '../db/db.service.js';
import { experiments, fundingRates, journal } from '../db/schema.js';
import type { CandleRepository } from '../market-data/candle-repository.js';

/** V2 funding carry (SPEC §7.5 D5). Separate from ExperimentService so V1's §7 code stays untouched. */
export const CARRY_FAMILY = 'funding-carry';
export const SPOT = 'BTC/USDC';
export const PERP = 'BTC/USDC:USDC'; // Bybit BTCPERP, USDC-settled
export const DEV_FROM = Date.UTC(2022, 0, 14);
export const HOLDOUT_TO = Date.UTC(2026, 7, 1); // C4: data from 2026-08-01 is the soak, unused
export const CAPITAL = 10_000;

export function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'no-git';
  }
}

/** Bars and funding strictly before `toTs` — the query bound is what keeps dev runs off the holdout. */
export async function loadCarryData(
  dbs: DbService, repo: CandleRepository, toTs: number,
): Promise<{ bars: CarryBar[]; skipped: number; funding: FundingPrint[] }> {
  const before = <T extends { timestamp: number }>(xs: T[]) => xs.filter((c) => c.timestamp < toTs);
  const spot = before(await repo.fetchSince(SPOT, '1h', DEV_FROM));
  const perp = before(await repo.fetchSince(PERP, '1h', DEV_FROM));
  const rows = await dbs.db
    .select({ ts: fundingRates.ts, rate: fundingRates.rate })
    .from(fundingRates)
    .where(and(eq(fundingRates.symbol, PERP), lt(fundingRates.ts, toTs)))
    .orderBy(asc(fundingRates.ts));
  return { ...joinBars(spot, perp), funding: rows };
}

export async function carryRows(dbs: DbService, kind: string) {
  return dbs.db
    .select()
    .from(experiments)
    .where(and(eq(experiments.strategyFamily, CARRY_FAMILY), eq(experiments.kind, kind)))
    .orderBy(asc(experiments.id));
}

/** Idempotent upsert of a perp's funding history from `since` (ccxt pages ascending). */
export async function ingestFunding(dbs: DbService, ex: Exchange, perp: string, since: number): Promise<number> {
  let total = 0;
  for (;;) {
    const page = await ex.fetchFundingRateHistory(perp, since, 200);
    if (!page.length) break;
    await dbs.db
      .insert(fundingRates)
      .values(page.map((f) => ({ symbol: perp, ts: f.timestamp!, rate: f.fundingRate!, source: 'bybit-rest' })))
      .onConflictDoNothing();
    total += page.length;
    const last = page.at(-1)!.timestamp!;
    if (last < since) break;
    since = last + 1;
  }
  return total;
}

// ---------- V3: forward multi-coin carry (SPEC §7.5 D6) ----------
export const V3_FAMILY = 'funding-carry-v3';
export const V3_CAPITAL_EACH = 10_000;
export const WARMUP_MS = 8 * 86_400_000; // K2 needs 7 days of funding before the start

export function v3Symbols(): { coin: string; spot: string; perp: string }[] {
  return universeSymbols().map((s) => {
    const coin = s.split('/')[0]!;
    return { coin, spot: `${coin}/USDT`, perp: `${coin}/USDT:USDT` };
  });
}

export interface V3Registration { id: number; startTs: number; endTs: number; grid: CarryParams[] }

export async function v3Registration(dbs: DbService): Promise<V3Registration | null> {
  const [row] = await dbs.db
    .select()
    .from(experiments)
    .where(and(eq(experiments.strategyFamily, V3_FAMILY), eq(experiments.kind, 'preregistration')));
  if (!row) return null;
  const p = row.payload as { startTs: number; endTs: number; grid: CarryParams[] };
  return { id: row.id, startTs: p.startTs, endTs: p.endTs, grid: p.grid };
}

export interface V3ConfigSnapshot {
  id: string;
  params: CarryParams;
  pooled: CarryMetrics;
  finalEquity: number;
  perCoin: { coin: string; finalEquity: number; fundingEarned: number; timeInMarket: number; skippedBars: number }[];
}
export interface V3Snapshot { asOf: number; startTs: number; endTs: number; capital: number; configs: V3ConfigSnapshot[] }

/** Deterministic: the same stored data always gives the same snapshot. Open positions are marked as if closed (exit costs paid). */
export async function v3Snapshot(dbs: DbService, repo: CandleRepository, reg: V3Registration, toTs: number): Promise<V3Snapshot> {
  const coins = v3Symbols();
  const data: { coin: string; bars: CarryBar[]; skipped: number; funding: FundingPrint[] }[] = [];
  for (const c of coins) {
    const before = <T extends { timestamp: number }>(xs: T[]) => xs.filter((x) => x.timestamp < toTs);
    const spot = before(await repo.fetchSince(c.spot, '1h', reg.startTs));
    const perp = before(await repo.fetchSince(c.perp, '1h', reg.startTs));
    const funding = await dbs.db
      .select({ ts: fundingRates.ts, rate: fundingRates.rate })
      .from(fundingRates)
      .where(and(eq(fundingRates.symbol, c.perp), gte(fundingRates.ts, reg.startTs - WARMUP_MS), lt(fundingRates.ts, toTs)))
      .orderBy(asc(fundingRates.ts));
    data.push({ coin: c.coin, ...joinBars(spot, perp), funding });
  }
  const configs = reg.grid.map((params, i) => {
    const runs = data.map((d) => runCarry(d.bars, d.funding, params, CARRY_COSTS, V3_CAPITAL_EACH, reg.startTs, toTs));
    const pooled = poolRuns(runs, V3_CAPITAL_EACH);
    return {
      id: `K${i + 1}`,
      params,
      pooled: carryMetrics(pooled, V3_CAPITAL_EACH * coins.length),
      finalEquity: pooled.finalEquity,
      perCoin: runs.map((r, j) => ({
        coin: data[j]!.coin,
        finalEquity: r.finalEquity,
        fundingEarned: r.fundingEarned,
        timeInMarket: r.equity.length ? r.barsInMarket / r.equity.length : 0,
        skippedBars: data[j]!.skipped,
      })),
    };
  });
  return { asOf: toTs, startTs: reg.startTs, endTs: reg.endTs, capital: V3_CAPITAL_EACH * coins.length, configs };
}

export async function latestV3Snapshot(dbs: DbService): Promise<{ at: Date; payload: V3Snapshot } | null> {
  const [row] = await dbs.db.select().from(journal).where(eq(journal.kind, 'carry-forward')).orderBy(desc(journal.id)).limit(1);
  return row ? { at: row.at, payload: row.payload as V3Snapshot } : null;
}
