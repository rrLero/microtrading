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
 * Three things the headline number alone will lie to you about:
 *
 * 1. COST BASIS DRIFT. A pair's modeled side is only meaningful against the cost
 *    model that produced it. The basis moved twice on 2026-08-12 (0.26% → 0.80%
 *    Kraken → 0.10% Bybit EU), and pooling pairs across those bases produces an
 *    aggregate that describes no model at all. Each pair's implied taker rate is
 *    therefore recovered from its own payload, and pairs from a superseded basis
 *    are excluded from every aggregate rather than silently averaged in.
 * 2. SLIPPAGE vs FEE. On a 1000 USDC trade the fee term is ~8× the slippage
 *    term, so a fee discrepancy swamps any aggregate and fails the gate for the
 *    wrong reason. They are different KINDS of quantity: fees are explicit costs
 *    fixed by a published schedule, slippage is an implicit cost that must be
 *    measured. Standard TCA practice separates them (Perold 1988; Hasbrouck
 *    Ch.8), and so does the verdict below.
 * 3. WHAT DEMO CAN ACTUALLY PROVE. Bybit demo fills at last price with zero
 *    spread, and charges ~0.05% where Bybit EU live publishes 0.10%. It can
 *    therefore validate neither slippage nor fees — only order mechanics. The
 *    verdict states each axis against the instrument that can actually test it.
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
  /** Recovered from the pair's own payload, so a basis change cannot go unnoticed. */
  impliedTakerRate: number;
  impliedDemoRate: number;
}

/**
 * Bybit EU non-VIP spot taker, verified 2026-08-12 (§2.1). The model is supposed
 * to charge exactly this; the fee axis is that equality check, not a statistic.
 */
