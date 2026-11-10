import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { CARRY_COSTS, addUtcMonths, type CarryParams } from '@microtrading/core';
import { AppModule } from '../app.module.js';
import { DbService } from '../db/db.service.js';
import { experiments } from '../db/schema.js';
import { ExperimentService, HOLDOUT_FROM, MAX_TOTAL_CONFIGS, paramsHash } from '../experiments/experiment.service.js';
import { HOLDOUT_TO, gitSha } from '../experiments/carry-registry.js';

/**
 * Carry pre-registration (SPEC §7.5 D5 / D6):
 *   pnpm preregister-carry [-- experiments/funding-carry-v3.json]   (repo-relative; default funding-carry.json)
 * Commit the grid file first. Immutable; counts against C5's 45.
 * A `forward` grid (D6) gets its window fixed here: start = next 00:00Z, end = start + months,
 * and its configs are logged as trials immediately — N counts them from registration.
 */
async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((a) => a !== '--');
  // Paths are relative to the repo root (dist/cli → ../../../../), so this works on the host and in the container.
  const file = new URL(arg ?? 'experiments/funding-carry.json', new URL('../../../../', import.meta.url));
  const spec = JSON.parse(readFileSync(file, 'utf8')) as { family: string; grid: CarryParams[]; forward?: boolean; months?: number };

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const dbs = app.get(DbService);
    const existing = await dbs.db
      .select()
      .from(experiments)
      .where(and(eq(experiments.strategyFamily, spec.family), eq(experiments.kind, 'preregistration')));
    if (existing.length) throw new Error(`${spec.family} is already pre-registered — immutable.`);
    const exps = app.get(ExperimentService);
    const pool = await exps.countDistinctConfigsAllFamilies();
    if (pool + spec.grid.length > MAX_TOTAL_CONFIGS) {
      throw new Error(`${pool} + ${spec.grid.length} configs exceeds the ${MAX_TOTAL_CONFIGS} total (C5).`);
    }

    let window: Record<string, number>;
    if (spec.forward) {
      if (!spec.months) throw new Error('forward grid needs "months"');
      const d = new Date();
      const startTs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
      window = { startTs, endTs: addUtcMonths(startTs, spec.months) };
    } else {
      window = { holdoutFrom: HOLDOUT_FROM, holdoutTo: HOLDOUT_TO };
    }
    await dbs.db.insert(experiments).values({
      kind: 'preregistration', strategyFamily: spec.family, paramsHash: null, gitSha: gitSha(),
      payload: { grid: spec.grid, forward: Boolean(spec.forward), ...window, costs: CARRY_COSTS },
    });
    if (spec.forward) {
      for (const [i, params] of spec.grid.entries()) {
        await dbs.db.insert(experiments).values({
          kind: 'trial', strategyFamily: spec.family, paramsHash: paramsHash(params as unknown as Record<string, number>),
          gitSha: gitSha(), payload: { config: `K${i + 1}`, params, note: 'forward config, counted at registration (SPEC §7.5 D6)' },
        });
      }
    }
    const n = await exps.countDistinctConfigsAllFamilies();
    console.log(`Pre-registered ${spec.family}: ${spec.grid.length} configs. N (all families) = ${spec.forward ? n : `${n} now, ${pool + spec.grid.length} once trialled`}.`);
    for (const [k, v] of Object.entries(window)) console.log(`  ${k}: ${new Date(v).toISOString()}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
