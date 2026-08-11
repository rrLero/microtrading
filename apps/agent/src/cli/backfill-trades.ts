import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../app.module.js';
import { IngestionService } from '../market-data/ingestion.service.js';

/**
 * Trades-based hole recovery:  pnpm backfill-trades
 * Auto-detects data holes (>48h of missing 1h candles), rebuilds them from
 * Kraken's paginated public trade history (~1 req/s — a multi-month hole
 * takes tens of minutes), then prompts to re-run heal-gaps.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  try {
    const config = app.get(ConfigService);
    const ingestion = app.get(IngestionService);
    const symbol = config.get<string>('SYMBOL', 'BTC/USDC');
    await ingestion.backfillTradesForHoles(symbol);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
