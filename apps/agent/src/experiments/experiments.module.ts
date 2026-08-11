import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { ExperimentService } from './experiment.service.js';

@Module({
  imports: [MarketDataModule],
  providers: [ExperimentService],
  exports: [ExperimentService],
})
export class ExperimentsModule {}
