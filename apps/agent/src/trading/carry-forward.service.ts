import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import ccxt from 'ccxt';
import { DbService } from '../db/db.service.js';
import { journal } from '../db/schema.js';
import { WARMUP_MS, ingestFunding, v3Registration, v3Snapshot, v3Symbols } from '../experiments/carry-registry.js';
import { CandleRepository } from '../market-data/candle-repository.js';
import { IngestionService } from '../market-data/ingestion.service.js';

/**
 * V3 forward carry (SPEC §7.5 D6). Nothing trades: every hour at :09 (clear of the
 * :02/:04/:07 ticks) it ingests the twenty USDT symbols and journals a deterministic
 * snapshot computed by the same core engine the verdict uses. One symbol failing
 * never stops the others, and nothing here can touch the paper or demo loops.
 */
@Injectable()
export class CarryForwardService {
  private readonly log = new Logger(CarryForwardService.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly dbs: DbService,
    private readonly repo: CandleRepository,
    private readonly ingestion: IngestionService,
  ) {}

  @Cron('9 * * * *')
  async tick(): Promise<void> {
    if (this.config.get('ENABLE_CARRY_FORWARD') !== 'true' || this.running) return;
    this.running = true;
    try {
      const reg = await v3Registration(this.dbs);
      if (!reg) return;
      const ex = new ccxt.bybit({ enableRateLimit: true });
      await ex.loadMarkets();
      const since = reg.startTs - WARMUP_MS;
      const failed: string[] = [];
      for (const s of v3Symbols()) {
        for (const [what, fn] of [
          [s.spot, () => this.ingestion.backfill(s.spot, new Date(since).toISOString(), 'bybit')],
          [s.perp, () => this.ingestion.backfill(s.perp, new Date(since).toISOString(), 'bybit')],
          [`${s.perp} funding`, () => ingestFunding(this.dbs, ex, s.perp, since)],
        ] as const) {
          try {
            await fn();
          } catch (err) {
            failed.push(what);
            this.log.warn(`carry-forward ingest ${what} failed: ${String(err).slice(0, 200)}`);
          }
        }
      }
      if (Date.now() < reg.startTs) return; // warmup only; nothing counts before the start
      const snap = await v3Snapshot(this.dbs, this.repo, reg, Math.min(Date.now(), reg.endTs));
      await this.dbs.db.insert(journal).values({ kind: 'carry-forward', payload: { ...snap, ingestFailures: failed } });
    } catch (err) {
      this.log.warn(`carry-forward tick failed: ${String(err).slice(0, 300)}`);
    } finally {
      this.running = false;
    }
  }
}
