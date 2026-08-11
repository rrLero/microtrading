import type { Signal, Strategy, StrategyContext } from '../types.js';
import { rsi, sma } from '../indicators/indicators.js';

/**
 * RSI mean reversion within an uptrend (SPEC §10, starter strategy 2).
 * Enter long when 1h RSI dips below `oversold` while the last closed 4h candle
 * is above its SMA (only buy dips in uptrends). Exit when RSI reverts above
 * `exitLevel`. Stops/sizing are the risk engine's job.
 */
export interface RsiReversionParams extends Record<string, number> {
  rsiPeriod: number;
  oversold: number;
  exitLevel: number;
  trendSma4h: number;
}

export function rsiReversion(params: RsiReversionParams): Strategy {
  const { rsiPeriod, oversold, exitLevel, trendSma4h } = params;
  if (oversold >= exitLevel) throw new RangeError(`oversold (${oversold}) must be < exitLevel (${exitLevel})`);
  return {
    id: `rsi-reversion(${rsiPeriod},${oversold},${exitLevel},${trendSma4h})`,
    params,
    warmupCandles: rsiPeriod + 2,
    onCandle(ctx: StrategyContext): Signal {
      const closes = ctx.candles1h.map((c) => c.close);
      const r = rsi(closes, rsiPeriod);
      const now = r[r.length - 1]!;
      if (!Number.isFinite(now)) return { kind: 'hold' };

      if (ctx.position) {
        return now >= exitLevel ? { kind: 'exit', reason: `RSI reverted to ${now.toFixed(1)}` } : { kind: 'hold' };
      }

      if (now >= oversold) return { kind: 'hold' };

      const closes4h = ctx.candles4h.map((c) => c.close);
      if (closes4h.length < trendSma4h) return { kind: 'hold' };
      const t = sma(closes4h, trendSma4h);
      const trendOk = closes4h[closes4h.length - 1]! > t[t.length - 1]!;
      return trendOk
        ? { kind: 'enter-long', reason: `RSI ${now.toFixed(1)} oversold in 4h uptrend` }
        : { kind: 'hold' };
    },
  };
}
