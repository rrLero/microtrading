import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../app.module.js';
import { CandleRepository } from '../market-data/candle-repository.js';
import { ExperimentService, paramsHash, type StrategyFamily } from '../experiments/experiment.service.js';

/**
 * Walk-forward trials (SPEC §7.2):  pnpm run-trials -- <family>
 * Refuses without a pre-registration. Uses ONLY development data (before the
 * frozen holdout boundary). Logs every trial; prints N on the report.
 */
async function main(): Promise<void> {
  const [family] = process.argv.slice(2).filter((a) => a !== '--') as [StrategyFamily?];
  if (!family) {
    console.error('Usage: pnpm run-trials -- <sma-crossover|rsi-reversion>');
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const experiments = app.get(ExperimentService);
    const repo = app.get(CandleRepository);
    const config = app.get(ConfigService);
    const symbol = config.get<string>('SYMBOL', 'BTC/USDC');

    const prereg = await experiments.getPreregistration(family);
    if (!prereg) {
      console.error(`REFUSED: no pre-registration for '${family}'. Run preregister first (SPEC §7.1).`);
      process.exitCode = 1;
      return;
    }

    const all = await repo.fetchSince(symbol, '1h', 0);
    const dev = all.filter((c) => c.timestamp < prereg.holdoutFrom);
    console.log(
      `Family '${family}' | ${prereg.grid.length} pre-registered configs | dev window: ` +
        `${new Date(dev[0]!.timestamp).toISOString().slice(0, 10)} → ${new Date(prereg.holdoutFrom).toISOString().slice(0, 10)} (holdout SEALED)`,
    );

    const nTotal = prereg.grid.length; // DSR deflates against the full pre-registered budget
    const rows: { hash: string; params: Record<string, number>; m: ReturnType<typeof fmt> }[] = [];

    for (const params of prereg.grid) {
      if (await experiments.trialExists(family, params)) {
        console.log(`  skip (already logged): ${JSON.stringify(params)}`);
        continue;
      }
      const { metrics, windows } = experiments.evaluateConfig(family, params, dev, nTotal);
      await experiments.logTrial(family, params, metrics, windows);
      rows.push({ hash: paramsHash(params), params, m: fmt(metrics) });
      console.log(`  done: ${JSON.stringify(params)} → PF ${metrics.profitFactor.toFixed(2)}, ${metrics.nTrades} trades`);
    }

    const n = await experiments.countTrials(family);
    console.log(`\n=== WALK-FORWARD REPORT: ${family} (N=${n} trials logged — deflated Sharpe uses N=${nTotal}) ===`);
    console.log('hash             | params                                        | trades | net%   | PF    | maxDD% | Sharpe | DSR   | win%  | fees/gross');
    for (const r of rows.sort((a, b) => Number(b.m.pf) - Number(a.m.pf))) {
      console.log(
        `${r.hash} | ${JSON.stringify(r.params).padEnd(45)} | ${r.m.trades.padStart(6)} | ${r.m.net.padStart(6)} | ${r.m.pf.padStart(5)} | ${r.m.dd.padStart(6)} | ${r.m.sharpe.padStart(6)} | ${r.m.dsr.padStart(5)} | ${r.m.win.padStart(5)} | ${r.m.feeShare}`,
      );
    }
    console.log(
      `\nDecision rules (SPEC §7.4): ≥100 trades before judgment; kill if PF<1.1; holdout is ONE evaluation, ever.`,
    );
  } finally {
    await app.close();
  }
}

function fmt(m: {
  nTrades: number;
  netReturnPct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  sharpeAnnualized: number;
  deflatedSharpeProb: number;
  winRate: number;
  feeShareOfGross: number;
}) {
  return {
    trades: String(m.nTrades),
    net: m.netReturnPct.toFixed(1),
    pf: Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : 'inf',
    dd: m.maxDrawdownPct.toFixed(1),
    sharpe: m.sharpeAnnualized.toFixed(2),
    dsr: Number.isNaN(m.deflatedSharpeProb) ? 'n/a' : m.deflatedSharpeProb.toFixed(2),
    win: (m.winRate * 100).toFixed(0),
    feeShare: Number.isFinite(m.feeShareOfGross) ? m.feeShareOfGross.toFixed(2) : 'n/a',
  };
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
