import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Push alerts via ntfy.sh (SPEC §8 watchdogs).
 * Setup: pick a hard-to-guess topic name (it's the only auth on the free tier,
 * e.g. microtrading-lero-x7k2f9), set NTFY_TOPIC in .env, subscribe to the
 * same topic in the ntfy mobile app. Unset topic → alerts log-only.
 * Dedup: identical alert keys are suppressed for 6h so a persistent condition
 * doesn't melt your phone.
 */
@Injectable()
export class AlertsService {
  private readonly log = new Logger(AlertsService.name);
  private readonly lastSent = new Map<string, number>();
  private static readonly DEDUP_MS = 6 * 3_600_000;

  constructor(private readonly config: ConfigService) {}

  async alert(key: string, title: string, message: string, priority: 'default' | 'high' = 'default'): Promise<void> {
    const last = this.lastSent.get(key) ?? 0;
    if (Date.now() - last < AlertsService.DEDUP_MS) return;
    this.lastSent.set(key, Date.now());

    this.log.warn(`ALERT [${key}] ${title}: ${message}`);
    const topic = this.config.get<string>('NTFY_TOPIC');
    if (!topic) return;
    try {
      await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers: { Title: title, Priority: priority, Tags: 'chart_with_upwards_trend' },
        body: message,
      });
    } catch (err) {
      this.log.error(`ntfy push failed: ${String(err)}`);
    }
  }

  /** Informational push (daily summary) — never deduped. */
  async notify(title: string, message: string): Promise<void> {
    this.log.log(`NOTIFY ${title}: ${message}`);
    const topic = this.config.get<string>('NTFY_TOPIC');
    if (!topic) return;
    try {
      await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers: { Title: title, Tags: 'newspaper' },
        body: message,
      });
    } catch (err) {
      this.log.error(`ntfy push failed: ${String(err)}`);
    }
  }
}
