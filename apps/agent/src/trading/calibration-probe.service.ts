import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';
import { journal, paperAccount } from '../db/schema.js';
import { btFor, type StrategyFamily } from '../experiments/experiment.service.js';
import { IngestionService } from '../market-data/ingestion.service.js';
import { BybitDemoMirrorService } from './bybit-demo-mirror.service.js';

/**
 * Daily §6.3 calibration probe.
 *
 * donchian-breakout(40,10) fills 1-2× a month, so the calibration sample grows
 * far slower than the gate's ≥2-week requirement implies. This runs one tiny
 * buy→sell round trip a day against the Bybit demo book at the strategy's
 * notional, producing 2 comparison pairs/day instead of ~2/month.
 *
 * Isolation (AGENTS.md): the probe NEVER touches paper_account — no cash, no
 * position, no equity point, no decision row. It cannot move the soak's P&L,
 * and its worst failure mode is a missing journal row.
 *
 * Kill-switch aware: when the switch is on the agent is meant to be doing
 * nothing at a venue, probe included.
 */
@Injectable()
export class CalibrationProbeService {
  private readonly log = new Logger(CalibrationProbeService.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly dbs: DbService,
    private readonly ingestion: IngestionService,
    private readonly mirror: BybitDemoMirrorService,
  ) {}

  // 13:37 UTC daily — deliberately off :02 so it can never overlap the trading loop.
  @Cron('37 13 * * *')
  async scheduled(): Promise<void> {
    if (this.config.get('ENABLE_CALIBRATION_PROBE') !== 'true') return;
    await this.runOnce('scheduled');
  }

  // Hourly at :07 — off the :02 trading tick. Spread is a distribution that moves
  // intraday, so a daily reading would characterise nothing.
  @Cron('7 * * * *')
  async scheduledSpread(): Promise<void> {
    if (this.config.get('ENABLE_CALIBRATION_PROBE') !== 'true') return;
    await this.sampleSpread();
  }

  /**
   * The slippage half of §6.3, measured where it is actually measurable.
   *
   * Bybit demo fills market orders at last price with zero spread at any size
   * we trade (verified 2026-08-11 at 1k and 10k USDC), so it cannot validate
   * slippage at all. But §6.2 defines slippage as max(half-spread, 0.03%) — and
   * half-spread is directly observable on the venue we actually model costs for,
   * with a public read-only quote and no orders whatsoever.
   *
   * Samples EXECUTION_VENUE, not the data venue: since 2026-08-12 we model Bybit
   * costs (§2.1), and Kraken's book says nothing about what a Bybit fill costs.
   * ponytail: reads global Bybit's public book, while §2.1 names Bybit EU as the
   * live target — the EU book is thinner (BTC/USDC ~$7.7M/24h vs global), so this
   * sample is a LOWER BOUND on the EU half-spread. Point it at the EU host if
   * that gap ever matters more than the 0.03% floor that currently dominates.
   *
   * This only RECORDS evidence; it changes no gate and places nothing.
   * Never throws — it is a cron, and a missing sample is not an incident.
   */
  async sampleSpread(): Promise<void> {
    try {
      const symbol = this.config.get<string>('SYMBOL', 'BTC/USDC');
      const family = this.config.get<StrategyFamily>('STRATEGY_FAMILY', 'donchian-breakout');
      const modeledSlippageRate = btFor(family).costs.slippageRate;

      const ex = this.ingestion.createExchange(this.config.get<string>('EXECUTION_VENUE', 'bybit'));
      const t = await ex.fetchTicker(symbol);
      const bid = t.bid ?? null;
      const ask = t.ask ?? null;
      if (!bid || !ask || !(ask > bid)) {
        this.log.warn(`No usable bid/ask for ${symbol} on ${ex.id} — spread sample skipped.`);
        return;
      }
      const mid = (bid + ask) / 2;
      const halfSpreadRate = (ask - bid) / 2 / mid;

      await this.dbs.db.insert(journal).values({
        kind: 'ops',
        payload: {
          event: 'spread-sample',
          venue: ex.id,
          symbol,
          bid,
          ask,
          mid,
          halfSpreadRate,
          modeledSlippageRate,
          // §6.2's rule: the model should charge whichever is worse.
          specSlippageRate: Math.max(halfSpreadRate, modeledSlippageRate),
        },
      });
      this.log.log(
        `Spread sample ${ex.id} ${symbol}: half-spread ${(halfSpreadRate * 100).toFixed(4)}% vs modeled ${(modeledSlippageRate * 100).toFixed(4)}%`,
      );
    } catch (err) {
      this.log.warn(`Spread sample failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Also callable from the CLI for an on-demand probe / drill. Never throws. */
  async runOnce(trigger: 'scheduled' | 'manual'): Promise<void> {
    if (this.running) {
      this.log.warn('Previous probe still running — skipping.');
      return;
    }
    this.running = true;
    try {
      const symbol = this.config.get<string>('SYMBOL', 'BTC/USDC');
      const rows = await this.dbs.db.select().from(paperAccount).where(eq(paperAccount.symbol, symbol));
      if (rows[0]?.killSwitch === 'on') {
        this.log.warn('Kill switch is ON — skipping calibration probe.');
        await this.journalProbe({ event: 'probe-skip-kill-switch', symbol, trigger });
        return;
      }

      const family = this.config.get<StrategyFamily>('STRATEGY_FAMILY', 'donchian-breakout');
      const costs = btFor(family).costs;
      const notionalUsdc = Number(this.config.get('CALIBRATION_PROBE_NOTIONAL_USDC', '1000'));
      if (!Number.isFinite(notionalUsdc) || notionalUsdc <= 0) {
        this.log.error(`Invalid CALIBRATION_PROBE_NOTIONAL_USDC (${notionalUsdc}) — skipping.`);
        return;
      }

      const probeId = await this.journalProbe({ event: 'calibration-probe', symbol, trigger, notionalUsdc, costs });
      this.log.log(`Calibration probe #${probeId}: ${notionalUsdc} USDC round trip on ${symbol} (demo).`);
      await this.mirror.probeRoundTrip({ symbol, notionalUsdc, costs, probeId });
    } catch (err) {
      // Belt and braces: probeRoundTrip already swallows, but a DB hiccup here
      // must not take down the scheduler.
      this.log.error(`Calibration probe failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  private async journalProbe(payload: object): Promise<number> {
    const rows = await this.dbs.db.insert(journal).values({ kind: 'ops', payload }).returning({ id: journal.id });
    return rows[0]!.id;
  }
}
