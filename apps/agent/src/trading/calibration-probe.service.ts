import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';
import { journal, paperAccount } from '../db/schema.js';
import { btFor, type StrategyFamily } from '../experiments/experiment.service.js';
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
    private readonly mirror: BybitDemoMirrorService,
  ) {}

  // 13:37 UTC daily — deliberately off :02 so it can never overlap the trading loop.
  @Cron('37 13 * * *')
  async scheduled(): Promise<void> {
    if (this.config.get('ENABLE_CALIBRATION_PROBE') !== 'true') return;
    await this.runOnce('scheduled');
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
