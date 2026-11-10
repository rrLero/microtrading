import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { carryVerdict, type CarryMetrics } from '@microtrading/core';
import { AppModule } from '../app.module.js';
import { DbService } from '../db/db.service.js';
import { experiments } from '../db/schema.js';
import { ExperimentService } from '../experiments/experiment.service.js';
import { V3_FAMILY, gitSha, v3Registration, v3Snapshot, type V3Snapshot } from '../experiments/carry-registry.js';
import { CandleRepository } from '../market-data/candle-repository.js';

/**
 * V3 verdict (SPEC §7.5 D6):  railway ssh --service agent -- node dist/cli/v3-carry-verdict.js
 * Written and committed BEFORE the forward window starts. Before the end date it prints
 * INTERIM and writes nothing. At/after it, it evaluates once and writes one evaluation row.
 * K1 and K2 are both reported; nothing is selected between them.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const dbs = app.get(DbService);
    const reg = await v3Registration(dbs);
    if (!reg) throw new Error(`${V3_FAMILY} is not pre-registered.`);
    const final = Date.now() >= reg.endTs;
    if (final) {
      const done = await dbs.db
        .select()
        .from(experiments)
        .where(and(eq(experiments.strategyFamily, V3_FAMILY), eq(experiments.kind, 'evaluation')));
      if (done.length) throw new Error(`V3 verdict already evaluated (row #${done[0]!.id}). It runs once.`);
    }
    const snap = await v3Snapshot(dbs, app.get(CandleRepository), reg, Math.min(Date.now(), reg.endTs));
    const [k1, k2] = snap.configs as [V3Snapshot['configs'][number], V3Snapshot['configs'][number]];
    const v1 = carryVerdict(k1.pooled, null);
    const v2 = carryVerdict(k2.pooled, k1.pooled);

    const day = (t: number) => new Date(t).toISOString().slice(0, 10);
    console.log(final
      ? `=== V3 VERDICT (SPEC §7.5 D6) — ${day(reg.startTs)} → ${day(reg.endTs)}, evaluated once ===`
      : `=== INTERIM — NOT THE VERDICT (${day(reg.startTs)} → ${day(reg.endTs)}; now ${new Date().toISOString().slice(0, 16)}Z). Nothing is stopped, dropped or re-tuned on this. ===`);
    for (const [c, v] of [[k1, v1], [k2, v2]] as const) print(c.id, c.pooled, snap.capital, v, c.perCoin);
    console.log(`N (trials, all families) = ${await app.get(ExperimentService).countDistinctConfigsAllFamilies()}`);

    if (final) {
      const [row] = await dbs.db.insert(experiments).values({
        kind: 'evaluation', strategyFamily: V3_FAMILY, paramsHash: null, gitSha: gitSha(),
        payload: { snapshot: snap, verdicts: { K1: v1, K2: v2 } },
      }).returning({ id: experiments.id });
      console.log(`Recorded as evaluation row #${row?.id}. Write it into REPORT and WORKLOG.`);
    }
  } finally {
    await app.close();
  }
}

function print(
  id: string, m: CarryMetrics, capital: number, v: ReturnType<typeof carryVerdict>,
  perCoin: V3Snapshot['configs'][number]['perCoin'],
): void {
  const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : 'n/a');
  console.log(`\n--- ${id}: pooled over ${perCoin.length} coins, capital ${capital} ---`);
  console.log(`net APR ${pct(m.netApr)} · funding ${m.fundingEarned.toFixed(2)} · costs ${m.costsPaid.toFixed(2)} · max DD ${pct(m.maxDrawdownPct)} · in market ${pct(m.timeInMarket)} · ${m.days.toFixed(1)} days`);
  for (const c of v.criteria) console.log(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}`);
  console.log(`  ${id}: ${v.pass ? 'PASS' : 'FAIL'}`);
  console.log('  per coin (breakdown, never an alternative result): ' +
    perCoin.map((c) => `${c.coin} ${(c.finalEquity - 10_000).toFixed(0)}`).join(' · '));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
