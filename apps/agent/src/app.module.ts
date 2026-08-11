import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from './db/db.module.js';
import { MarketDataModule } from './market-data/market-data.module.js';
import { ExperimentsModule } from './experiments/experiments.module.js';
import { TradingModule } from './trading/trading.module.js';
import { OpsModule } from './ops/ops.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DbModule,
    MarketDataModule,
    ExperimentsModule,
    TradingModule,
    OpsModule,
  ],
})
export class AppModule {}
