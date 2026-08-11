import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../app.module.js';
import { IngestionService } from '../market-data/ingestion.service.js';

/**
 * Gap healing CLI:  pnpm heal-gaps
 * Fills zero-trade intervals with flat candles (source='gap-fill-flat'),
 * prints the per-year gap distribution, rebuilds 4h, and re-validates.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  try {
    const config = app.get(ConfigService);
    const ingestion = app.get(IngestionService);
    const symbol = config.get<string>('SYMBOL', 'BTC/USDC');
    await ingestion.healGaps(symbol);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
