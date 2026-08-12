import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../app.module.js';
import { CandleRepository } from '../market-data/candle-repository.js';
import { ExperimentService, btFor, type StrategyFamily } from '../experiments/experiment.service.js';

/**
 * Cost-sensitivity sweep:  pnpm cost-sensitivity -- <family> [deployedParamsJson]
 *
 * Reports the break-even taker fee rate — the cost level at which the edge
 * disappears — instead of asserting one tier and arguing about it afterwards.
 * The point is to remove discretion: picking a fee assumption AFTER seeing which
 * one flatters the strategy is exactly the selection bias §7 exists to prevent
 * (Bailey et al., "Statistical Overfitting and Backtest Performance").
 *
 * This is NOT a trial run. It re-evaluates the unchanged pre-registered grid on
 * the unchanged dev window, varying one input constant, and logs nothing. No new
 * configurations, no new selection opportunity, so N is unaffected (SPEC §7.1).
 *
 * Holdout is never touched here — the sweep reads dev data only.
 */

/** §7.4 kills a config below PF 1.1; PF 1.0 is where gross edge is fully eaten. */
const KILL_PF = 1.1;
/**
 * The decision tier is whatever §6.2 currently models — read it, never restate
 * it here. A second copy of this number is a second thing to forget to update
 * when the venue moves, which is exactly how the 0.26% error survived Phase 0.
 */
const decisionRate = (family: StrategyFamily): number => btFor(family).costs.takerFeeRate;
/** §7.4 refuses a go/no-go judgment below this much OOS + paper evidence. */
const MIN_TRADES = 100;

/** Key order in the pre-registered grid is not guaranteed to match the CLI arg. */
const canon = (o: Record<string, number>): string =>
  JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
