/**
 * Does the LLM analyst's regime label carry information about what BTC did next?
 *
 * Observation only: no strategy reads the label, nothing is selected on this,
 * so it is not a trial and N is unchanged (PHASE4-PREREG §4, §6). The rules
 * below were fixed 2026-11-11, before the first run:
 * - one call per daily row; forward return from the last 1h close at or before
 *   `asOf` to the last 1h close at or before `asOf + horizon`;
 * - a call is HIT at 7d when bull/rebound -> r > 0, bear -> r < 0,
 *   range -> |r| < RANGE_BAND;
 * - calibration = Brier score of `confidence` against HIT, compared with a
 *   constant forecast at the observed hit rate (skill > 0 beats the constant).
 */
export const HORIZONS_DAYS = [1, 7, 30] as const;
export const HIT_HORIZON_DAYS = 7;
export const RANGE_BAND = 0.03;

export interface AnalystCall {
  asOf: number;
  label: string;
  confidence: number;
}

export interface ScoredCall extends AnalystCall {
  /** Forward return per horizon in days; undefined until that horizon has closed. */
  fwd: Partial<Record<(typeof HORIZONS_DAYS)[number], number>>;
  hit?: boolean | undefined;
  /** What a trailing-7d-return rule would have said, and whether it was right. */
  baselineLabel?: 'bull' | 'bear' | 'range' | undefined;
  baselineHit?: boolean | undefined;
}

const DAY = 86_400_000;

/** `closes` must be sorted by ts ascending. */
export function scoreCalls(calls: AnalystCall[], closes: { ts: number; close: number }[]): ScoredCall[] {
  const last = closes.at(-1)?.ts ?? -Infinity;
  const priceAt = (t: number): number | undefined => {
    let lo = 0, hi = closes.length - 1, best: number | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (closes[mid]!.ts <= t) { best = closes[mid]!.close; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  };
  return calls.map((c) => {
    const p0 = priceAt(c.asOf);
    const fwd: ScoredCall['fwd'] = {};
    for (const h of HORIZONS_DAYS) {
      const t = c.asOf + h * DAY;
      const p1 = priceAt(t);
      if (p0 !== undefined && p1 !== undefined && t <= last) fwd[h] = p1 / p0 - 1;
    }
    const r = fwd[HIT_HORIZON_DAYS];
    const pBack = priceAt(c.asOf - HIT_HORIZON_DAYS * DAY);
    const baselineLabel = p0 !== undefined && pBack !== undefined ? naiveLabel(p0 / pBack - 1) : undefined;
    return {
      ...c,
      fwd,
      hit: r === undefined ? undefined : isHit(c.label, r),
      baselineLabel,
      baselineHit: r === undefined || baselineLabel === undefined ? undefined : isHit(baselineLabel, r),
    };
  });
}

/**
 * The bar the analyst must clear (added 2026-11-11, before any baseline run):
 * label the last 7 days by their own return, using the same band as `range`.
 */
export function naiveLabel(trailing: number): 'bull' | 'bear' | 'range' {
  return trailing > RANGE_BAND ? 'bull' : trailing < -RANGE_BAND ? 'bear' : 'range';
}

export function isHit(label: string, r: number): boolean {
  if (label === 'bull' || label === 'rebound') return r > 0;
  if (label === 'bear') return r < 0;
  return Math.abs(r) < RANGE_BAND;
}

export interface Calibration {
  n: number;
  hitRate: number;
  brier: number;
  brierConstant: number;
  /** 1 - brier / brierConstant: > 0 means confidence beats a constant guess. */
  skill: number;
}

export function calibration(scored: ScoredCall[]): Calibration | undefined {
  const s = scored.filter((c) => c.hit !== undefined);
  if (!s.length) return undefined;
  const y = (c: ScoredCall) => (c.hit ? 1 : 0);
  const hitRate = s.reduce((a, c) => a + y(c), 0) / s.length;
  const brier = s.reduce((a, c) => a + (c.confidence - y(c)) ** 2, 0) / s.length;
  const brierConstant = hitRate * (1 - hitRate);
  return { n: s.length, hitRate, brier, brierConstant, skill: brierConstant ? 1 - brier / brierConstant : 0 };
}
