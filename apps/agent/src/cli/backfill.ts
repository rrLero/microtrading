import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../app.module.js';
import { IngestionService } from '../market-data/ingestion.service.js';

/**
 * REST backfill CLI:  pnpm backfill
 * Resumable and idempotent — re-running continues from the last stored candle.
 * Reads SYMBOL, DATA_EXCHANGE, BACKFILL_SINCE from .env.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  try {
    const config = app.get(ConfigService);
    const ingestion = app.get(IngestionService);
    const symbol = config.get<string>('SYMBOL', 'BTC/USDC');
    const since = config.get<string>('BACKFILL_SINCE', '2019-01-01T00:00:00Z');
    await ingestion.backfill(symbol, since);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
