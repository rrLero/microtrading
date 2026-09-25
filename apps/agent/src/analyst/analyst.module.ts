import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { AnalystService } from './analyst.service.js';

/** Deliberately does NOT import TradingModule: the analyst has no path to the broker (PHASE4-PREREG §8). */
@Module({
  imports: [MarketDataModule],
  providers: [AnalystService],
})
export class AnalystModule {}
