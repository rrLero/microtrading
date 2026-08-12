import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  addUtcMonths,
  buildWalkForwardWindows,
  computeMetricsFromParts,
  donchianBreakout,
  rsiReversion,
  runBacktest,
  smaCrossover,
  startOfUtcMonth,
  DEFAULT_RISK,
  type BacktestConfig,
  type Candle,
  type CostParams,
  type Metrics,
  type Strategy,
  type Trade,
} from '@microtrading/core';
import { DbService } from '../db/db.service.js';
import { experiments } from '../db/schema.js';

/**
 * Experiment registry (SPEC §7.1) — the discipline layer, enforced by tooling
 * because the researcher and the developer are the same person:
 *  - pre-registration is immutable and capped at 20 configs per family;
 *  - every trial is logged; N is printed on every report;
 *  - the holdout boundary is FROZEN at pre-registration time;
 *  - the holdout can be evaluated exactly once per family.
 */

export type StrategyFamily = 'sma-crossover' | 'rsi-reversion' | 'donchian-breakout';

export const FACTORIES: Record<StrategyFamily, (params: Record<string, number>) => Strategy> = {
  'sma-crossover': (p) => smaCrossover(p as { fast: number; slow: number; trendSma4h: number }),
  'rsi-reversion': (p) =>
    rsiReversion(p as { rsiPeriod: number; oversold: number; exitLevel: number; trendSma4h: number }),
  'donchian-breakout': (p) => donchianBreakout(p as { entryLookback: number; exitLookback: number }),
};

export const MAX_TRIALS_PER_FAMILY = 20;
/** Candles of warmup context prepended before each test window (not counted). */
const WARMUP_CANDLES = 720;

export const DEFAULT_BT: BacktestConfig = {
  initialEquity: 10_000,
  // Kraken standard-crypto spot, Level 1 (30-day volume > $0): 0.80% taker.
  // Verified 2026-08-12 against kraken.com/features/fee-schedule. BTC/USDC takes
  // the standard table, not the cheaper stablecoin/FX one — a stablecoin that is
  // only the QUOTE currency does not qualify (Kraken's own example: BTC/DAI).
  // Level 1 is the modelled tier per §6.2 pessimistic-mode: a live account starts
  // at zero 30-day volume, and this strategy's turnover (10-25 round trips/yr)
  // cannot hold a better tier through its own dry spells.
  // Was 0.0026 until 2026-08-12 — wrong, and optimistic by 3.08x. See §7 deviation log.
  costs: { takerFeeRate: 0.008, slippageRate: 0.0003 },
  risk: DEFAULT_RISK,
  atrPeriod: 14,
};

/**
 * Family-specific backtest config. Lesson from the rsi-reversion autopsy:
 * stop distance must match the holding timescale. The 4h Donchian family holds
 * for days-weeks, so it gets a wider stop (4 × ATR over a 4h-equivalent
 * window) instead of the 1h-tuned default that strangles slow trades.
 */
export function btFor(family: StrategyFamily): BacktestConfig {
  if (family === 'donchian-breakout') {
    return { ...DEFAULT_BT, atrPeriod: 56, risk: { ...DEFAULT_RISK, atrStopMultiple: 4 } };
  }
  return DEFAULT_BT;
}

export interface Preregistration {
  readonly family: StrategyFamily;
  readonly grid: Record<string, number>[];
  readonly holdoutFrom: number;
  readonly createdAt: Date;
}

export function paramsHash(params: Record<string, number>): string {
  const stable = JSON.stringify(Object.keys(params).sort().map((k) => [k, params[k]]));
  return createHash('sha256').update(stable).digest('hex').slice(0, 16);
}

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'no-git';
  }
}

@Injectable()
export class ExperimentService {
  private readonly log = new Logger(ExperimentService.name);

  constructor(private readonly dbs: DbService) {}

  async preregister(family: StrategyFamily, grid: Record<string, number>[]): Promise<void> {
    if (!FACTORIES[family]) throw new Error(`Unknown strategy family: ${family}`);
    if (grid.length === 0) throw new Error('Empty grid.');
    if (grid.length > MAX_TRIALS_PER_FAMILY) {
      throw new Error(`Grid has ${grid.length} configs — budget is ${MAX_TRIALS_PER_FAMILY} (SPEC §7.1). Cut it down.`);
    }
    const existing = await this.getPreregistration(family);
    if (existing) {
      throw new Error(
        `Family '${family}' is already pre-registered (${existing.grid.length} configs, holdout from ${new Date(existing.holdoutFrom).toISOString()}). ` +
          `Pre-registrations are immutable — a new idea is a NEW family name.`,
      );
    }
    // Sanity-check every config constructs
    for (const params of grid) FACTORIES[family](params);

    const holdoutFrom = startOfUtcMonth(addUtcMonths(Date.now(), -12));
    await this.dbs.db.insert(experiments).values({
      kind: 'preregistration',
      strategyFamily: family,
      paramsHash: null,
      gitSha: gitSha(),
      payload: { grid, holdoutFrom },
    });
    this.log.log(
      `Pre-registered '${family}': ${grid.length} configs. Holdout FROZEN at ${new Date(holdoutFrom).toISOString()} — development never touches data after this date.`,
    );
  }

