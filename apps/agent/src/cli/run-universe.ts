import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  REGIME_ORDER,
  computeMetricsFromParts,
  minimumDetectableSharpe,
  regimeByDay,
  utcDay,
  utcYear,
  type Candle,
  type RegimeLabel,
  type Trade,
} from '@microtrading/core';
import { AppModule } from '../app.module.js';
import { CandleRepository } from '../market-data/candle-repository.js';
import { ExperimentService, btFor, type StrategyFamily } from '../experiments/experiment.service.js';
import { loadUniverse } from '../experiments/universe.js';

/**
 * Pooled multi-pair walk-forward:  pnpm run-universe -- <family> [slippageRate]
 *
 * Runs the UNCHANGED pre-registered grid across the pre-registered universe
 * (experiments/universe.json), pooling returns and trades across pairs and
 * computing metrics once over the pooled set — SPEC §2.2: pooled is the verdict,
 * per-pair figures are a breakdown and never an alternative to select from.
 *
 * Reports raw N and EFFECTIVE N. Crypto majors correlate 0.7-0.9, so pooled
 * trades are nowhere near independent observations; a raw count overstates its
 * own evidence exactly the way an undeflated Sharpe does.
 *
 * Holdout is never touched — dev data only.
 *
 * The optional slippageRate overrides §6.2's modelled floor for SENSITIVITY
 * ANALYSIS ONLY — e.g. re-pricing the grid at the observed p90 half-spread when
 * §6.3 axis 2 fails. Like cost-sensitivity, it re-evaluates the UNCHANGED grid
 * on the UNCHANGED dev window varying one input constant, records nothing, and
 * creates no new selection opportunity, so N is unaffected (SPEC §7.1). It does
 * NOT amend §6.2: the deployed model is whatever btFor() says until a human
 * amends the spec.
 */

/** Pearson correlation of two equal-length series. */
function corr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 30) return 1; // too short to claim independence — assume the worst
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]!; sb += b[i]!; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma, y = b[i]! - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 1;
}

/**
 * Daily STRATEGY returns, keyed by UTC day.
 *
 * Deliberately not the assets' own returns. The strategy is flat most of the
 * time, so two pairs are rarely in position together and its returns correlate
 * far less than the underlying prices do. Correlating raw asset returns answers
 * "do these coins move together" (yes, ~0.6) when the question governing
 * effective sample size is "do these TRADES carry the same information".
 */
function dailyStrategyReturns(returns: { ts: number; r: number }[]): Map<number, number> {
  const byDay = new Map<number, number>();
  for (const { ts, r } of returns) {
    const day = Math.floor(ts / 86_400_000);
    // Compound within the day rather than summing — these are simple returns.
    byDay.set(day, (1 + (byDay.get(day) ?? 0)) * (1 + r) - 1);
  }
  return byDay;
}

/**
 * Effective number of independent assets — Kish, and why not the spectral one.
 *
 * These two measures answer DIFFERENT questions, and the distinction decides
 * which belongs here:
 *
 *   Kish design effect, M / (1 + (M-1)ρ̄) — effective SAMPLE SIZE. Defined as
 *   the number of uncorrelated observations that would give the same PRECISION
 *   (variance of the estimator) as the correlated sample. For an equally
 *   weighted mean of M equicorrelated series, Var = σ²/M · [1 + (M-1)ρ], so
 *   this is exact, not a heuristic.
 *
 *   Spectral, (Σλ)² / Σλ² — effective DIMENSIONALITY. The family that Cheverud
 *   (2001), Nyholt (2004) and Li & Ji (2005) use to count the effective number
 *   of independent TESTS, for adjusting a significance threshold under multiple
 *   testing. It is also what López de Prado recommends for the number of
 *   independent TRIALS in the Deflated Sharpe.
 *
 * §7.4's floor asks "is there enough evidence to judge this strategy" — a
 * question about the precision of a pooled estimate. That is the design-effect
 * question, so KISH governs. The spectral figure belongs to the DSR's trial
 * count, not to the sample size, and is reported alongside only so nobody
 * re-introduces it here as though the two were interchangeable: at ρ̄ = 0.3 it
 * reads ~4.6 where Kish reads ~2.7, and using it would inflate the apparent
 * evidence by roughly 70%.
 */
