import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../app.module.js';
import { PaperBrokerService } from '../trading/paper-broker.service.js';
import { CandleRepository } from '../market-data/candle-repository.js';
import { btFor, type StrategyFamily } from '../experiments/experiment.service.js';

/**
 * Kill switch (SPEC §4.1.4):  pnpm kill-switch -- on|off
 * 'on' flattens any open position immediately and halts the loop.
 * Drill this monthly during the soak — an untested kill switch is decoration.
 */
async function main(): Promise<void> {
  const [mode] = process.argv.slice(2).filter((a) => a !== '--');
  if (mode !== 'on' && mode !== 'off') {
    console.error('Usage: pnpm kill-switch -- on|off');
    process.exitCode = 1;
    return;
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const config = app.get(ConfigService);
    const broker = app.get(PaperBrokerService);
    const repo = app.get(CandleRepository);
    const symbol = config.get<string>('SYMBOL', 'BTC/USDC');
    const family = config.get<StrategyFamily>('STRATEGY_FAMILY', 'donchian-breakout');

    await broker.setKillSwitch(symbol, mode === 'on');
    if (mode === 'on') {
      const state = await broker.getOrCreate(symbol, Number(config.get('PAPER_INITIAL_CASH', '10000')));
      if (state.positionQty > 0) {
        const lastTs = await repo.latestTimestamp(symbol, '1h');
        const candles = lastTs !== null ? await repo.fetchSince(symbol, '1h', lastTs) : [];
        const price = candles[0]?.close ?? state.avgEntryPrice;
        await broker.sell(symbol, state, price, btFor(family).costs, 'kill-switch flatten');
      }
      console.log('KILL SWITCH ON — flat, loop halted until switched off.');
    } else {
      console.log('Kill switch off — loop resumes on its next tick.');
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
