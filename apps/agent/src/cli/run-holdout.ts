import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { assertHoldoutUnspent, computeMetrics, runBacktest } from '@microtrading/core';
import { DbService } from '../db/db.service.js';
import { experiments as experimentsTable } from '../db/schema.js';
import { AppModule } from '../app.module.js';
import { CandleRepository } from '../market-data/candle-repository.js';
import { btFor, ExperimentService, FACTORIES, type StrategyFamily } from '../experiments/experiment.service.js';

/**
 * THE holdout evaluation (SPEC §7.2) — runs EXACTLY ONCE per family, ever.
 *   pnpm run-holdout -- <family> <configIndex> I-UNDERSTAND-THIS-RUNS-ONCE
 * A burned holdout cannot be un-burned; only the calendar grows a new one.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const [family, idxStr, confirm] = args as [StrategyFamily?, string?, string?];
  if (!family || idxStr === undefined || confirm !== 'I-UNDERSTAND-THIS-RUNS-ONCE') {
    console.error('Usage: pnpm run-holdout -- <family> <configIndex> I-UNDERSTAND-THIS-RUNS-ONCE');
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    // C4 + D5 (2026-11-10): ONE holdout evaluation in total, across all families — checked first.
    try {
      assertHoldoutUnspent(
        await app.get(DbService).db.select().from(experimentsTable).where(eq(experimentsTable.kind, 'holdout-evaluation')),
      );
    } catch (e) {
      console.error(`REFUSED: ${(e as Error).message}`);
      process.exitCode = 1;
      return;
    }
    const experiments = app.get(ExperimentService);
    const repo = app.get(CandleRepository);
    const config = app.get(ConfigService);
    const symbol = config.get<string>('SYMBOL', 'BTC/USDC');

    const prereg = await experiments.getPreregistration(family);
    if (!prereg) {
      console.error(`REFUSED: no pre-registration for '${family}'.`);
      process.exitCode = 1;
      return;
    }
    if (await experiments.holdoutAlreadyRun(family)) {
      console.error(`REFUSED: holdout for '${family}' has already been evaluated. It runs once, ever (SPEC §7.2).`);
      process.exitCode = 1;
      return;
    }
    const params = prereg.grid[Number(idxStr)];
    if (!params) {
      console.error(`Config index ${idxStr} not in the pre-registered grid (0..${prereg.grid.length - 1}).`);
      process.exitCode = 1;
      return;
    }

    const all = await repo.fetchSince(symbol, '1h', 0);
    const warmupStart = prereg.holdoutFrom - 720 * 3_600_000;
    const slice = all.filter((c) => c.timestamp >= warmupStart);
    const strategy = FACTORIES[family](params);
    const result = runBacktest(slice, strategy, btFor(family));
    // Trim to holdout: trades entered inside it; returns inside it
    const trades = result.trades.filter((t) => t.entryTs >= prereg.holdoutFrom);
    const curve = result.equityCurve.filter((p) => p.ts >= prereg.holdoutFrom);
    const trimmed = { ...result, trades, equityCurve: curve };
    const metrics = computeMetrics(trimmed, prereg.grid.length);

    await experiments.logHoldoutEvaluation(family, params, metrics);

    console.log(`\n=== HOLDOUT EVALUATION (one-shot): ${family} ${JSON.stringify(params)} ===`);
    console.log(`Window: ${new Date(prereg.holdoutFrom).toISOString().slice(0, 10)} → now`);
    console.log(`Trades: ${metrics.nTrades} | Net: ${metrics.netReturnPct.toFixed(1)}% | PF: ${metrics.profitFactor.toFixed(2)} | MaxDD: ${metrics.maxDrawdownPct.toFixed(1)}%`);
    console.log(`Sharpe: ${metrics.sharpeAnnualized.toFixed(2)} | Deflated Sharpe P[SR>0]: ${metrics.deflatedSharpeProb.toFixed(3)} (needs >0.95 for the live gate)`);
    console.log(`This result is now permanent in the experiments log.`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
