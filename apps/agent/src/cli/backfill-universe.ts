import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { IngestionService } from '../market-data/ingestion.service.js';
import { CandleRepository } from '../market-data/candle-repository.js';

/**
 * Backfill the pre-registered evaluation universe:  pnpm backfill-universe [--purge]
 *
 * Reads experiments/universe.json (SPEC §2.2) and backfills every pair from the
 * DATA venue. Resumable and idempotent, like `backfill` — re-running continues
 * from each pair's last stored candle.
 *
 * `--purge` deletes existing candles for a pair whose stored rows came from a
 * DIFFERENT source than the one we are about to ingest. Without it, a venue
 * change silently splices two price series into one: Bybit rows overwrite
 * Kraken rows where they overlap and Kraken rows survive where they do not,
 * producing a series that no venue ever printed. Back up before purging —
 * see data-archive/.
 */
const UNIVERSE = new URL('../../../../experiments/universe.json', import.meta.url);

async function main(): Promise<void> {
  const purge = process.argv.includes('--purge');
  const uni = JSON.parse(readFileSync(UNIVERSE, 'utf8')) as {
    dataVenue: string;
    pairs: { symbol: string; historyFrom: string }[];
  };

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const ingestion = app.get(IngestionService);
    const repo = app.get(CandleRepository);
    const wantSource = `${uni.dataVenue}-rest`;

    console.log(`Universe: ${uni.pairs.length} pairs from ${uni.dataVenue}${purge ? ' (PURGE mode)' : ''}\n`);
    for (const [i, p] of uni.pairs.entries()) {
      const label = `[${i + 1}/${uni.pairs.length}] ${p.symbol}`;
      if (purge) {
        const foreign = await repo.countBySourceOtherThan(p.symbol, wantSource);
        if (foreign > 0) {
          console.log(`${label} purging ${foreign} row(s) from a different source before re-ingest`);
          await repo.deleteTimeframe(p.symbol, '1h');
          await repo.deleteTimeframe(p.symbol, '4h');
        }
      }
      try {
        await ingestion.backfill(p.symbol, `${p.historyFrom}T00:00:00Z`);
        const n = await repo.countRows(p.symbol, '1h');
        console.log(`${label} done — ${n.toLocaleString()} 1h candles`);
      } catch (err) {
        // One dead pair must not abandon the other nine; the gap is visible in the summary.
        console.error(`${label} FAILED — ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    console.log('\n=== universe coverage ===');
    for (const p of uni.pairs) {
      const n = await repo.countRows(p.symbol, '1h');
      const first = await repo.earliestTimestamp(p.symbol, '1h');
      console.log(
        `${p.symbol.padEnd(11)} ${String(n).padStart(7)} 1h candles  from ${first ? new Date(first).toISOString().slice(0, 10) : '—'}`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
