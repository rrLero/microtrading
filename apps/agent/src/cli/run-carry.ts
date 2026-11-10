import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { CARRY_COSTS, carryMetrics, pickDevBest, runCarry, type CarryMetrics, type CarryParams } from '@microtrading/core';
import { AppModule } from '../app.module.js';
import { DbService } from '../db/db.service.js';
import { experiments } from '../db/schema.js';
import { ExperimentService, HOLDOUT_FROM, paramsHash } from '../experiments/experiment.service.js';
import { CAPITAL, CARRY_FAMILY, DEV_FROM, carryRows, gitSha, loadCarryData } from '../experiments/carry-registry.js';
import { CandleRepository } from '../market-data/candle-repository.js';

/** V2 dev backtest (SPEC §7.5 D5):  pnpm run-carry — dev window only; every config logged as a trial. */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const dbs = app.get(DbService);
    const [reg] = await carryRows(dbs, 'preregistration');
    if (!reg) throw new Error(`${CARRY_FAMILY} is not pre-registered — run preregister-carry first.`);
    const grid = (reg.payload as { grid: CarryParams[] }).grid;

    const { bars, skipped, funding } = await loadCarryData(dbs, app.get(CandleRepository), HOLDOUT_FROM);
    console.log(`DEV ${new Date(DEV_FROM).toISOString().slice(0, 10)} → ${new Date(HOLDOUT_FROM).toISOString().slice(0, 10)} (exclusive): ${bars.length} joined 1h bars, ${skipped} skipped (one leg missing), ${funding.length} funding prints\n`);

    const results: { params: CarryParams; m: CarryMetrics }[] = [];
    for (const [i, params] of grid.entries()) {
      const m = carryMetrics(runCarry(bars, funding, params, CARRY_COSTS, CAPITAL, DEV_FROM, HOLDOUT_FROM), CAPITAL);
      results.push({ params, m });
      await dbs.db.insert(experiments).values({
        kind: 'trial', strategyFamily: CARRY_FAMILY, paramsHash: paramsHash(params as unknown as Record<string, number>),
        gitSha: gitSha(), payload: { config: `C${i + 1}`, params, metrics: m, window: 'dev', costs: CARRY_COSTS },
      });
    }

    const pct = (x: number, d = 2) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : 'n/a');
    console.log('id  params                     netAPR    maxDD   worst30d  inMkt   funding   costs   trips reb  bestMonth (share)');
    for (const [i, { params: p, m }] of results.entries()) {
      console.log(
        `C${i + 1}  ${(p.k === 0 ? 'always on' : `k=${p.k} in>${p.enterApr} out<${p.exitApr}`).padEnd(26)} ${pct(m.netApr).padStart(7)} ${pct(m.maxDrawdownPct).padStart(7)} ${pct(m.worst30dReturn).padStart(8)} ${pct(m.timeInMarket, 0).padStart(6)} ${m.fundingEarned.toFixed(0).padStart(8)} ${m.costsPaid.toFixed(0).padStart(7)} ${String(m.roundTrips).padStart(5)} ${String(m.rebalances).padStart(3)}  ${m.bestMonth} (${pct(m.bestMonthShare, 0)})`,
      );
      console.log(`    by year: ${m.byYear.map((y) => `${y.year} ${pct(y.ret)}`).join(' · ')}`);
    }
    const best = pickDevBest(results);
    console.log(`\nN (trials, all families) = ${await app.get(ExperimentService).countDistinctConfigsAllFamilies()}`);
    if (results.every((r) => r.m.netApr <= 0)) {
      console.log('DEV KILL — no config has dev net APR > 0. V2 stops; holdout not spent (SPEC §7.5 D5).');
      return;
    }
    console.log(`Dev-best (D5 rule: max net APR, ties → lower id): C${best + 1}. Holdout: pnpm carry-verdict — ONCE.`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
