import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { asc, inArray } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { DbService } from '../db/db.service.js';
import { journal } from '../db/schema.js';

/**
 * §6.3 calibration report:  pnpm calibrate-report
 *
 * Pairs every 'demo-fill' journal row with its paper 'fill' (via paperFillId)
 * and compares modeled execution cost against Bybit demo reality:
 *
 *   modeled cost = |paperFillPrice − refPrice| · qty + paperFee     (slippage + fee)
 *   actual  cost = |demoAvgPrice  − refPrice| · demoQty + demoFee
 *
 * Gate (SPEC §6.3): if aggregate modeled costs deviate >30% relative from demo
 * fills over ≥2 weeks of parallel running, fix the PaperAdapter before trusting
 * any paper result. Coverage (skipped/errored mirrors) is reported so the
 * comparison cannot silently overstate itself.
 *
 * Two things the headline number alone will lie to you about:
 *
 * 1. SLIPPAGE vs FEE. The model charges the Kraken taker tier (0.26%); Bybit
 *    demo charges Bybit's (~0.1%). That gap is a venue difference, not a fill-
 *    model error, and on a 1000 USDC trade the fee term is ~8× the slippage
 *    term — so it swamps the aggregate and can fail the gate for the wrong
 *    reason. Both components are therefore broken out; slippage is the part
 *    §6.2's model actually predicts.
 * 2. PROBES vs STRATEGY FILLS. §6.3 asks for identical *signals* through both
 *    paths. Calibration probes are not signals, so they are counted as a
 *    separate population — supporting evidence with a much larger n, never
 *    silently blended into the gate number.
 */

interface DemoFillPayload {
  paperFillId: number;
  probe?: boolean;
  demoAvgPrice: number | null;
  demoFilledQty: number | null;
  demoFeeUsdc: number | null;
  refPrice: number;
  paper: { fillPrice: number; fee: number; reason: string; candleTs: number | null };
  side: 'buy' | 'sell';
}

interface SpreadSample {
  venue: string;
  halfSpreadRate: number;
  modeledSlippageRate: number;
}

interface Pair {
  at: Date;
  side: 'buy' | 'sell';
  qty: number;
  refPrice: number;
  modeledSlip: number;
  modeledFee: number;
  actualSlip: number;
  actualFee: number;
}

const rel = (actual: number, modeled: number): number => (modeled > 0 ? (actual - modeled) / modeled : 0);

