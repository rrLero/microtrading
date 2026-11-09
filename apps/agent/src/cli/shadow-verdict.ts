import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { and, gte, inArray, sql } from 'drizzle-orm';
import { recost, roundTrips, verdictStats, type FillRow, type RoundTrip, type VerdictStats } from '@microtrading/core';
import { AppModule } from '../app.module.js';
import { DbService } from '../db/db.service.js';
import { journal } from '../db/schema.js';

/**
 * D4 verdict, docs/SHADOW-PREREG.md §2 — written 2026-11-09 at 8 shadow round
 * trips, before the data exists, so the verdict is one command, not an analysis.
 *   pnpm --filter @microtrading/agent shadow-verdict
 * Prints INTERIM until 100 pooled round trips or 2028-03-28, whichever first.
 */
const FIRST_SHADOW_TICK = Date.UTC(2026, 8, 28, 13, 4); // 2026-09-28 13:04Z, PREREG §1
const DEADLINE = Date.UTC(2028, 2, 28);
const VERDICT_AT_TRADES = 100;
const ACCOUNTS = 10;
const CAPITAL_PER_ACCOUNT = 10_000;
const MODELED_SLIPPAGE = 0.0003; // §6.2, the cost basis the backtest used

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const db = app.get(DbService).db;
    const rows = await db.select().from(journal).where(inArray(journal.kind, ['fill', 'shadow-fill']));
    const fills = (kind: string): FillRow[] =>
      rows.filter((r) => r.kind === kind).map((r) => ({ ...(r.payload as Omit<FillRow, 'at'>), at: r.at.getTime() }));
    // Population: trips that OPEN on or after the first shadow tick, all ten accounts (BTC + nine shadow).
    const trips = [...roundTrips(fills('fill')), ...roundTrips(fills('shadow-fill'))].filter(
      (t) => t.openedAt >= FIRST_SHADOW_TICK,
    );

    const samples = await db
      .select({ payload: journal.payload })
      .from(journal)
      .where(and(gte(journal.at, new Date(FIRST_SHADOW_TICK)), sql`${journal.payload}->>'event' = 'spread-sample'`));
    const bySymbol = new Map<string, number[]>();
    for (const { payload } of samples) {
      const p = payload as { symbol: string; halfSpreadRate: number };
      bySymbol.set(p.symbol, [...(bySymbol.get(p.symbol) ?? []), p.halfSpreadRate]);
    }
    const p90 = (s: string) => {
      const xs = [...(bySymbol.get(s) ?? [])].sort((a, b) => a - b);
      return xs.length ? xs[Math.min(xs.length - 1, Math.floor(0.9 * xs.length))]! : MODELED_SLIPPAGE;
    };
    const recosted: RoundTrip[] = trips.map((t) => recost(t, p90(t.symbol), MODELED_SLIPPAGE));

    const capital = ACCOUNTS * CAPITAL_PER_ACCOUNT;
    const modeled = verdictStats(trips, capital);
    const observed = verdictStats(recosted, capital);
    const final = trips.length >= VERDICT_AT_TRADES || Date.now() >= DEADLINE;

    console.log(final
      ? `=== D4 VERDICT (SHADOW-PREREG §2) — evaluated once; record it in REPORT and WORKLOG ===`
      : `=== INTERIM — NOT THE VERDICT (${trips.length}/${VERDICT_AT_TRADES} trips; deadline 2028-03-28). Nothing is stopped, re-tuned or re-selected on this. ===`);
    if (final && trips.length < VERDICT_AT_TRADES) console.log(`UNDER-POWERED: deadline reached at ${trips.length} trips.`);
    console.log(`Population: round trips opened >= ${new Date(FIRST_SHADOW_TICK).toISOString()}, ${ACCOUNTS} accounts, pooled capital ${capital}. N (trials) = 34.\n`);

    print('Modeled costs (0.10% taker + 0.03% slippage)', modeled);
    print('Re-costed at each pair\'s observed p90 half-spread', observed);
    console.log('p90 half-spread used: ' + [...bySymbol.keys()].sort().map((s) => `${s} ${(p90(s) * 100).toFixed(4)}%`).join(', '));

    const headline = Math.sign(modeled.net) !== Math.sign(observed.net) ? 're-costed (signs disagree — PREREG §2)' : 'modeled (signs agree)';
    console.log(`\nHeadline: ${headline}`);
    // shortcut: §7.4 DD criterion (C3 ii) needs the walk-forward OOS max DD of {40,10}, which no
    // evaluation row stores; read it from `run-universe -- donchian-breakout` (maxDD% column) at verdict time.
    console.log(`DD kill (C3 ii): fires if realized max DD ${observed.maxDrawdownPct.toFixed(2)}% > 2x run-universe maxDD% for {40,10}.`);
  } finally {
    await app.close();
  }
}

function print(title: string, s: VerdictStats): void {
  const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
  console.log(`--- ${title} ---`);
  console.log(`trips ${s.count} · net ${f(s.net)} USDC (${f(s.netReturnPct, 3)}% of pooled capital) · PF ${f(s.profitFactor)} · win rate ${f(s.winRate * 100, 1)}% · max DD ${f(s.maxDrawdownPct)}%`);
  console.log(`best month ${s.bestMonth ?? '—'} · share of net ${Number.isNaN(s.bestMonthShare) ? 'n/a (net <= 0)' : f(s.bestMonthShare * 100, 1) + '%'}`);
  console.log(`§7.4 kills: PF<1.1 over >=100 trips ${s.killProfitFactor ? 'FIRES' : 'no'} · 3 negative months ${s.killThreeMonths ? 'FIRES (' + s.killThreeMonths + ')' : 'no'}`);
  console.log('per pair (a breakdown, never an alternative result):');
  for (const p of s.perPair) console.log(`  ${p.symbol.padEnd(10)} ${String(p.count).padStart(3)} trips  net ${f(p.net).padStart(9)}  PF ${f(p.profitFactor)}`);
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
