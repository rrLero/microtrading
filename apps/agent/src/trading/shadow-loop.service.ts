import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DbService } from '../db/db.service.js';
import { journal } from '../db/schema.js';
import { universeSymbols } from '../experiments/universe.js';
import { CandleRepository } from '../market-data/candle-repository.js';
import { IngestionService } from '../market-data/ingestion.service.js';
import { BybitDemoMirrorService } from './bybit-demo-mirror.service.js';
import { PaperBrokerService } from './paper-broker.service.js';
import { TradingLoopService } from './trading-loop.service.js';

/**
 * Shadow paper trading on the rest of the universe (SPEC §7.5 D4,
 * docs/SHADOW-PREREG.md).
 *
 * The SAME TradingLoopService code, one paper account per pair (10,000 USDC
 * each, independent — no shared capital, so §5.4 portfolio risk does not
 * arise). Isolation from the BTC system is by construction, not by filtering:
 * - every row it writes is `shadow-<kind>`, so nothing that reads `decision`,
 *   `fill`, `risk`, `ops` or `equity` (status API, analyst, uptime queries,
 *   calibrate-report, equity chart) can see it;
 * - its broker never mirrors to Bybit demo (would drain the demo wallet and
 *   pollute §6.3 calibration);
 * - it runs at :04, after the BTC tick at :02, and one pair's failure never
 *   stops the others.
 * Kill switch: the CLI sets the flag on every paper_account row, so each shadow
 * account flattens and halts on its own next tick (≤ 1 h), via runOnce.
 */
class ShadowBroker extends PaperBrokerService {
  constructor(dbs: DbService) {
    super(dbs, { mirrorFill: async () => null } as unknown as BybitDemoMirrorService);
  }

  override journalEvent(kind: string, payload: unknown): Promise<number> {
    return super.journalEvent(`shadow-${kind}`, payload);
  }
}

@Injectable()
export class ShadowLoopService {
  private readonly log = new Logger(ShadowLoopService.name);
  private readonly loop: TradingLoopService;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly dbs: DbService,
    repo: CandleRepository,
    ingestion: IngestionService,
  ) {
    // A plain instance, not a provider: Nest's scheduler never sees its @Cron.
    this.loop = new TradingLoopService(config, repo, ingestion, new ShadowBroker(dbs));
  }

  /** The pre-registered universe minus the traded pair (SHADOW-PREREG §1). */
  symbols(): string[] {
    const main = this.config.get<string>('SYMBOL', 'BTC/USDC');
    return universeSymbols().filter((s) => s !== main);
  }

  @Cron('4 * * * *')
  async tick(): Promise<void> {
    if (this.config.get('ENABLE_SHADOW_LOOP') !== 'true' || this.running) return;
    this.running = true;
    try {
      for (const symbol of this.symbols()) {
        try {
          await this.loop.runOnce(symbol);
        } catch (err) {
          this.log.warn(`shadow ${symbol} tick failed (fail-closed for this pair): ${String(err)}`);
          await this.dbs.db
            .insert(journal)
            .values({ kind: 'shadow-ops', payload: { event: 'tick-error', symbol, error: String(err).slice(0, 300) } })
            .catch(() => undefined);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