function effectiveAssets(C: number[][]): { kish: number; spectral: number; rhoBar: number } {
  const M = C.length;
  if (M === 0) return { kish: 0, spectral: 0, rhoBar: 1 };
  let offSum = 0;
  let sqSum = 0;
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < M; j++) {
      sqSum += C[i]![j]! * C[i]![j]!;
      if (i !== j) offSum += C[i]![j]!;
    }
  }
  const rhoBar = M > 1 ? offSum / (M * (M - 1)) : 1;
  const kish = M / (1 + (M - 1) * Math.max(0, rhoBar));
  const spectral = sqSum > 0 ? (M * M) / sqSum : M;
  return { kish, spectral, rhoBar };
}

/**
 * SPEC §7.2 regime + calendar-year reporting (resolves REVIEW R8).
 *
 * An aggregate PF hides WHERE the money came from. R8's warning is that a
 * sample dominated by one regime says nothing about the others, and that
 * long-only strategies are exactly the ones a trending sample flatters. So the
 * two numbers that matter here are per-segment contribution and per-segment
 * EXPOSURE — §7.2 requires a long-only strategy to demonstrate it stands aside
 * in bear segments, and "flat for months is success, not failure".
 *
 * Exposure is counted in pair-days: a day on which any position was open on a
 * pair counts once for that pair. Days before the 200-day mean warms up carry
 * no regime label and are excluded from every bucket rather than folded into
 * one — silently bucketing them would attribute the first ~7 months of each
 * pair to whichever label happened to be the default.
 */
interface Bucket {
  days: number;
  inPos: number;
  trades: number;
  win: number;
  loss: number;
  growth: number;
}

const emptyBucket = (): Bucket => ({ days: 0, inPos: 0, trades: 0, win: 0, loss: 0, growth: 1 });

function accumulate(
  buckets: Map<string | number, Bucket>,
  key: string | number | undefined,
  fn: (b: Bucket) => void,
): void {
  if (key === undefined) return;
  let b = buckets.get(key);
  if (!b) {
    b = emptyBucket();
    buckets.set(key, b);
  }
  fn(b);
}

function daysHeld(trades: readonly Trade[]): Set<number> {
  const held = new Set<number>();
  for (const t of trades) {
    for (let d = utcDay(t.entryTs); d <= utcDay(t.exitTs); d++) held.add(d);
  }
  return held;
}

/** 'YYYY-MM' for a UTC timestamp — sorts lexicographically, which the run scan relies on. */
function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Every calendar month from `from` to `to` inclusive, so gaps in the data stay visible. */
function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function pf(b: Bucket): string {
  if (b.loss === 0) return b.win > 0 ? 'inf' : 'n/a';
  return (b.win / b.loss).toFixed(2);
}

function row(label: string, b: Bucket): string {
  const exposure = b.days > 0 ? (100 * b.inPos) / b.days : 0;
  return (
    `${label.padEnd(10)} | ${String(b.days).padStart(9)} | ${exposure.toFixed(1).padStart(8)} | ` +
    `${String(b.trades).padStart(6)} | ${((b.growth - 1) * 100).toFixed(1).padStart(7)} | ${pf(b).padStart(5)}`
  );
}

/**
 * Monthly table plus §7.4's third kill criterion: "3 consecutive calendar
 * months net negative".
 *
 * Months are walked over a CONTINUOUS calendar range, not just the months that
 * happen to carry data, so a gap cannot silently join two negative stretches
 * into one apparent run. A month with no data breaks a run — an unknown month
 * is not evidence of a negative one. A flat month (exactly zero) also breaks it:
 * flat is not negative, and §7.2 is explicit that being flat is not failure.
 */
