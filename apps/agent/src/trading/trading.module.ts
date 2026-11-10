import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { ExperimentsModule } from '../experiments/experiments.module.js';
import { BybitDemoMirrorService } from './bybit-demo-mirror.service.js';
import { CalibrationProbeService } from './calibration-probe.service.js';
import { PaperBrokerService } from './paper-broker.service.js';
import { TradingLoopService } from './trading-loop.service.js';
import { ShadowLoopService } from './shadow-loop.service.js';
import { CarryForwardService } from './carry-forward.service.js';

@Module({
  imports: [MarketDataModule, ExperimentsModule],
  providers: [BybitDemoMirrorService, CalibrationProbeService, PaperBrokerService, TradingLoopService, ShadowLoopService, CarryForwardService],
  exports: [BybitDemoMirrorService, CalibrationProbeService, PaperBrokerService, TradingLoopService],
})
export class TradingModule {}
