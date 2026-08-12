import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { computeMetricsFromParts, type Candle, type Trade } from '@microtrading/core';
import { AppModule } from '../app.module.js';
import { CandleRepository } from '../market-data/candle-repository.js';
import { ExperimentService, btFor, type StrategyFamily } from '../experiments/experiment.service.js';
import { loadUniverse } from '../experiments/universe.js';

/**
 * Pooled multi-pair walk-forward:  pnpm run-universe -- <family>
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
 * Effective number of independent assets, two ways.
 *
 * `kish` — the survey-sampling design effect M / (1 + (M-1)ρ̄) (Kish 1965),
 * which assumes every pair correlates equally. Cheap, but wrong-shaped here:
 * BTC-ETH are far more alike than BTC-MNT.
 *
 * `spectral` — (Σλ)² / Σλ² over the correlation matrix's eigenvalues, the
 * measure López de Prado recommends for exactly this problem. Computed without
 * an eigensolver: Σλ = trace(C) = M, and Σλ² = trace(C²) = ΣᵢΣⱼ Cᵢⱼ² because C
 * is symmetric. It equals M for an identity matrix and 1 for a rank-one one.
 *
 * We report both and use the lower — the more conservative claim about evidence.
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

async function main(): Promise<void> {
  const family = process.argv.slice(2).filter((a) => a !== '--')[0] as StrategyFamily | undefined;
  if (!family) {
    console.error('Usage: pnpm run-universe -- <family>');
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
    const nTotal = prereg.grid.length;

    // Load every pair's dev window once; the grid re-reads it per config.
    const dev = new Map<string, Candle[]>();
    for (const p of uni.pairs) {
      const all = await repo.fetchSince(p.symbol, '1h', 0);
      const d = all.filter((c) => c.timestamp < prereg.holdoutFrom);
      if (d.length > 0) dev.set(p.symbol, d);
    }

    const M = dev.size;
    console.log(`=== POOLED UNIVERSE WALK-FORWARD — ${family} ===`);
    console.log(`Grid: ${nTotal} pre-registered configs (UNCHANGED). Universe: ${M} pairs from ${uni.dataVenue}.`);
    console.log(`Dev window ends ${new Date(prereg.holdoutFrom).toISOString().slice(0, 10)} — holdout SEALED.`);
    console.log(`Costs: ${(btFor(family).costs.takerFeeRate * 100).toFixed(2)}% taker, ${(btFor(family).costs.slippageRate * 100).toFixed(2)}% slippage floor.`);
    console.log(`Effective N from STRATEGY-return correlation (Kish design effect and the spectral measure); the lower is used.\n`);

    console.log('params                                  | trades | effN | ρ̄     | net%   | PF    | maxDD% | Sharpe | DSR   | fees/gross');
    const rows: { params: Record<string, number>; pf: number; trades: number; eff: number; dsr: number }[] = [];

    for (const params of prereg.grid) {
      const returns: { ts: number; r: number }[] = [];
      const trades: Trade[] = [];
      let candleCount = 0;
      const perPair: { sym: string; n: number; pf: number }[] = [];
      const stratDaily = new Map<string, Map<number, number>>();

      for (const [sym, candles] of dev) {
        const part = experiments.evaluateParts(family, params, candles);
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
      const mEff = Math.min(kish, spectral);

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
      rows.push({ params, pf, trades: m.nTrades, eff: effTrades, dsr: m.deflatedSharpeProb });
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
    console.log('Holdout NOT evaluated: §7.2 burns it once.');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
