import { execSync } from 'node:child_process';
import { and, asc, eq, lt } from 'drizzle-orm';
import { joinBars, type CarryBar, type FundingPrint } from '@microtrading/core';
import type { DbService } from '../db/db.service.js';
import { experiments, fundingRates } from '../db/schema.js';
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
