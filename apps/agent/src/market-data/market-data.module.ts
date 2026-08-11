import { Module } from '@nestjs/common';
import { CandleRepository } from './candle-repository.js';
import { IngestionService } from './ingestion.service.js';

@Module({
  providers: [CandleRepository, IngestionService],
  exports: [CandleRepository, IngestionService],
})
export class MarketDataModule {}