  async getPreregistration(family: string): Promise<Preregistration | null> {
    const rows = await this.dbs.db
      .select()
      .from(experiments)
      .where(and(eq(experiments.strategyFamily, family), eq(experiments.kind, 'preregistration')));
    const row = rows[0];
    if (!row) return null;
    const payload = row.payload as { grid: Record<string, number>[]; holdoutFrom: number };
    return { family: family as StrategyFamily, grid: payload.grid, holdoutFrom: payload.holdoutFrom, createdAt: row.at };
  }

  async countTrials(family: string): Promise<number> {
    const rows = await this.dbs.db
      .select({ id: experiments.id })
      .from(experiments)
      .where(and(eq(experiments.strategyFamily, family), eq(experiments.kind, 'trial')));
    return rows.length;
  }

  async holdoutAlreadyRun(family: string): Promise<boolean> {
    const rows = await this.dbs.db
      .select({ id: experiments.id })
      .from(experiments)
      .where(and(eq(experiments.strategyFamily, family), eq(experiments.kind, 'holdout-evaluation')));
    return rows.length > 0;
  }

  /** Walk-forward evaluation of one config over the development window. */
  /**
   * `costsOverride` exists solely for cost-sensitivity analysis (break-even
   * taker rate). It changes an input constant, never the grid or the windows,
   * and this method does not log trials — so a sweep adds no selection
   * opportunity and does not consume trial budget.
   */
  evaluateConfig(
    family: StrategyFamily,
    params: Record<string, number>,
    devCandles: readonly Candle[],
    nTrialsForDsr: number,
    costsOverride?: CostParams,
  ): { metrics: Metrics; windows: number } {
    const first = devCandles[0];
    const last = devCandles[devCandles.length - 1];
    if (!first || !last) throw new Error('No development candles.');
    const windows = buildWalkForwardWindows(first.timestamp, last.timestamp + 3_600_000);

    const pooledReturns: number[] = [];
    const pooledTrades: Trade[] = [];
    let candleCount = 0;

    for (const w of windows) {
      const startIdx = devCandles.findIndex((c) => c.timestamp >= w.testFrom);
      if (startIdx < 0) continue;
      const sliceFrom = Math.max(0, startIdx - WARMUP_CANDLES);
      const slice = devCandles.filter((c, i) => i >= sliceFrom && c.timestamp < w.testTo);
      const strategy = FACTORIES[family](params);
      const base = btFor(family);
      const result = runBacktest(slice, strategy, costsOverride ? { ...base, costs: costsOverride } : base);

      // Count only the test window: trades entered inside it, returns inside it
      for (const t of result.trades) if (t.entryTs >= w.testFrom) pooledTrades.push(t);
      let prev: number | null = null;
      for (const p of result.equityCurve) {
        if (p.ts < w.testFrom) continue;
        if (prev !== null && prev > 0) pooledReturns.push(p.equity / prev - 1);
        prev = p.equity;
        candleCount++;
      }
    }

    return {
      metrics: computeMetricsFromParts(pooledReturns, pooledTrades, nTrialsForDsr, candleCount),
      windows: windows.length,
    };
  }

  async logTrial(family: string, params: Record<string, number>, metrics: Metrics, windows: number): Promise<void> {
    await this.dbs.db.insert(experiments).values({
      kind: 'trial',
      strategyFamily: family,
      paramsHash: paramsHash(params),
      gitSha: gitSha(),
      payload: { params, metrics, windows },
    });
  }

  async trialExists(family: string, params: Record<string, number>): Promise<boolean> {
    const rows = await this.dbs.db
      .select({ id: experiments.id })
      .from(experiments)
      .where(
        and(
          eq(experiments.strategyFamily, family),
          eq(experiments.kind, 'trial'),
          eq(experiments.paramsHash, paramsHash(params)),
        ),
      );
    return rows.length > 0;
  }

  async logHoldoutEvaluation(family: string, params: Record<string, number>, metrics: Metrics): Promise<void> {
    await this.dbs.db.insert(experiments).values({
      kind: 'holdout-evaluation',
      strategyFamily: family,
      paramsHash: paramsHash(params),
      gitSha: gitSha(),
      payload: { params, metrics },
    });
  }
}
