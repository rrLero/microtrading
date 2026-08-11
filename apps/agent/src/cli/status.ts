import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { desc } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { DbService } from '../db/db.service.js';
import { journal } from '../db/schema.js';
import { PaperBrokerService } from '../trading/paper-broker.service.js';
import { CandleRepository } from '../market-data/candle-repository.js';

/** Paper account status + recent journal:  pnpm status */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const config = app.get(ConfigService);
    const broker = app.get(PaperBrokerService);
    const repo = app.get(CandleRepository);
    const dbs = app.get(DbService);
    const symbol = config.get<string>('SYMBOL', 'BTC/USDC');

    const state = await broker.getOrCreate(symbol, Number(config.get('PAPER_INITIAL_CASH', '10000')));
    const lastTs = await repo.latestTimestamp(symbol, '1h');
    const lastCandles = lastTs !== null ? await repo.fetchSince(symbol, '1h', lastTs) : [];
    const price = lastCandles[0]?.close ?? state.avgEntryPrice;

    console.log(`=== PAPER ACCOUNT: ${symbol} ===`);
    console.log(`Kill switch : ${state.killSwitch ? 'ON (halted)' : 'off'}`);
    console.log(`Cash        : ${state.cash.toFixed(2)} USDC`);
    if (state.positionQty > 0) {
      const mtm = state.positionQty * price;
      const upnl = mtm - state.positionQty * state.avgEntryPrice;
      console.log(`Position    : ${state.positionQty.toFixed(6)} BTC @ ${state.avgEntryPrice.toFixed(2)} (stop ${state.stopPrice?.toFixed(2) ?? '—'})`);
      console.log(`Unrealized  : ${upnl.toFixed(2)} USDC (mark ${price.toFixed(2)})`);
    } else {
      console.log('Position    : flat');
    }
    console.log(`Equity      : ${broker.equity(state, price).toFixed(2)} USDC`);
    console.log(`Last candle : ${lastTs !== null ? new Date(lastTs).toISOString() : 'none'}`);

    const recent = await dbs.db.select().from(journal).orderBy(desc(journal.id)).limit(10);
    console.log(`\n=== LAST ${recent.length} JOURNAL ENTRIES ===`);
    for (const r of recent.reverse()) {
      console.log(`${r.at.toISOString()} [${r.kind}] ${JSON.stringify(r.payload).slice(0, 140)}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
