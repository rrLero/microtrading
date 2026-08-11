import 'reflect-metadata';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { TIMEFRAME_MS, isClosed, type Timeframe } from '@microtrading/core';
import { AppModule } from '../app.module.js';
import { CandleRepository, type CandleRow } from '../market-data/candle-repository.js';
import { IngestionService } from '../market-data/ingestion.service.js';

/**
 * Kraken OHLCVT CSV import:  pnpm import-csv -- <file.csv> [symbol]
 *
 * Kraken's REST API only serves ~720 recent candles per timeframe; deep history
 * (2019+) comes from their downloadable OHLCVT archives:
 * https://support.kraken.com/articles/360047124832
 * Use the *_60.csv files (60-minute candles). Format per line:
 *   timestamp(seconds),open,high,low,close,volume,trades
 */
async function main(): Promise<void> {
  const [file, symbolArg] = process.argv.slice(2).filter((a) => a !== '--');
  if (!file) {
    console.error('Usage: pnpm import-csv -- <kraken_ohlcvt_60.csv> [symbol]');
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  try {
    const config = app.get(ConfigService);
    const repo = app.get(CandleRepository);
    const ingestion = app.get(IngestionService);
    const symbol = symbolArg ?? config.get<string>('SYMBOL', 'BTC/USDC');
    const tf: Timeframe = '1h';
    const now = Date.now();

    const rows: CandleRow[] = [];
    let skipped = 0;
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      const parts = line.split(',');
      if (parts.length < 6) continue;
      const tsSec = Number(parts[0]);
      const ts = tsSec * 1000;
      if (!Number.isFinite(ts) || ts % TIMEFRAME_MS[tf] !== 0 || !isClosed(ts, tf, now)) {
        skipped++;
        continue;
      }
      rows.push({
        symbol,
        timeframe: tf,
        source: 'kraken-csv',
        timestamp: ts,
        open: Number(parts[1]),
        high: Number(parts[2]),
        low: Number(parts[3]),
        close: Number(parts[4]),
        volume: Number(parts[5]),
      });
    }

    await repo.upsertMany(rows);
    console.log(`Imported ${rows.length} 1h candles for ${symbol} (skipped ${skipped} lines).`);
    const earliest = rows.length > 0 ? Math.min(...rows.map((r) => r.timestamp)) : Date.now();
    await ingestion.rebuild4h(symbol, earliest);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