/** Print one population's table + aggregates. Returns the aggregate total deviation, or null if empty. */
function report(title: string, pairs: Pair[], incomplete: number): number | null {
  console.log(`\n--- ${title} — ${pairs.length} pair(s) ---`);
  if (incomplete > 0) console.log(`(${incomplete} demo fills lacked price/qty data and were excluded)`);
  if (pairs.length === 0) {
    console.log('No complete pairs yet.');
    return null;
  }
  console.log('side  qty         refPrice    modeled slip+fee   demo slip+fee      total dev');
  for (const p of pairs) {
    const modeled = p.modeledSlip + p.modeledFee;
    const actual = p.actualSlip + p.actualFee;
    console.log(
      `${p.side.padEnd(5)} ${p.qty.toFixed(6).padEnd(11)} ${p.refPrice.toFixed(2).padEnd(11)} ` +
        `${`${p.modeledSlip.toFixed(4)}+${p.modeledFee.toFixed(4)}`.padEnd(18)} ` +
        `${`${p.actualSlip.toFixed(4)}+${p.actualFee.toFixed(4)}`.padEnd(18)} ` +
        `${(rel(actual, modeled) * 100).toFixed(1)}%  (${p.at.toISOString()})`,
    );
  }
  const sum = (f: (p: Pair) => number): number => pairs.reduce((a, p) => a + f(p), 0);
  const mSlip = sum((p) => p.modeledSlip);
  const aSlip = sum((p) => p.actualSlip);
  const mFee = sum((p) => p.modeledFee);
  const aFee = sum((p) => p.actualFee);
  const totalDev = rel(aSlip + aFee, mSlip + mFee);
  const devs = pairs.map((p) => rel(p.actualSlip + p.actualFee, p.modeledSlip + p.modeledFee)).sort((a, b) => a - b);

  console.log(`\n  slippage:  modeled ${mSlip.toFixed(4)}  demo ${aSlip.toFixed(4)}  → ${(rel(aSlip, mSlip) * 100).toFixed(1)}%   <- what §6.2's model predicts`);
  console.log(`  fee:       modeled ${mFee.toFixed(4)}  demo ${aFee.toFixed(4)}  → ${(rel(aFee, mFee) * 100).toFixed(1)}%   <- venue tier difference, not a model error`);
  console.log(`  total:     modeled ${(mSlip + mFee).toFixed(4)}  demo ${(aSlip + aFee).toFixed(4)}  → ${(totalDev * 100).toFixed(1)}%`);
  console.log(`  median per-fill total deviation: ${((devs[Math.floor(devs.length / 2)] ?? 0) * 100).toFixed(1)}%`);
  return totalDev;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const dbs = app.get(DbService);
    const rows = await dbs.db
      .select()
      .from(journal)
      .where(inArray(journal.kind, ['fill', 'demo-fill', 'ops']))
      .orderBy(asc(journal.id));

    const paperFills = new Map<number, { at: Date }>();
    const demoFills: { at: Date; p: DemoFillPayload }[] = [];
    let skippedStale = 0;
    let skippedDisabled = 0;
    let mirrorErrors = 0;
    let probesRun = 0;
    let probesSkipped = 0;
    const spreadSamples: SpreadSample[] = [];

    for (const r of rows) {
      const p = r.payload as Record<string, unknown>;
      if (r.kind === 'fill') paperFills.set(r.id, { at: r.at });
      if (r.kind === 'demo-fill') demoFills.push({ at: r.at, p: p as unknown as DemoFillPayload });
      if (r.kind === 'ops' && p['event'] === 'mirror-skip-stale') skippedStale += 1;
      if (r.kind === 'ops' && p['event'] === 'mirror-skip-disabled') skippedDisabled += 1;
      if (r.kind === 'ops' && p['event'] === 'mirror-error') mirrorErrors += 1;
      if (r.kind === 'ops' && p['event'] === 'calibration-probe') probesRun += 1;
      if (r.kind === 'ops' && (p['event'] === 'probe-skip-disabled' || p['event'] === 'probe-skip-kill-switch')) probesSkipped += 1;
      if (r.kind === 'ops' && p['event'] === 'spread-sample') spreadSamples.push(p as unknown as SpreadSample);
    }

    const strategyPairs: Pair[] = [];
    const probePairs: Pair[] = [];
    let incompleteStrategy = 0;
    let incompleteProbe = 0;

    for (const { at, p } of demoFills) {
      const isProbe = p.probe === true;
      if (p.demoAvgPrice === null || p.demoFilledQty === null) {
        if (isProbe) incompleteProbe += 1;
        else incompleteStrategy += 1;
        continue;
      }
      const qty = p.demoFilledQty;
      (isProbe ? probePairs : strategyPairs).push({
        at,
        side: p.side,
        qty,
        refPrice: p.refPrice,
        modeledSlip: Math.abs(p.paper.fillPrice - p.refPrice) * qty,
        modeledFee: p.paper.fee,
        actualSlip: Math.abs(p.demoAvgPrice - p.refPrice) * qty,
        actualFee: p.demoFeeUsdc ?? 0,
      });
    }

    console.log('=== §6.3 calibration report — PaperAdapter vs Bybit demo ===\n');
    console.log(`Paper fills journaled:   ${paperFills.size}`);
    console.log(`Demo fills captured:     ${demoFills.length}  (strategy ${strategyPairs.length + incompleteStrategy}, probe ${probePairs.length + incompleteProbe})`);
    console.log(`Calibration probes run:  ${probesRun}  (skipped ${probesSkipped})`);
    console.log(`Mirrors skipped (stale): ${skippedStale}`);
    console.log(`Mirrors skipped (off):   ${skippedDisabled}`);
    console.log(`Mirror errors:           ${mirrorErrors}`);

    if (demoFills.length === 0) {
      console.log('\nNo demo fills yet — the comparison starts with the next fresh paper fill or calibration probe.');
      return;
    }

    const gateDev = report('STRATEGY FILLS (the §6.3 gate population)', strategyPairs, incompleteStrategy);
    report('CALIBRATION PROBES (supporting evidence, not signals)', probePairs, incompleteProbe);

    if (spreadSamples.length > 0) {
      const rates = spreadSamples.map((s) => s.halfSpreadRate).sort((a, b) => a - b);
      const pct = (q: number): number => rates[Math.min(rates.length - 1, Math.floor(q * rates.length))]!;
      const modeled = spreadSamples[spreadSamples.length - 1]!.modeledSlippageRate;
      const venue = spreadSamples[spreadSamples.length - 1]!.venue;
      const worseThanModel = rates.filter((r) => r > modeled).length;
      console.log(`\n--- SLIPPAGE EVIDENCE — ${venue} half-spread, ${rates.length} sample(s) ---`);
      console.log(`  modeled slippage rate: ${(modeled * 100).toFixed(4)}%  (flat, as implemented)`);
      console.log(`  observed half-spread:  median ${(pct(0.5) * 100).toFixed(4)}%   p90 ${(pct(0.9) * 100).toFixed(4)}%   max ${(rates[rates.length - 1]! * 100).toFixed(4)}%`);
      console.log(`  samples where the real half-spread EXCEEDS the model: ${worseThanModel}/${rates.length}`);
      if (pct(0.5) > modeled) {
        console.log('  ⚠ §6.2 says slippage = max(half-spread, 0.03%); the flat rate is UNDER-charging.');
        console.log('    Under-charging costs makes paper results optimistic — the dangerous direction.');
      }
    }

    console.log('\n=== verdict ===');
    if (gateDev === null) {
      console.log('§6.3 gate: NOT YET EVALUABLE — no strategy fills have been mirrored.');
      console.log('Probe pairs measure the same fill model at the same size, but §6.3 asks for');
      console.log('identical signals through both paths; they inform the model, they do not close the gate.');
    } else {
      const pass = Math.abs(gateDev) <= 0.3;
      console.log(`§6.3 gate (|aggregate total| ≤ 30%): ${pass ? 'PASS' : 'FAIL — fix the PaperAdapter fill model'}`);
      if (!pass) console.log('Check the slippage line before touching the model — a fee-tier gap is a venue difference, not a model error.');
    }
    console.log('Reminder: the gate needs ≥2 weeks of parallel fills before it means anything.');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
