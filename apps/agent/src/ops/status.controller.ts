import { Controller, Get, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { desc, eq, gte, and } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';
import { journal } from '../db/schema.js';
import { CandleRepository } from '../market-data/candle-repository.js';
import { PaperBrokerService } from '../trading/paper-broker.service.js';

/**
 * READ-ONLY HTTP API (SPEC Phase 3) — feeds the dashboard.
 * Deliberately no mutating endpoints: the kill switch stays CLI-only
 * (read-only dashboard is a security boundary, SPEC stack decision).
 */
@Controller('api')
export class StatusController {
  constructor(
    private readonly config: ConfigService,
    private readonly dbs: DbService,
    private readonly repo: CandleRepository,
    private readonly broker: PaperBrokerService,
  ) {}

  @Get('status')
  async status() {
    const symbol = this.config.get<string>('SYMBOL', 'BTC/USDC');
    const state = await this.broker.getOrCreate(symbol, Number(this.config.get('PAPER_INITIAL_CASH', '10000')));
    const lastTs = await this.repo.latestTimestamp(symbol, '1h');
    const candles = lastTs !== null ? await this.repo.fetchSince(symbol, '1h', lastTs) : [];
    const price = candles[0]?.close ?? state.avgEntryPrice;
    return {
      symbol,
      loopEnabled: this.config.get('ENABLE_TRADING_LOOP') === 'true',
      killSwitch: state.killSwitch,
      cash: state.cash,
      position:
        state.positionQty > 0
          ? { qty: state.positionQty, avgEntry: state.avgEntryPrice, stop: state.stopPrice, openedAt: state.openedAt }
          : null,
      markPrice: price,
      equity: this.broker.equity(state, price),
      lastCandleTs: lastTs,
      strategy: {
        family: this.config.get('STRATEGY_FAMILY', 'donchian-breakout'),
        params: JSON.parse(this.config.get<string>('STRATEGY_PARAMS', '{}')),
      },
    };
  }

  @Get('journal')
  async recentJournal(@Query('limit') limit?: string, @Query('kind') kind?: string) {
    const n = Math.min(Number(limit ?? 50) || 50, 500);
    const rows = kind
      ? await this.dbs.db.select().from(journal).where(eq(journal.kind, kind)).orderBy(desc(journal.id)).limit(n)
      : await this.dbs.db.select().from(journal).orderBy(desc(journal.id)).limit(n);
    return rows;
  }

  @Get('equity')
  async equityHistory(@Query('hours') hours?: string) {
    const h = Math.min(Number(hours ?? 720) || 720, 8760);
    const since = new Date(Date.now() - h * 3_600_000);
    const rows = await this.dbs.db
      .select()
      .from(journal)
      .where(and(eq(journal.kind, 'equity'), gte(journal.at, since)))
      .orderBy(journal.id);
    return rows.map((r) => r.payload);
  }
}