/** Spans both venues: 0.10% is Bybit EU non-VIP, 0.80% is Kraken L1. */
const RATES = [0.001, 0.0015, 0.002, 0.0026, 0.0035, 0.0038, 0.005, 0.006, 0.008, 0.01];

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const family = args[0] as StrategyFamily | undefined;
  if (!family) {
    console.error('Usage: pnpm cost-sensitivity -- <family> [\'{"entryLookback":40,"exitLookback":10}\']');
    process.exitCode = 1;
    return;
  }
  const deployed = args[1] ? (JSON.parse(args[1]) as Record<string, number>) : null;

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const experiments = app.get(ExperimentService);
    const repo = app.get(CandleRepository);
    const symbol = app.get(ConfigService).get<string>('SYMBOL', 'BTC/USDC');

    const prereg = await experiments.getPreregistration(family);
    if (!prereg) {
      console.error(`REFUSED: no pre-registration for '${family}' (SPEC §7.1).`);
      process.exitCode = 1;
      return;
    }

    const all = await repo.fetchSince(symbol, '1h', 0);
    const dev = all.filter((c) => c.timestamp < prereg.holdoutFrom);
    const nTotal = prereg.grid.length;

    console.log(`=== COST SENSITIVITY — ${family} ===`);
    console.log(`Grid: ${nTotal} pre-registered configs (UNCHANGED). Dev window ends ${new Date(prereg.holdoutFrom).toISOString().slice(0, 10)}; holdout SEALED.`);
    console.log(`Slippage held at the modelled rate; only takerFeeRate varies.\n`);

    const header = deployed ? `deployed ${JSON.stringify(deployed)}` : 'deployed n/a';
    console.log(`taker%  | best-in-grid config                     | PF    | trades | net%   || ${header}`);

    const bestPfAt = new Map<number, number>();
    const deployedPfAt = new Map<number, number>();

    for (const takerFeeRate of RATES) {
      const costs = { takerFeeRate, slippageRate: 0.0003 };
      let best: { params: Record<string, number>; pf: number; trades: number; net: number } | null = null;
      let dep: { pf: number; trades: number } | null = null;

      for (const params of prereg.grid) {
        const { metrics } = experiments.evaluateConfig(family, params, dev, nTotal, costs);
        const pf = Number.isFinite(metrics.profitFactor) ? metrics.profitFactor : 0;
        if (!best || pf > best.pf) best = { params, pf, trades: metrics.nTrades, net: metrics.netReturnPct };
        if (deployed && canon(params) === canon(deployed)) dep = { pf, trades: metrics.nTrades };
      }
      if (!best) continue;
      bestPfAt.set(takerFeeRate, best.pf);
      if (dep) deployedPfAt.set(takerFeeRate, dep.pf);

      const depCol = dep ? `PF ${dep.pf.toFixed(2)} (${dep.trades} trades)` : '—';
      console.log(
        `${(takerFeeRate * 100).toFixed(2).padStart(6)}  | ${JSON.stringify(best.params).padEnd(39)} | ` +
          `${best.pf.toFixed(2).padStart(5)} | ${String(best.trades).padStart(6)} | ${best.net.toFixed(1).padStart(6)} || ${depCol}`,
      );
    }

    console.log('\n--- break-even ---');
    report('best-in-grid', bestPfAt);
    if (deployedPfAt.size) report(`deployed ${JSON.stringify(deployed)}`, deployedPfAt);

    console.log('\n--- venue reference (verified 2026-08-12) ---');
    console.log('  Bybit EU non-VIP spot: 0.10% taker  <- EXECUTION venue (§2.1)');
    console.log('  Kraken standard-crypto: L1 0.80% / L2 0.60% / L3 0.38% / L4 0.35% / L5 0.30%  <- DATA venue only');

    // The whole grid at the decision tier — so the verdict is evidence, not inference.
    const DECISION_RATE = decisionRate(family);
    console.log(`\n--- EVERY pre-registered config at the modelled tier (${(DECISION_RATE * 100).toFixed(2)}% taker) ---`);
    console.log('config                                   | PF    | trades | net%   | verdict');
    let survivors = 0;
    let maxTrades = 0;
    for (const params of prereg.grid) {
      const { metrics } = experiments.evaluateConfig(family, params, dev, nTotal, {
        takerFeeRate: DECISION_RATE,
        slippageRate: 0.0003,
      });
      const pf = Number.isFinite(metrics.profitFactor) ? metrics.profitFactor : 0;
      const pass = pf >= KILL_PF;
      if (pass) survivors++;
      maxTrades = Math.max(maxTrades, metrics.nTrades);
      console.log(
        `${JSON.stringify(params).padEnd(40)} | ${pf.toFixed(2).padStart(5)} | ${String(metrics.nTrades).padStart(6)} | ` +
          `${metrics.netReturnPct.toFixed(1).padStart(6)} | ${pass ? 'survives' : `FAILS (PF < ${KILL_PF})`}`,
      );
    }
    console.log(`\n  ${survivors}/${prereg.grid.length} configs clear the §7.4 kill line at the decision tier.`);
    if (maxTrades < MIN_TRADES) {
      console.log(
        `  §7.4 EVIDENCE FLOOR NOT MET: best config has ${maxTrades} OOS trades, minimum is ${MIN_TRADES}.\n` +
          `  A formal go/no-go verdict is not yet licensed — report the direction, do not declare the kill.`,
      );
    }
    console.log('  Holdout NOT evaluated: §7.2 burns it once, and nothing has earned it.');
  } finally {
    await app.close();
  }
}

/** Linear interpolation between the bracketing sweep points — the grid is coarse, so this is an estimate, not a root-find. */
function crossing(pfAt: Map<number, number>, threshold: number): string {
  const pts = [...pfAt.entries()].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < pts.length; i++) {
    const [r0, p0] = pts[i - 1]!;
    const [r1, p1] = pts[i]!;
    if (p0 >= threshold && p1 < threshold) {
      const rate = r0 + ((p0 - threshold) / (p0 - p1)) * (r1 - r0);
      return `${(rate * 100).toFixed(3)}%`;
    }
  }
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (first[1] < threshold) return `below ${(first[0] * 100).toFixed(2)}% (fails at every rate swept)`;
  if (last[1] >= threshold) return `above ${(last[0] * 100).toFixed(2)}% (survives every rate swept)`;
  return 'indeterminate';
}

function report(label: string, pfAt: Map<number, number>): void {
  console.log(`  ${label}:`);
  console.log(`    PF falls below §7.4 kill line (${KILL_PF}) at taker ≈ ${crossing(pfAt, KILL_PF)}`);
  console.log(`    PF falls below 1.00 (no gross edge)  at taker ≈ ${crossing(pfAt, 1)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
