import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { desc, eq, gte, and } from 'drizzle-orm';
import { TIMEFRAME_MS } from '@microtrading/core';
import { DbService } from '../db/db.service.js';
import { journal } from '../db/schema.js';
import { CandleRepository } from '../market-data/candle-repository.js';
import { PaperBrokerService } from '../trading/paper-broker.service.js';
import { AlertsService } from './alerts.service.js';

/**
 * Watchdogs (SPEC §8). Independent of the trading loop — if the loop dies,
 * these still run (same process; a dead PROCESS is caught by Docker's restart
 * policy + the loop-silence alert firing after restart shows the gap).
 */
@Injectable()
export class MonitorService {
  private readonly log = new Logger(MonitorService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly dbs: DbService,
    private readonly repo: CandleRepository,
    private readonly broker: PaperBrokerService,
    private readonly alerts: AlertsService,
  ) {}

  private enabled(): boolean {
    return this.config.get('ENABLE_TRADING_LOOP') === 'true';
  }

  /** Every 15 minutes: data freshness + loop liveness. */
  @Cron('*/15 * * * *')
  async health(): Promise<void> {
    if (!this.enabled()) return;
    try {
      await this.healthChecks();
    } catch (err) {
      // DB down (or similar) — the checks themselves can't run, but the push
      // channel doesn't need the DB. Alert instead of dying silently.
      await this.alerts.alert(
        'infra-down',
        'MicroTrading: INFRA DOWN',
        `Health checks failed: ${String(err).slice(0, 200)}. Is Postgres/Docker running?`,
        'high',
      );
    }
  }

  private async healthChecks(): Promise<void> {
    const symbol = this.config.get<string>('SYMBOL', 'BTC/USDC');
    const now = Date.now();

    const lastTs = await this.repo.latestTimestamp(symbol, '1h');
    if (lastTs === null || now - (lastTs + TIMEFRAME_MS['1h']) > 2 * TIMEFRAME_MS['1h']) {
      await this.alerts.alert(
        'stale-candles',
        'MicroTrading: STALE DATA',
        `Newest closed candle is ${lastTs === null ? 'missing' : `${Math.round((now - lastTs - TIMEFRAME_MS['1h']) / 60000)} min old`}. Loop is fail-closed; check the agent.`,
        'high',
      );
    }

    const lastDecision = await this.dbs.db
      .select()
      .from(journal)
      .where(eq(journal.kind, 'decision'))
      .orderBy(desc(journal.id))
      .limit(1);
    const lastAt = lastDecision[0]?.at.getTime() ?? 0;
    if (now - lastAt > 2 * TIMEFRAME_MS['1h']) {
      await this.alerts.alert(
        'loop-silent',
        'MicroTrading: LOOP SILENT',
        `No decision journaled for ${Math.round((now - lastAt) / 3_600_000)}h — process or scheduler problem.`,
        'high',
      );
    }
  }

  /** Daily 06:00 UTC (08:00 Warsaw summer): P&L summary push. */
  @Cron('0 6 * * *')
  async dailySummary(): Promise<void> {
    if (!this.enabled()) return;
    const symbol = this.config.get<string>('SYMBOL', 'BTC/USDC');
    const state = await this.broker.getOrCreate(symbol, Number(this.config.get('PAPER_INITIAL_CASH', '10000')));
    const lastTs = await this.repo.latestTimestamp(symbol, '1h');
    const candles = lastTs !== null ? await this.repo.fetchSince(symbol, '1h', lastTs) : [];
    const price = candles[0]?.close ?? state.avgEntryPrice;
    const equity = this.broker.equity(state, price);

    const since = new Date(Date.now() - 24 * 3_600_000);
    const fills = await this.dbs.db
      .select()
      .from(journal)
      .where(and(eq(journal.kind, 'fill'), gte(journal.at, since)));

    const pos =
      state.positionQty > 0
        ? `LONG ${state.positionQty.toFixed(5)} @ ${state.avgEntryPrice.toFixed(0)} (stop ${state.stopPrice?.toFixed(0)})`
        : 'flat';
    await this.alerts.notify(
      'MicroTrading daily',
      `Equity ${equity.toFixed(2)} USDC | ${pos} | BTC ${price.toFixed(0)} | fills 24h: ${fills.length}${state.killSwitch ? ' | KILL SWITCH ON' : ''}`,
    );
  }
}
