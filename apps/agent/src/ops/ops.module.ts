import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { TradingModule } from '../trading/trading.module.js';
import { AlertsService } from './alerts.service.js';
import { MonitorService } from './monitor.service.js';
import { StatusController } from './status.controller.js';

@Module({
  imports: [MarketDataModule, TradingModule],
  providers: [AlertsService, MonitorService],
  controllers: [StatusController],
  exports: [AlertsService],
})
export class OpsModule {}
