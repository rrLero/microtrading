import type { BacktestResult } from './engine.js';

/**
 * Evaluation metrics (SPEC §7.3) — computed identically for backtest and paper.
 * Includes the deflated Sharpe ratio (Bailey & López de Prado 2014): a Sharpe
 * that ignores how many configurations were tried is marketing, not measurement.
 */

export interface Metrics {
  readonly netReturnPct: number;
  readonly maxDrawdownPct: number;
  readonly profitFactor: number;
  readonly sharpeAnnualized: number;
  /** P[true SR > 0] corrected for nTrials; NaN when inputs are degenerate. */
  readonly deflatedSharpeProb: number;
  readonly nTrades: number;
  readonly winRate: number;
  readonly avgWin: number;
  readonly avgLoss: number;
  readonly exposurePct: number;
  readonly feesTotal: number;
  readonly feeShareOfGross: number;
}

const HOURS_PER_YEAR = 24 * 365;

export function computeMetrics(result: BacktestResult, nTrials: number): Metrics {
  const returns: number[] = [];
  for (let i = 1; i < result.equityCurve.length; i++) {
    const prev = result.equityCurve[i - 1]!.equity;
    if (prev > 0) returns.push(result.equityCurve[i]!.equity / prev - 1);
  }
  return computeMetricsFromParts(returns, result.trades, nTrials, result.equityCurve.length);
}

/**
 * Metrics from pooled parts — used for walk-forward evaluation, where per-candle
 * returns and trades from multiple OOS test windows are concatenated (each
 * window starts from its own reset equity, so only returns pool cleanly).
 */
export function computeMetricsFromParts(
  returns: readonly number[],
  trades: BacktestResult['trades'],
  nTrials: number,
  candleCount: number,
): Metrics {
  // Compound the return stream to get net return / drawdown on the pooled series
  const equityCurve: { ts: number; equity: number }[] = [{ ts: 0, equity: 1 }];
  let eq = 1;
  for (let i = 0; i < returns.length; i++) {
    eq *= 1 + returns[i]!;
    equityCurve.push({ ts: i + 1, equity: eq });
  }
  const initial = 1;
  const final = eq;

  const mean = avg(returns);
  const sd = std(returns, mean);
  const sharpeHourly = sd > 0 ? mean / sd : 0;
  const sharpeAnnualized = sharpeHourly * Math.sqrt(HOURS_PER_YEAR);

  let peak = -Infinity;
  let maxDd = 0;
  for (const p of equityCurve) {
    peak = Math.max(peak, p.equity);
    if (peak > 0) maxDd = Math.max(maxDd, (peak - p.equity) / peak);
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWins = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLosses = -losses.reduce((s, t) => s + t.pnl, 0);
  const feesTotal = trades.reduce((s, t) => s + t.fees, 0);

  // Exposure: candles between entry and exit of any trade
  let exposedCandles = 0;
  if (equityCurve.length > 0) {
    for (const t of trades) exposedCandles += Math.max(1, Math.round((t.exitTs - t.entryTs) / 3_600_000));
  }

  return {
    netReturnPct: initial > 0 ? ((final - initial) / initial) * 100 : 0,
    maxDrawdownPct: maxDd * 100,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
    sharpeAnnualized,
    deflatedSharpeProb: deflatedSharpeProbability(sharpeHourly, returns, nTrials),
    nTrades: trades.length,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    avgWin: wins.length > 0 ? grossWins / wins.length : 0,
    avgLoss: losses.length > 0 ? grossLosses / losses.length : 0,
    exposurePct: candleCount > 0 ? (exposedCandles / candleCount) * 100 : 0,
    feesTotal,
    feeShareOfGross: grossWins > 0 ? feesTotal / grossWins : 0,
  };
}

/**
 * Deflated Sharpe (Bailey & López de Prado): probability that the true Sharpe
 * exceeds the expected max Sharpe of nTrials random strategies, accounting for
 * return skew/kurtosis and sample length. Uses per-period (hourly) SR.
 */
export function deflatedSharpeProbability(srPeriod: number, returns: readonly number[], nTrials: number): number {
  const T = returns.length;
  if (T < 100 || nTrials < 1) return NaN;

  const m = avg(returns);
  const s = std(returns, m);
  if (s === 0) return NaN;
  const skew = avg(returns.map((r) => ((r - m) / s) ** 3));
  const kurt = avg(returns.map((r) => ((r - m) / s) ** 4));

  // Expected max SR under nTrials trials of pure noise (variance of SR estimator ≈ 1/T)
  const gamma = 0.5772156649015329;
  const sdSr = Math.sqrt(1 / T);
  const z1 = nTrials > 1 ? normInv(1 - 1 / nTrials) : 0;
  const z2 = nTrials > 1 ? normInv(1 - 1 / (nTrials * Math.E)) : 0;
  const sr0 = sdSr * ((1 - gamma) * z1 + gamma * z2);

  const numer = (srPeriod - sr0) * Math.sqrt(T - 1);
  const denom = Math.sqrt(1 - skew * srPeriod + ((kurt - 1) / 4) * srPeriod * srPeriod);
  if (!Number.isFinite(denom) || denom <= 0) return NaN;
  return normCdf(numer / denom);
}

function avg(xs: readonly number[]): number {
  return xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function std(xs: readonly number[], mean: number): number {
  if (xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1));
}

/** Standard normal CDF via erf approximation (Abramowitz–Stegun 7.1.26). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Standard normal quantile (Acklam's approximation). */
export function normInv(p: number): number {
  if (p <= 0 || p >= 1) return NaN;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p <= 1 - pl) {
    q = p - 0.5;
    r = q * q;
    return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
}