function reportMonthly(byMonth: Map<string | number, Bucket>): void {
  const keys = [...byMonth.keys()].map(String).sort();
  if (keys.length === 0) return;
  const all = monthRange(keys[0]!, keys[keys.length - 1]!);

  console.log(`\n--- §7.2 BY CALENDAR MONTH ---`);
  console.log(`month    |    net% | trades | expos.%`);
  for (const k of all) {
    const b = byMonth.get(k);
    if (!b) {
      console.log(`${k.padEnd(8)} |       — | no data |       —`);
      continue;
    }
    const net = (b.growth - 1) * 100;
    const expos = b.days > 0 ? (100 * b.inPos) / b.days : 0;
    console.log(
      `${k.padEnd(8)} | ${net.toFixed(1).padStart(7)} | ${String(b.trades).padStart(6)} | ${expos.toFixed(1).padStart(7)}`,
    );
  }

  // Concentration: how much of the whole result is one month?
  // An aggregate PF cannot distinguish "a persistent edge" from "one enormous
  // month plus noise", and those have opposite implications for a live pilot.
  const active = all.map((k) => byMonth.get(k)).filter((b): b is Bucket => b !== undefined);
  if (active.length > 0) {
    const growthAll = active.reduce((g, b) => g * b.growth, 1);
    let bestKey = '';
    let bestGrowth = -Infinity;
    for (const k of all) {
      const b = byMonth.get(k);
      if (b && b.growth > bestGrowth) { bestGrowth = b.growth; bestKey = k; }
    }
    const growthEx = growthAll / bestGrowth;
    const negatives = active.filter((b) => b.growth < 1).length;
    console.log(`\n--- concentration ---`);
    console.log(`  full period ${((growthAll - 1) * 100).toFixed(1)}% over ${active.length} active months, ${negatives} of them negative.`);
    console.log(`  best single month ${bestKey}: ${((bestGrowth - 1) * 100).toFixed(1)}%.`);
    console.log(`  EXCLUDING it, the whole period returns ${((growthEx - 1) * 100).toFixed(1)}%.`);
    const share = growthAll > 1 ? (1 - (growthEx - 1) / (growthAll - 1)) * 100 : NaN;
    if (Number.isFinite(share) && share >= 50) {
      console.log(`  ${share.toFixed(0)}% of the entire result is ONE month. Treat the aggregate PF`);
      console.log(`  as a description of that month, not as evidence of a persistent edge (REVIEW R8).`);
    }
  }

  let run = 0;
  let worst = 0;
  let worstEnd = '';
  for (const k of all) {
    const b = byMonth.get(k);
    const net = b ? b.growth - 1 : null;
    if (net !== null && net < 0) {
      run += 1;
      if (run > worst) { worst = run; worstEnd = k; }
    } else {
      run = 0;
    }
  }

  console.log(`\n--- §7.4 kill criterion: 3 consecutive calendar months net negative ---`);
  if (worst >= 3) {
    console.log(`  FIRES — longest negative run is ${worst} months, ending ${worstEnd}.`);
    console.log(`  §7.4 lists this as sufficient on its own to kill a strategy.`);
    console.log(`  NOTE: §7.4 scopes the kill criteria to "OOS/paper". These are pooled`);
    console.log(`  walk-forward OOS months, so the criterion is evaluable here — but whether`);
    console.log(`  a DEV-window run kills a family, or only a realized paper run does, is a`);
    console.log(`  reading of the spec that a human must make. Do not treat this as automatic.`);
  } else {
    console.log(`  does not fire — longest negative run is ${worst} month(s).`);
  }
}

