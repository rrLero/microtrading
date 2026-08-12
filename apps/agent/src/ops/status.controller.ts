import { Controller, Get, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { desc, eq, gte, and } from 'drizzle-orm';
import { aggregate1hTo4h, donchianBounds, TIMEFRAME_MS } from '@microtrading/core';
import { DbService } from '../db/db.service.js';
import { journal } from '../db/schema.js';
import { CandleRepository } from '../market-data/candle-repository.js';
import { PaperBrokerService } from '../trading/paper-broker.service.js';
import { btFor, type StrategyFamily } from '../experiments/experiment.service.js';

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
    const family = this.config.get<StrategyFamily>('STRATEGY_FAMILY', 'donchian-breakout');
    const params = JSON.parse(this.config.get<string>('STRATEGY_PARAMS', '{}')) as Record<string, number>;

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
      /** What the account opened with — the only honest baseline for the equity chart. */
      initialCash: Number(this.config.get('PAPER_INITIAL_CASH', '10000')),
      lastCandleTs: lastTs,
      strategy: { family, params },
      channel: await this.channel(symbol, params, price),
      costs: {
        venue: this.config.get<string>('EXECUTION_VENUE', 'bybit'),
        ...btFor(family).costs,
      },
      health: await this.health(),
      spread: await this.spreadCoverage(),
    };
  }

  /**
   * The corridor the strategy is watching, and how far price sits from each
   * edge. For a breakout family that is flat most of the time, this is the only
   * number that changes meaningfully day to day — the dashboard leads with it.
   */
  private async channel(symbol: string, params: Record<string, number>, price: number) {
    const entryLookback = params['entryLookback'] ?? 0;
    const exitLookback = params['exitLookback'] ?? 0;
    if (entryLookback < 2 || exitLookback < 2) return null;

    // Enough 1h history to build the entry channel with margin, nothing more.
    const need = (entryLookback + 4) * 4;
    const lastTs = await this.repo.latestTimestamp(symbol, '1h');
    if (lastTs === null) return null;
    const candles1h = await this.repo.fetchSince(symbol, '1h', lastTs - need * TIMEFRAME_MS['1h']);
    const bounds = donchianBounds(aggregate1hTo4h(candles1h), entryLookback, exitLookback);
    if (!bounds) return null;

    return {
      upper: bounds.upper,
      lower: bounds.lower,
      lastClose4h: bounds.close,
      entryLookback,
      exitLookback,
      // Signed: negative means price is already through the edge.
      toEntryPct: ((bounds.upper - price) / price) * 100,
      toExitPct: ((price - bounds.lower) / price) * 100,
    };
  }

  /**
   * Worst half-spread in the latest sweep against the modelled floor.
   *
   * §6.2 charges max(half-spread, 0.03%). While every pair sits under the floor
   * the model is pessimistic; the first pair to cross it makes paper results
   * optimistic, which is the direction that hurts. ADA has been running at ~90%
   * of the floor, so this is a margin worth watching rather than a formality.
   */
  private async spreadCoverage() {
    const rows = await this.dbs.db
      .select({ at: journal.at, payload: journal.payload })
      .from(journal)
      .where(eq(journal.kind, 'ops'))
      .orderBy(desc(journal.id))
      .limit(120);
    const samples = rows.filter((r) => (r.payload as Record<string, unknown>)['event'] === 'spread-sample');
    if (samples.length === 0) return null;

    // The most recent sweep only — one batch, written in a single insert.
    const newestAt = samples[0]!.at.getTime();
    const batch = samples
      .filter((r) => newestAt - r.at.getTime() < 60_000)
      .map((r) => r.payload as { symbol: string; halfSpreadRate: number; modeledSlippageRate: number });
    if (batch.length === 0) return null;

    const worst = batch.reduce((a, b) => (b.halfSpreadRate > a.halfSpreadRate ? b : a));
    const modeled = worst.modeledSlippageRate;
    return {
      pairs: batch.length,
      at: samples[0]!.at.toISOString(),
      modeledSlippageRate: modeled,
      worstSymbol: worst.symbol,
      worstHalfSpreadRate: worst.halfSpreadRate,
      /** 1.0 means the worst pair is exactly at the floor; above 1.0 the model under-charges. */
      worstUtilisation: modeled > 0 ? worst.halfSpreadRate / modeled : 0,
      breaches: batch.filter((b) => b.halfSpreadRate > modeled).map((b) => b.symbol),
    };
  }

  /** Liveness the dashboard can show without the operator reading logs. */
  private async health() {
    const latest = async (kind: string, event?: string): Promise<string | null> => {
      const rows = await this.dbs.db
        .select({ at: journal.at, payload: journal.payload })
        .from(journal)
        .where(eq(journal.kind, kind))
        .orderBy(desc(journal.id))
        .limit(60);
      const hit = event ? rows.find((r) => (r.payload as Record<string, unknown>)['event'] === event) : rows[0];
      return hit ? hit.at.toISOString() : null;
    };
    return {
      lastDecisionAt: await latest('decision'),
      lastSpreadSampleAt: await latest('ops', 'spread-sample'),
      lastProbeAt: await latest('ops', 'calibration-probe'),
      serverNow: new Date().toISOString(),
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
