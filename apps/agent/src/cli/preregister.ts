import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { ExperimentService, type StrategyFamily } from '../experiments/experiment.service.js';

/**
 * Pre-registration (SPEC §7.1):  pnpm preregister -- experiments/sma-crossover.json
 * The JSON file {family, grid: [...]} should be committed to git BEFORE running.
 * Immutable once registered; ≤20 configs; freezes the holdout boundary.
 */
async function main(): Promise<void> {
  const [file] = process.argv.slice(2).filter((a) => a !== '--');
  if (!file) {
    console.error('Usage: pnpm preregister -- <grid-file.json>');
    process.exitCode = 1;
    return;
  }
  const spec = JSON.parse(readFileSync(file, 'utf8')) as { family: StrategyFamily; grid: Record<string, number>[] };

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  try {
    await app.get(ExperimentService).preregister(spec.family, spec.grid);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
