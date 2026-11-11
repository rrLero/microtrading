import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import { HIT_HORIZON_DAYS, HORIZONS_DAYS, RANGE_BAND, calibration, scoreCalls, type ScoredCall } from '@microtrading/core';
import { AppModule } from '../app.module.js';
import { DbService } from '../db/db.service.js';
import { candles, journal } from '../db/schema.js';

/**
 * Is the analyst's regime label informative about BTC's next move?
 *   railway ssh --service agent -- node dist/cli/analyst-score.js
 * Observation only — rules fixed in packages/core/src/analyst-score.ts.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const db = app.get(DbService).db;
    const rows = await db
      .select({ payload: journal.payload })
      .from(journal)
      .where(and(eq(journal.kind, 'analyst'), sql`${journal.payload}->>'trigger' = 'daily'`))
      .orderBy(asc(journal.at));
    const calls = rows.map(({ payload }) => {
      const p = payload as { asOf: number; regime: { label: string; confidence: number } };
      return { asOf: p.asOf, label: p.regime.label, confidence: p.regime.confidence };
    });
    const closes = await db
      .select({ ts: candles.ts, close: candles.close })
      .from(candles)
      .where(and(eq(candles.symbol, 'BTC/USDC'), eq(candles.timeframe, '1h')))
      .orderBy(asc(candles.ts));
    const scored = scoreCalls(calls, closes);

    console.log('=== Analyst score — OBSERVATION ONLY. No strategy reads the label; this is not a trial (N unchanged). ===');
    console.log(`${scored.length} daily calls, ${new Date(calls[0]?.asOf ?? 0).toISOString().slice(0, 10)} → ${new Date(calls.at(-1)?.asOf ?? 0).toISOString().slice(0, 10)}. BTC/USDC 1h closes.`);
    console.log(`Overlapping windows: daily calls with a ${HIT_HORIZON_DAYS}d horizon give ~n/${HIT_HORIZON_DAYS} independent observations.\n`);

    const pct = (v: number | undefined) => (v === undefined ? '     —' : `${(v * 100).toFixed(2).padStart(6)}%`);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
    console.log(`label     calls  conf  ${HORIZONS_DAYS.map((h) => `fwd ${h}d (n)`.padStart(15)).join('')}   hit@${HIT_HORIZON_DAYS}d`);
    const labels = [...new Set(scored.map((c) => c.label))].sort();
    for (const label of [...labels, 'ALL']) {
      const g = scored.filter((c) => label === 'ALL' || c.label === label);
      const cols = HORIZONS_DAYS.map((h) => {
        const xs = g.map((c) => c.fwd[h]).filter((v): v is number => v !== undefined);
        return `${pct(mean(xs))} (${String(xs.length).padStart(2)})`.padStart(15);
      }).join('');
      const judged = g.filter((c: ScoredCall) => c.hit !== undefined);
      const hits = judged.filter((c) => c.hit).length;
      console.log(`${label.padEnd(8)} ${String(g.length).padStart(6)}  ${(mean(g.map((c) => c.confidence)) ?? 0).toFixed(2)}  ${cols}   ${judged.length ? `${hits}/${judged.length}` : '—'}`);
    }

    const cal = calibration(scored);
    console.log(`\nHit rule @${HIT_HORIZON_DAYS}d: bull/rebound r>0, bear r<0, range |r|<${RANGE_BAND * 100}%.`);
    if (!cal) return console.log('No call has a closed 7d horizon yet.');
    console.log(`Calibration (n=${cal.n}): hit rate ${(cal.hitRate * 100).toFixed(1)}%, Brier ${cal.brier.toFixed(3)} vs constant ${cal.brierConstant.toFixed(3)} → skill ${cal.skill.toFixed(3)} (>0 = confidence beats a constant guess).`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
