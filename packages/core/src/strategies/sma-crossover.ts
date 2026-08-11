import type { Signal, Strategy, StrategyContext } from '../types.js';
import { sma } from '../indicators/indicators.js';

/**
 * SMA crossover with 4h trend filter (SPEC §10, starter strategy 1).
 * Enter long when the fast SMA crosses above the slow SMA on 1h AND the last
 * closed 4h candle is above its own SMA (trend filter). Exit on reverse cross.
 * Stops/sizing are the risk engine's job — this emits intent only.
 */
export interface SmaCrossoverParams extends Record<string, number> {
  fast: number;
  slow: number;
  trendSma4h: number;
}

export function smaCrossover(params: SmaCrossoverParams): Strategy {
  const { fast, slow, trendSma4h } = params;
  if (fast >= slow) throw new RangeError(`fast (${fast}) must be < slow (${slow})`);
  return {
    id: `sma-crossover(${fast},${slow},${trendSma4h})`,
    params,
    warmupCandles: slow + 1,
    onCandle(ctx: StrategyContext): Signal {
      const closes = ctx.candles1h.map((c) => c.close);
      const f = sma(closes, fast);
      const s = sma(closes, slow);
      const i = closes.length - 1;
      const fNow = f[i]!;
      const sNow = s[i]!;
      const fPrev = f[i - 1]!;
      const sPrev = s[i - 1]!;
      if ([fNow, sNow, fPrev, sPrev].some((x) => !Number.isFinite(x))) return { kind: 'hold' };

      const crossedUp = fPrev <= sPrev && fNow > sNow;
      const crossedDown = fPrev >= sPrev && fNow < sNow;

      if (ctx.position) {
        return crossedDown ? { kind: 'exit', reason: 'fast SMA crossed below slow' } : { kind: 'hold' };
      }

      if (!crossedUp) return { kind: 'hold' };

      // 4h trend filter: last CLOSED 4h close above its SMA
      const closes4h = ctx.candles4h.map((c) => c.close);
      if (closes4h.length < trendSma4h) return { kind: 'hold' };
      const t = sma(closes4h, trendSma4h);
      const trendOk = closes4h[closes4h.length - 1]! > t[t.length - 1]!;
      return trendOk
        ? { kind: 'enter-long', reason: `SMA(${fast}) crossed above SMA(${slow}) in 4h uptrend` }
        : { kind: 'hold' };
    },
  };
}
