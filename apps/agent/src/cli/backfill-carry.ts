import 'reflect-metadata';
import ccxt from 'ccxt';
import { eq } from 'drizzle-orm';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { DbService } from '../db/db.service.js';
import { fundingRates } from '../db/schema.js';
import { IngestionService } from '../market-data/ingestion.service.js';
import { CandleRepository } from '../market-data/candle-repository.js';
import { DEV_FROM, PERP, ingestFunding } from '../experiments/carry-registry.js';

/**
 * V2 data (SPEC §7.5 D5):  pnpm backfill-carry
 * Perp 1h candles under their own symbol (V1's BTC/USDC rows untouched) and the full
 * BTCPERP funding history. Idempotent; re-runs resume / upsert.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    await app.get(IngestionService).backfill(PERP, new Date(DEV_FROM).toISOString(), 'bybit');
    const repo = app.get(CandleRepository);
    console.log(`perp 1h candles: ${await repo.countRows(PERP, '1h')} from ${new Date((await repo.earliestTimestamp(PERP, '1h'))!).toISOString()}`);

    const db = app.get(DbService).db;
    const ex = new ccxt.bybit();
    await ex.loadMarkets();
    const total = await ingestFunding(app.get(DbService), ex, PERP, DEV_FROM);
    const rows = (await db.select({ ts: fundingRates.ts }).from(fundingRates).where(eq(fundingRates.symbol, PERP))).map((r) => r.ts).sort((a, b) => a - b);
    const gaps = rows.slice(1).filter((t, i) => t - rows[i]! > 8 * 3_600_000).length;
    console.log(`funding prints: fetched ${total}, stored ${rows.length}, ${new Date(rows[0]!).toISOString()} → ${new Date(rows.at(-1)!).toISOString()}, gaps > 8h: ${gaps}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
