import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';

/**
 * Long-running agent entrypoint. Hourly paper loop ticks at minute :02;
 * watchdogs every 15 min; read-only HTTP API on PORT (default 3001).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  const log = new Logger('bootstrap');

  const port = Number(config.get('PORT', '3001'));
  await app.listen(port);

  const enabled = config.get('ENABLE_TRADING_LOOP') === 'true';
  const symbol = config.get<string>('SYMBOL', 'BTC/USDC');
  if (enabled) {
    const family = config.get<string>('STRATEGY_FAMILY', 'donchian-breakout');
    const params = config.get<string>('STRATEGY_PARAMS', '{"entryLookback":40,"exitLookback":10}');
    log.log(`PAPER TRADING LOOP ARMED: ${symbol} | ${family} ${params} | ticks at minute :02 every hour (UTC candles).`);
    log.log(`Watchdogs every 15 min; daily summary 06:00 UTC${config.get('NTFY_TOPIC') ? ' → ntfy push enabled' : ' (NTFY_TOPIC unset — log-only)'}.`);
  } else {
    log.log('Trading loop DISABLED (ENABLE_TRADING_LOOP != true).');
  }
  log.log(`Read-only API: http://localhost:${port}/api/status | /api/journal | /api/equity`);
}

void bootstrap();
