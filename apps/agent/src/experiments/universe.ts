import { readFileSync } from 'node:fs';

/**
 * The pre-registered evaluation universe (SPEC §2.2, §7.5 D3).
 *
 * One loader, because three callers need it — the backfiller, the pooled
 * runner, and the spread sampler — and three copies of a relative path is how
 * one of them quietly ends up reading a different universe than the others.
 *
 * Resolved from dist/experiments/ → /repo/experiments/universe.json, which the
 * Dockerfile copies into the runtime image for exactly this reason.
 */
export interface UniversePair {
  readonly symbol: string;
  readonly historyFrom: string;
  readonly quoteVolume24hAtSelection: number;
}

export interface Universe {
  readonly selectedAt: string;
  readonly dataVenue: string;
  readonly executionVenue: string;
  readonly pairs: UniversePair[];
}

const UNIVERSE_URL = new URL('../../../../experiments/universe.json', import.meta.url);

let cached: Universe | null = null;

export function loadUniverse(): Universe {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(UNIVERSE_URL, 'utf8')) as Universe;
  return cached;
}

/** Symbols only — the common case. */
export function universeSymbols(): string[] {
  return loadUniverse().pairs.map((p) => p.symbol);
}
