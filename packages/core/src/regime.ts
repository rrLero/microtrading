import type { Candle } from './types.js';
import { sma } from './indicators/indicators.js';

/**
 * Regime segmentation for SPEC §7.2 reporting (resolves REVIEW R8).
 *
 * §7.2: "results reported per calendar year and per regime segment (trend state
 * from 200-day MA slope + drawdown state). A long-only strategy must demonstrate
 * it goes flat in bear segments — being flat for months is success, not failure."
 *
 * R8's point is that a backtest spanning one regime tells you about that regime
 * and nothing else, and that long-only strategies are the ones most flattered by
 * a trending sample. So the question this answers is not "what is the aggregate
 * PF" but "where did the PF come from, and what did the strategy do when the
 * trend was against it".
 *
 * Pure functions over price only — the regime is a property of the MARKET, never
 * of the strategy. Classifying with anything the strategy knows would let a
 * strategy define its own favourable weather.
 */

const MS_PER_DAY = 86_400_000;

/** §7.2 names the 200-day MA explicitly. */
export const MA_DAYS = 200;
/**
 * Slope is measured over a lookback rather than day-over-day: a 200-day mean
 * moves so slowly that consecutive-day comparison is mostly rounding noise, and
 * it flickers across the sign boundary.
 */
export const SLOPE_LOOKBACK_DAYS = 20;
/**
 * ponytail: 20% is the conventional bear threshold and the spec does not fix
 * one. It is a knob, not a law — if a verdict ever turns on it, say so out loud
 * and report both sides rather than quietly picking the flattering value.
 */
export const DEEP_DRAWDOWN = 0.2;

/**
 * Four segments from the two axes §7.2 names. `bear` is the one that matters:
 * trend down AND deep drawdown is where a long-only strategy must show it stands
 * aside. The other three are reported so `bear` cannot be read in isolation.
 */
export type RegimeLabel = 'bull' | 'topping' | 'rebound' | 'bear';

export interface RegimeDay {
  /** UTC day index (epoch ms / 86_400_000). */
  readonly day: number;
  readonly close: number;
  /** NaN while the 200-day mean is still warming up. */
  readonly ma: number;
  /** Drawdown from the running peak of daily closes, 0..1. */
  readonly drawdown: number;
  /** null until both the MA and its lookback are available — unclassifiable, not "bull". */
  readonly label: RegimeLabel | null;
}

/** Last close of each UTC day, oldest → newest. Candles may be 1h or 4h. */
export function dailyCloses(candles: readonly Candle[]): { day: number; close: number }[] {
  const byDay = new Map<number, { ts: number; close: number }>();
  for (const c of candles) {
    const day = Math.floor(c.timestamp / MS_PER_DAY);
    const prev = byDay.get(day);
    // Guard against unsorted input rather than assuming it.
    if (!prev || c.timestamp >= prev.ts) byDay.set(day, { ts: c.timestamp, close: c.close });
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, v]) => ({ day, close: v.close }));
}

/**
 * Classify every day of the series.
 *
 * Warm-up days come back with `label: null` and MUST be excluded from regime
 * tables rather than folded into a bucket — the first 200 days of any series
 * would otherwise be silently attributed to whatever label the code defaults to.
 */
export function classifyRegimes(candles: readonly Candle[]): RegimeDay[] {
  const daily = dailyCloses(candles);
  const closes = daily.map((d) => d.close);
  const ma = sma(closes, MA_DAYS);

  let peak = -Infinity;
  return daily.map((d, i) => {
    peak = Math.max(peak, d.close);
    const drawdown = peak > 0 ? 1 - d.close / peak : 0;

    const here = ma[i]!;
    const back = ma[i - SLOPE_LOOKBACK_DAYS];
    const slopeKnown = Number.isFinite(here) && back !== undefined && Number.isFinite(back);

    let label: RegimeLabel | null = null;
    if (slopeKnown) {
      const up = here > back!;
      const deep = drawdown >= DEEP_DRAWDOWN;
      label = up ? (deep ? 'rebound' : 'bull') : deep ? 'bear' : 'topping';
    }
    return { day: d.day, close: d.close, ma: here, drawdown, label };
  });
}

/** Day index → label, for joining strategy returns and trades onto the regime. */
export function regimeByDay(candles: readonly Candle[]): Map<number, RegimeLabel> {
  const out = new Map<number, RegimeLabel>();
  for (const r of classifyRegimes(candles)) if (r.label) out.set(r.day, r.label);
  return out;
}

export const REGIME_ORDER: readonly RegimeLabel[] = ['bull', 'topping', 'rebound', 'bear'];

export const utcDay = (ts: number): number => Math.floor(ts / MS_PER_DAY);
export const utcYear = (ts: number): number => new Date(ts).getUTCFullYear();
