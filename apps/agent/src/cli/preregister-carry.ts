import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { CARRY_COSTS } from '@microtrading/core';
import { AppModule } from '../app.module.js';
import { DbService } from '../db/db.service.js';
import { experiments } from '../db/schema.js';
import { ExperimentService, HOLDOUT_FROM, MAX_TOTAL_CONFIGS } from '../experiments/experiment.service.js';
import { CARRY_FAMILY, HOLDOUT_TO, carryRows, gitSha } from '../experiments/carry-registry.js';

/**
 * V2 pre-registration (SPEC §7.5 D5):  pnpm preregister-carry
 * Commit experiments/funding-carry.json first. Immutable; counts against C5's 45.
 */
async function main(): Promise<void> {
  const spec = JSON.parse(readFileSync(new URL('../../../../experiments/funding-carry.json', import.meta.url), 'utf8')) as {
    family: string; grid: Record<string, number>[];
  };
  if (spec.family !== CARRY_FAMILY) throw new Error(`grid file family is ${spec.family}, expected ${CARRY_FAMILY}`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const dbs = app.get(DbService);
    if ((await carryRows(dbs, 'preregistration')).length) throw new Error(`${CARRY_FAMILY} is already pre-registered — immutable.`);
    const pool = await app.get(ExperimentService).countDistinctConfigsAllFamilies();
    if (pool + spec.grid.length > MAX_TOTAL_CONFIGS) {
      throw new Error(`${pool} + ${spec.grid.length} configs exceeds the ${MAX_TOTAL_CONFIGS} total (C5).`);
    }
    await dbs.db.insert(experiments).values({
      kind: 'preregistration',
      strategyFamily: CARRY_FAMILY,
      paramsHash: null,
      gitSha: gitSha(),
      payload: { grid: spec.grid, holdoutFrom: HOLDOUT_FROM, holdoutTo: HOLDOUT_TO, costs: CARRY_COSTS },
    });
    console.log(`Pre-registered ${CARRY_FAMILY}: ${spec.grid.length} configs; N will be ${pool + spec.grid.length} once trialled. Holdout ${new Date(HOLDOUT_FROM).toISOString().slice(0, 10)} → ${new Date(HOLDOUT_TO).toISOString().slice(0, 10)}.`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
