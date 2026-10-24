import { Controller, Get, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { desc, eq, gte, and, inArray, sql } from 'drizzle-orm';
import { aggregate1hTo4h, donchianBounds, TIMEFRAME_MS } from '@microtrading/core';
import { DbService } from '../db/db.service.js';
import { journal, paperAccount } from '../db/schema.js';
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
    // Filter by event in SQL. The old 60-row scan reported the daily probe as
    // "never" — the spread sampler writes 10 ops rows an hour, so anything
    // rarer than ~6-hourly fell out of the window (found on the dashboard 2026-08-25).
    const latest = async (kind: string, event?: string): Promise<string | null> => {
      const where = event
        ? and(eq(journal.kind, kind), sql`${journal.payload}->>'event' = ${event}`)
        : eq(journal.kind, kind);
      const rows = await this.dbs.db.select({ at: journal.at }).from(journal).where(where).orderBy(desc(journal.id)).limit(1);
      return rows[0] ? rows[0].at.toISOString() : null;
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
      : await this.dbs.db
          .select()
          .from(journal)
          .where(sql`${journal.kind} not like 'shadow-%'`) // D4 rows: ~20/h, would bury the traded pair's feed
          .orderBy(desc(journal.id))
          .limit(n);
    return rows;
  }

  /**
   * D4 combined equity: the nine shadow accounts summed per candle. Only hours
   * where every account reported count — a missing pair must not read as a loss.
   */
  @Get('shadow-equity')
  async shadowEquity(@Query('hours') hours?: string) {
    const h = Math.min(Number(hours ?? 720) || 720, 8760);
    const since = new Date(Date.now() - h * 3_600_000);
    const main = this.config.get<string>('SYMBOL', 'BTC/USDC');
    const n = (await this.dbs.db.select({ s: paperAccount.symbol }).from(paperAccount)).filter((a) => a.s !== main).length;
    const rows = await this.dbs.db
      .select({
        ts: sql<number>`(${journal.payload}->>'ts')::bigint`,
        equity: sql<number>`sum((${journal.payload}->>'equity')::float8)`,
        accounts: sql<number>`count(*)`,
      })
      .from(journal)
      .where(and(eq(journal.kind, 'shadow-equity'), gte(journal.at, since)))
      .groupBy(sql`(${journal.payload}->>'ts')::bigint`)
      .orderBy(sql`(${journal.payload}->>'ts')::bigint`);
    return {
      accounts: n,
      start: n * Number(this.config.get('PAPER_INITIAL_CASH', '10000')),
      points: rows.filter((r) => Number(r.accounts) === n).map((r) => ({ ts: Number(r.ts), equity: Number(r.equity) })),
    };
  }

  /** Every paper fill — the traded pair and the D4 shadow accounts — newest first. */
  @Get('trades')
  async trades(@Query('limit') limit?: string) {
    const n = Math.min(Number(limit ?? 50) || 50, 500);
    const rows = await this.dbs.db
      .select()
      .from(journal)
      .where(inArray(journal.kind, ['fill', 'shadow-fill']))
      .orderBy(desc(journal.id))
      .limit(n);
    return rows.map((r) => {
      const p = r.payload as Record<string, unknown>;
      return {
        id: r.id,
        at: r.at,
        shadow: r.kind === 'shadow-fill',
        symbol: p['symbol'] ?? null,
        side: p['side'] ?? null,
        quantity: p['quantity'] ?? null,
        fillPrice: p['fillPrice'] ?? null,
        pnlNet: p['pnlNet'] ?? null,
        reason: p['reason'] ?? null,
      };
    });
  }

  /** D4 shadow paper accounts (docs/SHADOW-PREREG.md): one row per pair, plus pooled round trips. */
  @Get('shadow')
  async shadow() {
    const main = this.config.get<string>('SYMBOL', 'BTC/USDC');
    const params = JSON.parse(this.config.get<string>('STRATEGY_PARAMS', '{}')) as Record<string, number>;
    const accounts = (await this.dbs.db.select().from(paperAccount)).filter((a) => a.symbol !== main);
    const lastPrice = async (symbol: string) => {
      const ts = await this.repo.latestTimestamp(symbol, '1h');
      return ts !== null ? ((await this.repo.fetchSince(symbol, '1h', ts))[0]?.close ?? null) : null;
    };
    const sells = await this.dbs.db
      .select({ payload: journal.payload, at: journal.at })
      .from(journal)
      .where(and(eq(journal.kind, 'shadow-fill'), sql`${journal.payload}->>'side' = 'sell'`))
      .orderBy(desc(journal.id));
    const pnls = sells.map((r) => Number((r.payload as { pnlNet?: number }).pnlNet ?? 0));
    const [lastTick] = await this.dbs.db
      .select({ at: journal.at })
      .from(journal)
      .where(eq(journal.kind, 'shadow-decision'))
      .orderBy(desc(journal.id))
      .limit(1);
    return {
      enabled: this.config.get('ENABLE_SHADOW_LOOP') === 'true',
      lastTickAt: lastTick?.at ?? null,
      roundTrips: pnls.length,
      wins: pnls.filter((x) => x > 0).length,
      netPnl: pnls.reduce((a, b) => a + b, 0),
      recentTrades: sells.slice(0, 10).map((r) => ({ at: r.at, ...(r.payload as object) })),
      accounts: await Promise.all(
        accounts.map(async (a) => {
          const price = await lastPrice(a.symbol);
          const channel = price !== null ? await this.channel(a.symbol, params, price) : null;
          return {
            symbol: a.symbol,
            toEntryPct: channel?.toEntryPct ?? null,
            toExitPct: channel?.toExitPct ?? null,
            cash: a.cash,
            positionQty: a.positionQty,
            avgEntryPrice: a.avgEntryPrice,
            stopPrice: a.stopPrice,
            markPrice: price,
            equity: a.cash + a.positionQty * (price ?? a.avgEntryPrice),
            killSwitch: a.killSwitch === 'on',
          };
        }),
      ),
    };
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
