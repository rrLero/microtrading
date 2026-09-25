import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from './db/db.module.js';
import { MarketDataModule } from './market-data/market-data.module.js';
import { ExperimentsModule } from './experiments/experiments.module.js';
import { TradingModule } from './trading/trading.module.js';
import { OpsModule } from './ops/ops.module.js';
import { AnalystModule } from './analyst/analyst.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    MarketDataModule,
    ExperimentsModule,
    TradingModule,
    OpsModule,
    AnalystModule,
  ],
})
export class AppModule {
  /**
   * Crons (hourly tick, :07 spread sample, 13:37 probe, watchdogs) run ONLY in
   * the long-running agent. CLIs boot plain AppModule, so one alive at :02
   * can never tick a second paper loop (AGENTS.md) or place a duplicate probe —
   * the host .env has ENABLE_TRADING_LOOP=true like the container's.
   */
  static withScheduler(): DynamicModule {
    return { module: AppModule, imports: [ScheduleModule.forRoot()] };
  }
}
