import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import {
  CARRY_COSTS, assertHoldoutUnspent, carryMetrics, carryVerdict, pickDevBest, runCarry,
  type CarryMetrics, type CarryParams,
} from '@microtrading/core';
import { AppModule } from '../app.module.js';
import { DbService } from '../db/db.service.js';
import { experiments } from '../db/schema.js';
import { ExperimentService, HOLDOUT_FROM, paramsHash } from '../experiments/experiment.service.js';
import { CAPITAL, CARRY_FAMILY, HOLDOUT_TO, carryRows, gitSha, loadCarryData } from '../experiments/carry-registry.js';
import { CandleRepository } from '../market-data/candle-repository.js';

/**
 * V2 holdout verdict (SPEC §7.5 C4 + D5):  pnpm carry-verdict
 * Written and committed BEFORE it was run. Runs ONCE: it refuses if any family has
 * a holdout-evaluation row, and writes one itself. Nothing is chosen from its output.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const dbs = app.get(DbService);
    assertHoldoutUnspent(await dbs.db.select().from(experiments).where(eq(experiments.kind, 'holdout-evaluation')));

    const [reg] = await carryRows(dbs, 'preregistration');
    if (!reg) throw new Error('not pre-registered');
    const grid = (reg.payload as { grid: CarryParams[] }).grid;
    // Dev-best from the LOGGED dev trials (latest row per config), not re-derived by hand.
    const trials = await carryRows(dbs, 'trial');
    const dev = grid.map((params) => {
      const row = trials.filter((t) => t.paramsHash === paramsHash(params as unknown as Record<string, number>)).at(-1);
      if (!row) throw new Error(`no dev trial for ${JSON.stringify(params)} — run run-carry first`);
      return { params, m: (row.payload as { metrics: CarryMetrics }).metrics };
    });
    if (dev.every((d) => d.m.netApr <= 0)) throw new Error('DEV KILL stands — the holdout is not spent.');
    const bi = pickDevBest(dev);
    const chosen = grid[bi]!;
    const gated = chosen.k > 0;

    // Funding before HOLDOUT_FROM is warmup for the trailing signal; bars/settlements start at HOLDOUT_FROM.
    const { bars, skipped, funding } = await loadCarryData(dbs, app.get(CandleRepository), HOLDOUT_TO);
    const run = (p: CarryParams) => carryMetrics(runCarry(bars, funding, p, CARRY_COSTS, CAPITAL, HOLDOUT_FROM, HOLDOUT_TO), CAPITAL);
    const m = run(chosen);
    const c1 = gated ? run(grid[0]!) : null;
    const v = carryVerdict(m, c1);

    await dbs.db.insert(experiments).values({
      kind: 'holdout-evaluation', strategyFamily: CARRY_FAMILY,
      paramsHash: paramsHash(chosen as unknown as Record<string, number>), gitSha: gitSha(),
      payload: { config: `C${bi + 1}`, params: chosen, metrics: m, c1Benchmark: c1, verdict: v, skippedBars: skipped, costs: CARRY_COSTS },
    });

    const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : 'n/a');
    console.log(`=== V2 HOLDOUT VERDICT (SPEC §7.5 D5) — ${new Date(HOLDOUT_FROM).toISOString().slice(0, 10)} → ${new Date(HOLDOUT_TO).toISOString().slice(0, 10)} (exclusive), evaluated once ===`);
    console.log(`chosen: C${bi + 1} ${JSON.stringify(chosen)} (dev net APR ${pct(dev[bi]!.m.netApr)}); ${bars.filter((b) => b.ts >= HOLDOUT_FROM).length} bars, ${skipped} skipped overall`);
    console.log(`holdout: net APR ${pct(m.netApr)} · funding ${m.fundingEarned.toFixed(2)} · costs ${m.costsPaid.toFixed(2)} · max DD ${pct(m.maxDrawdownPct)} · worst 30d ${pct(m.worst30dReturn)} · in market ${pct(m.timeInMarket)} · trips ${m.roundTrips} · rebalances ${m.rebalances}`);
    console.log(`best month ${m.bestMonth} (${pct(m.bestMonthShare)} of net) · by year ${m.byYear.map((y) => `${y.year} ${pct(y.ret)}`).join(' · ')}`);
    if (c1) console.log(`C1 benchmark: net APR ${pct(c1.netApr)} · max DD ${pct(c1.maxDrawdownPct)}`);
    for (const c of v.criteria) console.log(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}`);
    console.log(`\nVERDICT: ${v.pass ? 'PASS' : 'FAIL'} · N (trials, all families) = ${await app.get(ExperimentService).countDistinctConfigsAllFamilies()}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