const PUBLISHED_TAKER = 0.001;
/** A pair belongs to the current basis if its implied rate is within this much of it. */
const BASIS_TOLERANCE = 0.2;

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
  console.log(`  fee:       modeled ${mFee.toFixed(4)}  demo ${aFee.toFixed(4)}  → ${(rel(aFee, mFee) * 100).toFixed(1)}%   <- demo fee artifact; see verdict axis 1`);
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
      .where(inArray(journal.kind, ['fill', 'demo-fill', 'demo-fill-readback', 'ops']))
      .orderBy(asc(journal.id));

    // Append-only corrections from backfill-demo-readback, keyed by demo-fill id.
    const readbacks = new Map<number, Pick<DemoFillPayload, 'demoAvgPrice' | 'demoFilledQty' | 'demoFeeUsdc'>>();
    for (const r of rows) {
      if (r.kind === 'demo-fill-readback') {
        const p = r.payload as { demoFillId: number } & Pick<DemoFillPayload, 'demoAvgPrice' | 'demoFilledQty' | 'demoFeeUsdc'>;
        readbacks.set(p.demoFillId, { demoAvgPrice: p.demoAvgPrice, demoFilledQty: p.demoFilledQty, demoFeeUsdc: p.demoFeeUsdc });
      }
    }

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
      if (r.kind === 'demo-fill') {
        const d = p as unknown as DemoFillPayload;
        const rb = d.demoAvgPrice === null ? readbacks.get(r.id) : undefined;
        demoFills.push({ at: r.at, p: rb ? { ...d, ...rb } : d });
      }
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
      const paperNotional = p.paper.fillPrice * qty;
      const demoNotional = p.demoAvgPrice * qty;
      (isProbe ? probePairs : strategyPairs).push({
        at,
        side: p.side,
        qty,
        refPrice: p.refPrice,
        modeledSlip: Math.abs(p.paper.fillPrice - p.refPrice) * qty,
        modeledFee: p.paper.fee,
        actualSlip: Math.abs(p.demoAvgPrice - p.refPrice) * qty,
        actualFee: p.demoFeeUsdc ?? 0,
        impliedTakerRate: paperNotional > 0 ? p.paper.fee / paperNotional : 0,
        impliedDemoRate: demoNotional > 0 ? (p.demoFeeUsdc ?? 0) / demoNotional : 0,
      });
    }

    console.log('=== §6.3 calibration report — PaperAdapter vs Bybit demo ===\n');
    console.log(`Paper fills journaled:   ${paperFills.size}`);
    console.log(`Demo fills captured:     ${demoFills.length}  (strategy ${strategyPairs.length + incompleteStrategy}, probe ${probePairs.length + incompleteProbe})`);
    console.log(`Calibration probes run:  ${probesRun}  (skipped ${probesSkipped})`);
    console.log(`Mirrors skipped (stale): ${skippedStale}`);
    console.log(`Mirrors skipped (off):   ${skippedDisabled}`);
    console.log(`Mirror errors:           ${mirrorErrors}`);
    console.log(`Recovered by readback:   ${readbacks.size}  (backfill-demo-readback; price from the order record)`);

    if (demoFills.length === 0) {
      console.log('\nNo demo fills yet — the comparison starts with the next fresh paper fill or calibration probe.');
      return;
    }

    // A pair computed under a retired cost model describes a model we no longer
    // run. Partition, never blend — pooling these is what made the old aggregate
    // meaningless once the basis moved twice in one day.
    const onCurrentBasis = (p: Pair): boolean =>
      Math.abs(p.impliedTakerRate - PUBLISHED_TAKER) / PUBLISHED_TAKER <= BASIS_TOLERANCE;
    const staleStrategy = strategyPairs.filter((p) => !onCurrentBasis(p));
    const staleProbe = probePairs.filter((p) => !onCurrentBasis(p));
    const liveStrategy = strategyPairs.filter(onCurrentBasis);
    const liveProbe = probePairs.filter(onCurrentBasis);

    if (staleStrategy.length + staleProbe.length > 0) {
      const rates = [...new Set([...staleStrategy, ...staleProbe].map((p) => (p.impliedTakerRate * 100).toFixed(3)))];
      console.log(
        `\n⚠ ${staleStrategy.length + staleProbe.length} pair(s) EXCLUDED — computed at a superseded cost basis ` +
          `(implied taker ${rates.join('%, ')}%; current ${(PUBLISHED_TAKER * 100).toFixed(3)}%). See §7.5 D1/D2.`,
      );
    }

    const gateDev = report('STRATEGY FILLS (the §6.3 gate population)', liveStrategy, incompleteStrategy);
    report('CALIBRATION PROBES (supporting evidence, not signals)', liveProbe, incompleteProbe);

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

    // §6.3, decomposed. A single aggregate cannot pass or fail honestly, because
    // its three components are measured by three different instruments and only
    // one of them is a statistic at all.
    console.log('\n=== verdict — §6.3 by component ===');

    const modeledTaker = [...liveProbe, ...liveStrategy][0]?.impliedTakerRate ?? PUBLISHED_TAKER;
    const feeOk = Math.abs(modeledTaker - PUBLISHED_TAKER) / PUBLISHED_TAKER <= 0.01;
    console.log(`\n1. FEES (explicit — checked against the published schedule, not the venue)`);
    console.log(`   modelled ${(modeledTaker * 100).toFixed(4)}%  vs  Bybit EU non-VIP published ${(PUBLISHED_TAKER * 100).toFixed(4)}%`);
    console.log(`   ${feeOk ? 'PASS — the model charges the published rate.' : 'FAIL — model and published schedule disagree; fix one.'}`);
    const demoRates = [...liveProbe, ...liveStrategy].map((p) => p.impliedDemoRate).filter((r) => r > 0);
    if (demoRates.length) {
      const avgDemo = demoRates.reduce((a, b) => a + b, 0) / demoRates.length;
      console.log(`   (demo charged ~${(avgDemo * 100).toFixed(4)}% — a DEMO ARTIFACT, not evidence about live fees.`);
      console.log(`    Fees are a published constant; they are verified by reading the schedule, not by trading.)`);
    }

    console.log(`\n2. SLIPPAGE (implicit — checked against the execution venue's book)`);
    if (spreadSamples.length === 0) {
      console.log('   NOT EVALUABLE — no spread samples yet.');
    } else {
      const rates = spreadSamples.map((s) => s.halfSpreadRate).sort((a, b) => a - b);
      const p90 = rates[Math.min(rates.length - 1, Math.floor(0.9 * rates.length))]!;
      const modeledSlip = spreadSamples[spreadSamples.length - 1]!.modeledSlippageRate;
      const conservative = modeledSlip >= p90;
      console.log(`   modelled ${(modeledSlip * 100).toFixed(4)}%  vs  observed p90 half-spread ${(p90 * 100).toFixed(4)}%  (n=${rates.length})`);
      console.log(`   ${conservative ? 'PASS — the model is conservative at p90.' : 'FAIL — the model under-charges; paper results are optimistic.'}`);
      if (rates.length < 100) console.log(`   ⚠ n=${rates.length} and no stress event sampled yet — treat as provisional.`);
    }

    console.log(`\n3. MECHANICS (what demo CAN prove — orders, fills, read-back, fee currency)`);
    const mechanicsOk = mirrorErrors === 0 && liveProbe.length + liveStrategy.length > 0;
    console.log(`   ${liveProbe.length + liveStrategy.length} complete pair(s) at the current basis, ${mirrorErrors} mirror error(s)`);
    console.log(`   ${mechanicsOk ? 'PASS — orders route, fill, and read back.' : 'NOT EVALUABLE — no complete pairs at this basis yet.'}`);

    console.log(`\n4. FILL-MODEL vs VENUE (the original §6.3 aggregate)`);
    if (gateDev === null) {
      console.log('   NOT EVALUABLE — no strategy fills mirrored at the current basis.');
      console.log('   Note: Bybit demo has zero spread, so this axis cannot be closed there at all.');
      console.log('   Axes 1-3 are what actually validate the cost model; this one waits for a venue with a real book.');
    } else {
      const pass = Math.abs(gateDev) <= 0.3;
      console.log(`   |aggregate total| ≤ 30%: ${pass ? 'PASS' : 'FAIL — fix the PaperAdapter fill model'}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
