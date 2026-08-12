import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { computeMetricsFromParts, type Candle, type Trade } from '@microtrading/core';
import { AppModule } from '../app.module.js';
import { CandleRepository } from '../market-data/candle-repository.js';
import { ExperimentService, btFor, type StrategyFamily } from '../experiments/experiment.service.js';

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
const UNIVERSE = new URL('../../../../experiments/universe.json', import.meta.url);

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

/** Daily returns from 1h candles, keyed by UTC day, for the correlation estimate. */
function dailyReturns(candles: readonly Candle[]): Map<number, number> {
  const closeByDay = new Map<number, number>();
  for (const c of candles) closeByDay.set(Math.floor(c.timestamp / 86_400_000), c.close);
  const days = [...closeByDay.keys()].sort((x, y) => x - y);
  const out = new Map<number, number>();
  for (let i = 1; i < days.length; i++) {
    const prev = closeByDay.get(days[i - 1]!)!;
    if (prev > 0) out.set(days[i]!, closeByDay.get(days[i]!)! / prev - 1);
  }
  return out;
}

async function main(): Promise<void> {
  const family = process.argv.slice(2).filter((a) => a !== '--')[0] as StrategyFamily | undefined;
  if (!family) {
    console.error('Usage: pnpm run-universe -- <family>');
    process.exitCode = 1;
    return;
  }

  const uni = JSON.parse(readFileSync(UNIVERSE, 'utf8')) as { pairs: { symbol: string }[]; dataVenue: string };
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

    // Correlation across the universe, from daily returns on common days.
    const rets = new Map<string, Map<number, number>>();
    for (const [sym, c] of dev) rets.set(sym, dailyReturns(c));
    const syms = [...rets.keys()];
    const pairCorrs: number[] = [];
    for (let i = 0; i < syms.length; i++) {
      for (let j = i + 1; j < syms.length; j++) {
        const A = rets.get(syms[i]!)!, B = rets.get(syms[j]!)!;
        const common = [...A.keys()].filter((d) => B.has(d)).sort((x, y) => x - y);
        pairCorrs.push(corr(common.map((d) => A.get(d)!), common.map((d) => B.get(d)!)));
      }
    }
    const rhoBar = pairCorrs.length ? pairCorrs.reduce((a, b) => a + b, 0) / pairCorrs.length : 1;
    const M = syms.length;
    // Effective independent assets under equicorrelation.
    const mEff = M / (1 + (M - 1) * Math.max(0, rhoBar));

    console.log(`=== POOLED UNIVERSE WALK-FORWARD — ${family} ===`);
    console.log(`Grid: ${nTotal} pre-registered configs (UNCHANGED). Universe: ${M} pairs from ${uni.dataVenue}.`);
    console.log(`Dev window ends ${new Date(prereg.holdoutFrom).toISOString().slice(0, 10)} — holdout SEALED.`);
    console.log(`Costs: ${(btFor(family).costs.takerFeeRate * 100).toFixed(2)}% taker, ${(btFor(family).costs.slippageRate * 100).toFixed(2)}% slippage floor.`);
    console.log(`Mean pairwise daily-return correlation: ${rhoBar.toFixed(3)} → ${mEff.toFixed(2)} effective independent assets of ${M}.\n`);

    console.log('params                                  | trades | effN | net%   | PF    | maxDD% | Sharpe | DSR   | fees/gross');
    const rows: { params: Record<string, number>; line: string; pf: number; trades: number; dsr: number }[] = [];

    for (const params of prereg.grid) {
      const returns: number[] = [];
      const trades: Trade[] = [];
      let candleCount = 0;
      const perPair: { sym: string; n: number; pf: number }[] = [];

      for (const [sym, candles] of dev) {
        const part = experiments.evaluateParts(family, params, candles);
        returns.push(...part.returns);
        trades.push(...part.trades);
        candleCount += part.candleCount;
        const m = computeMetricsFromParts(part.returns, part.trades, nTotal, part.candleCount);
        perPair.push({ sym, n: m.nTrades, pf: Number.isFinite(m.profitFactor) ? m.profitFactor : 0 });
      }

      const m = computeMetricsFromParts(returns, trades, nTotal, candleCount);
      const effTrades = Math.round(m.nTrades * (mEff / M));
      const pf = Number.isFinite(m.profitFactor) ? m.profitFactor : 0;
      const line =
        `${JSON.stringify(params).padEnd(39)} | ${String(m.nTrades).padStart(6)} | ${String(effTrades).padStart(4)} | ` +
        `${m.netReturnPct.toFixed(1).padStart(6)} | ${pf.toFixed(2).padStart(5)} | ${m.maxDrawdownPct.toFixed(1).padStart(6)} | ` +
        `${m.sharpeAnnualized.toFixed(2).padStart(6)} | ${(Number.isNaN(m.deflatedSharpeProb) ? 0 : m.deflatedSharpeProb).toFixed(2).padStart(5)} | ` +
        `${Number.isFinite(m.feeShareOfGross) ? m.feeShareOfGross.toFixed(2) : 'n/a'}`;
      rows.push({ params, line, pf, trades: m.nTrades, dsr: m.deflatedSharpeProb });
      console.log(line);
      console.log(`    per-pair PF: ${perPair.map((p) => `${p.sym.split('/')[0]} ${p.pf.toFixed(2)}(${p.n})`).join('  ')}`);
    }

    const survivors = rows.filter((r) => r.pf >= 1.1).length;
    const best = [...rows].sort((a, b) => b.pf - a.pf)[0];
    console.log(`\n=== verdict ===`);
    console.log(`${survivors}/${rows.length} configs clear the §7.4 kill line (PF ≥ 1.1) pooled.`);
    if (best) {
      console.log(`Best pooled: ${JSON.stringify(best.params)} — PF ${best.pf.toFixed(2)}, ${best.trades} raw trades, DSR ${best.dsr.toFixed(2)}.`);
      const effBest = Math.round(best.trades * (mEff / M));
      if (effBest < 100) {
        console.log(`§7.4 EVIDENCE: ${best.trades} raw trades, but only ~${effBest} effective after correlation — the 100-trade floor is NOT met on effective count.`);
      } else {
        console.log(`§7.4 evidence floor met on effective count (~${effBest} ≥ 100).`);
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