function reportSegments(
  perPair: { returns: { ts: number; r: number }[]; trades: Trade[]; regimes: Map<number, RegimeLabel> }[],
): void {
  const byRegime = new Map<string | number, Bucket>();
  const byYear = new Map<string | number, Bucket>();
  const byMonth = new Map<string | number, Bucket>();

  for (const p of perPair) {
    const held = daysHeld(p.trades);

    for (const [day, label] of p.regimes) {
      accumulate(byRegime, label, (b) => {
        b.days++;
        if (held.has(day)) b.inPos++;
      });
    }
    // Calendar-year day/exposure counts use the same labelled-day population,
    // so the two tables are directly comparable.
    for (const [day] of p.regimes) {
      const ts = day * 86_400_000;
      const tally = (b: Bucket): void => {
        b.days++;
        if (held.has(day)) b.inPos++;
      };
      accumulate(byYear, utcYear(ts), tally);
      accumulate(byMonth, monthKey(ts), tally);
    }

    for (const r of p.returns) {
      const label = p.regimes.get(utcDay(r.ts));
      accumulate(byRegime, label, (b) => {
        b.growth *= 1 + r.r;
      });
      if (label !== undefined) {
        accumulate(byYear, utcYear(r.ts), (b) => { b.growth *= 1 + r.r; });
        accumulate(byMonth, monthKey(r.ts), (b) => { b.growth *= 1 + r.r; });
      }
    }

    for (const t of p.trades) {
      // A trade belongs to the regime it was ENTERED in — that is the state the
      // strategy actually acted on. Attributing by exit would credit decisions
      // to information they did not have.
      const label = p.regimes.get(utcDay(t.entryTs));
      const tally = (b: Bucket): void => {
        b.trades++;
        if (t.pnl >= 0) b.win += t.pnl;
        else b.loss += -t.pnl;
      };
      accumulate(byRegime, label, tally);
      if (label !== undefined) {
        accumulate(byYear, utcYear(t.entryTs), tally);
        accumulate(byMonth, monthKey(t.entryTs), tally);
      }
    }
  }

  const header = `segment    | pair-days | expos.% | trades |    net% |    PF`;

  console.log(`\n--- §7.2 BY REGIME SEGMENT (200-day MA slope + drawdown state) ---`);
  console.log(header);
  for (const label of REGIME_ORDER) {
    const b = byRegime.get(label);
    if (b) console.log(row(label, b));
  }

  console.log(`\n--- §7.2 BY CALENDAR YEAR ---`);
  console.log(header);
  for (const y of [...byYear.keys()].sort((a, b) => Number(a) - Number(b))) {
    console.log(row(String(y), byYear.get(y)!));
  }

  reportMonthly(byMonth);

  // §7.2's actual requirement, stated as a verdict rather than left to the reader.
  const bear = byRegime.get('bear');
  console.log(`\n--- §7.2 long-only bear test ---`);
  if (!bear || bear.days === 0) {
    console.log('  NO bear days in the development window — the sample cannot demonstrate');
    console.log('  bear behaviour at all. That is a gap in the EVIDENCE, not a pass (REVIEW R8).');
    return;
  }
  const exposure = (100 * bear.inPos) / bear.days;
  const share = ((bear.growth - 1) * 100).toFixed(1);
  console.log(`  bear: ${bear.days} pair-days, ${exposure.toFixed(1)}% exposed, ${bear.trades} trades, ${share}% net.`);
  console.log(
    exposure <= 25
      ? `  DEMONSTRATED — the strategy largely stands aside in bear segments.\n` +
          `  §7.2: being flat for months is success, not failure.`
      : `  NOT DEMONSTRATED — ${exposure.toFixed(1)}% exposure in bear segments is not "flat".\n` +
          `  §7.2 requires a long-only strategy to show it steps aside; this one does not.`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const family = args[0] as StrategyFamily | undefined;
  if (!family) {
    console.error("Usage: pnpm run-universe -- <family> [slippageRate, e.g. 0.000324 or 0.0324%]");
    process.exitCode = 1;
    return;
  }
  // Accept either a fraction (0.000324) or a percent string (0.0324%).
  const slipArg = args[1];
  const slippageOverride = slipArg
    ? slipArg.trim().endsWith('%')
      ? Number(slipArg.trim().slice(0, -1)) / 100
      : Number(slipArg)
    : undefined;
  if (slippageOverride !== undefined && !(Number.isFinite(slippageOverride) && slippageOverride >= 0)) {
    console.error(`REFUSED: slippageRate '${slipArg}' is not a non-negative number.`);
    process.exitCode = 1;
    return;
  }

  const uni = loadUniverse();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const experiments = app.get(ExperimentService);
    const repo = app.get(CandleRepository);

    const prereg = await experiments.getPreregistration(family);
    if (!prereg) {
      console.error(`REFUSED: no pre-registration for '${family}' (SPEC §7.1).`);
      process.exitCode = 1;
      return;
    }
    const gridN = prereg.grid.length;
    // DSR deflates against the whole selection pool, not just this family's grid.
    const nTotal = Math.max(gridN, await experiments.countDistinctConfigsAllFamilies());

    // Load every pair's dev window once; the grid re-reads it per config.
    const dev = new Map<string, Candle[]>();
    for (const p of uni.pairs) {
      const all = await repo.fetchSince(p.symbol, '1h', 0);
      const d = all.filter((c) => c.timestamp < prereg.holdoutFrom);
      if (d.length > 0) dev.set(p.symbol, d);
    }

    const M = dev.size;
    console.log(`=== POOLED UNIVERSE WALK-FORWARD — ${family} ===`);
    console.log(`Grid: ${gridN} pre-registered configs (UNCHANGED). Universe: ${M} pairs from ${uni.dataVenue}.`);
    console.log(`DSR deflates against N=${nTotal} — every distinct configuration tried across ALL families, not just this grid.`);
    console.log(`Dev window ends ${new Date(prereg.holdoutFrom).toISOString().slice(0, 10)} — holdout SEALED.`);
    const modelled = btFor(family).costs;
    const costs = slippageOverride === undefined ? undefined : { ...modelled, slippageRate: slippageOverride };
    const effective = costs ?? modelled;
    console.log(`Costs: ${(effective.takerFeeRate * 100).toFixed(2)}% taker, ${(effective.slippageRate * 100).toFixed(4)}% slippage floor.`);
    if (costs) {
      console.log(
        `  *** SENSITIVITY RUN — slippage OVERRIDDEN from the modelled ${(modelled.slippageRate * 100).toFixed(4)}%. ***\n` +
          `  §6.2 is UNCHANGED; this re-prices the same grid to size the damage, it does not amend the model.`,
      );
    }
    console.log(`Effective N from STRATEGY-return correlation via the Kish design effect. Spectral shown for contrast only — it measures\ndimensionality (the DSR's trial count), not sample size, and is not used here.\n`);

    console.log('params                                  | trades | effN | ρ̄     | net%   | PF    | maxDD% | Sharpe | DSR   | fees/gross');
    const rows: { params: Record<string, number>; pf: number; trades: number; eff: number; dsr: number; sharpe: number; mde: number }[] = [];

    for (const params of prereg.grid) {
      const returns: { ts: number; r: number }[] = [];
      const trades: Trade[] = [];
      let candleCount = 0;
      const perPair: { sym: string; n: number; pf: number }[] = [];
      const stratDaily = new Map<string, Map<number, number>>();

      for (const [sym, candles] of dev) {
        const part = experiments.evaluateParts(family, params, candles, costs);
        returns.push(...part.returns);
        trades.push(...part.trades);
        candleCount += part.candleCount;
        stratDaily.set(sym, dailyStrategyReturns(part.returns));
        const m = computeMetricsFromParts(part.returns.map((x) => x.r), part.trades, nTotal, part.candleCount);
        perPair.push({ sym, n: m.nTrades, pf: Number.isFinite(m.profitFactor) ? m.profitFactor : 0 });
      }

      // Correlation matrix of this config's strategy returns across the universe.
      const syms = [...stratDaily.keys()];
      const C: number[][] = syms.map(() => syms.map(() => 0));
      for (let i = 0; i < syms.length; i++) {
        C[i]![i] = 1;
        for (let j = i + 1; j < syms.length; j++) {
          const A = stratDaily.get(syms[i]!)!, B = stratDaily.get(syms[j]!)!;
          const common = [...A.keys()].filter((d) => B.has(d)).sort((x, y) => x - y);
          const c = corr(common.map((d) => A.get(d)!), common.map((d) => B.get(d)!));
          C[i]![j] = c;
          C[j]![i] = c;
        }
      }
      const { kish, spectral, rhoBar } = effectiveAssets(C);
      // Kish governs: the floor is a question about estimate precision, not dimensionality.
      const mEff = kish;

      const m = computeMetricsFromParts(returns.map((x) => x.r), trades, nTotal, candleCount);
      const effTrades = Math.round(m.nTrades * (mEff / M));
      const pf = Number.isFinite(m.profitFactor) ? m.profitFactor : 0;
      console.log(
        `${JSON.stringify(params).padEnd(39)} | ${String(m.nTrades).padStart(6)} | ${String(effTrades).padStart(4)} | ` +
          `${rhoBar.toFixed(3).padStart(6)} | ` +
          `${m.netReturnPct.toFixed(1).padStart(6)} | ${pf.toFixed(2).padStart(5)} | ${m.maxDrawdownPct.toFixed(1).padStart(6)} | ` +
          `${m.sharpeAnnualized.toFixed(2).padStart(6)} | ${(Number.isNaN(m.deflatedSharpeProb) ? 0 : m.deflatedSharpeProb).toFixed(2).padStart(5)} | ` +
          `${Number.isFinite(m.feeShareOfGross) ? m.feeShareOfGross.toFixed(2) : 'n/a'}`,
      );
      const mde = minimumDetectableSharpe(returns.map((x) => x.r), nTotal, 0.95);
      rows.push({ params, pf, trades: m.nTrades, eff: effTrades, dsr: m.deflatedSharpeProb, sharpe: m.sharpeAnnualized, mde });
      console.log(
        `    eff assets: Kish ${kish.toFixed(2)} / spectral ${spectral.toFixed(2)} of ${M} · per-pair PF: ` +
          perPair.map((p) => `${p.sym.split('/')[0]} ${p.pf.toFixed(2)}(${p.n})`).join('  '),
      );
    }

    const survivors = rows.filter((r) => r.pf >= 1.1).length;
    const best = [...rows].sort((a, b) => b.pf - a.pf)[0];
    console.log(`\n=== verdict ===`);
    console.log(`${survivors}/${rows.length} configs clear the §7.4 kill line (PF ≥ 1.1) pooled.`);
    if (best) {
      console.log(`Best pooled: ${JSON.stringify(best.params)} — PF ${best.pf.toFixed(2)}, ${best.trades} raw trades, DSR ${best.dsr.toFixed(2)}.`);
      if (best.eff < 100) {
        console.log(`§7.4 EVIDENCE: ${best.trades} raw trades, ~${best.eff} effective after correlation — the 100-trade floor is NOT met on effective count.`);
      } else {
        console.log(`§7.4 evidence floor met on effective count (~${best.eff} ≥ 100) as well as raw.`);
      }
      if (best.dsr < 0.95) {
        console.log(`DSR ${best.dsr.toFixed(2)} is below the 0.95 the §7.4 live gate wants — and that gate is measured on the HOLDOUT, not here.`);
      }
    }
    // Power: bound the null instead of merely asserting it.
    const mdes = rows.map((r) => r.mde).filter((v) => Number.isFinite(v));
    if (mdes.length) {
      const lo = Math.min(...mdes);
      const hi = Math.max(...mdes);
      console.log(
        `\nPOWER — minimum detectable annualised Sharpe at 95% with N=${nTotal}: ${lo.toFixed(2)} to ${hi.toFixed(2)}.`,
      );
      const bestRow = [...rows].sort((a, b) => b.pf - a.pf)[0]!;
      console.log(
        `  Best config's observed Sharpe is ${bestRow.sharpe.toFixed(2)} against its own bar of ${bestRow.mde.toFixed(2)} — ` +
          `${bestRow.sharpe >= bestRow.mde ? 'ABOVE, so a real edge of this size WOULD have been detected.' : 'BELOW, so this sample could not certify an edge of that size either way.'}`,
      );
      console.log('  A null here rules out edges LARGER than this bar; it says nothing about smaller ones.');
    }
    // §7.2 reporting for the config the verdict is about. Re-running one config
    // over the universe is cheap next to the grid, and keeps the hot loop lean.
    if (best) {
      console.log(`\n=== §7.2 REGIME & YEAR BREAKDOWN — ${JSON.stringify(best.params)} ===`);
      console.log(`Regime is classified from PRICE ONLY (200-day MA slope + drawdown), never from anything the strategy knows.`);
      const parts = [...dev.entries()].map(([, candles]) => {
        const part = experiments.evaluateParts(family, best.params, candles, costs);
        return { returns: part.returns, trades: part.trades, regimes: regimeByDay(candles) };
      });
      reportSegments(parts);
    }

    console.log('\nHoldout NOT evaluated: §7.2 burns it once.');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
