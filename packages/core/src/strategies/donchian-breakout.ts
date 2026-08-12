import type { Signal, Strategy, StrategyContext } from '../types.js';

/**
 * Donchian channel breakout on the 4h timeframe (V1's third and final family).
 * Enter long when the last closed 4h candle closes above the highest high of
 * the previous `entryLookback` 4h candles; exit when it closes below the lowest
 * low of the previous `exitLookback` 4h candles. Classic slow trend-following
 * (turtle-style): few trades, long holds — the structural answer to the cost
 * drag that killed both 1h families. Stops/sizing remain the risk engine's job
 * (this family pairs with wider ATR stops — see FAMILY_BT in the agent).
 */
export interface DonchianBreakoutParams extends Record<string, number> {
  entryLookback: number; // in 4h candles
  exitLookback: number; // in 4h candles
}

export interface DonchianBounds {
  /** Highest high of the `entryLookback` candles BEFORE the last closed one. */
  readonly upper: number;
  /** Lowest low of the `exitLookback` candles before it. */
  readonly lower: number;
  /** Close of the last closed 4h candle — what the rule compares against. */
  readonly close: number;
}

/**
 * The channel the strategy is watching, as of the last closed 4h candle.
 *
 * Exported because the dashboard needs to SHOW the corridor, and a second
 * implementation of "highest high of the previous N" would be free to drift
 * from the one that actually trades. Same lookback windows as `onCandle`:
 * both exclude the last candle, since a candle cannot break out of itself.
 */
export function donchianBounds(
  candles4h: readonly { high: number; low: number; close: number }[],
  entryLookback: number,
  exitLookback: number,
): DonchianBounds | null {
  const i = candles4h.length - 1;
  if (i < Math.max(entryLookback, exitLookback)) return null;
  let upper = -Infinity;
  for (let k = i - entryLookback; k < i; k++) upper = Math.max(upper, candles4h[k]!.high);
  let lower = Infinity;
  for (let k = i - exitLookback; k < i; k++) lower = Math.min(lower, candles4h[k]!.low);
  return { upper, lower, close: candles4h[i]!.close };
}

export function donchianBreakout(params: DonchianBreakoutParams): Strategy {
  const { entryLookback, exitLookback } = params;
  if (entryLookback < 2 || exitLookback < 2) throw new RangeError('lookbacks must be >= 2');
  return {
    id: `donchian-breakout(${entryLookback},${exitLookback})`,
    params,
    // 1h warmup: enough closed 4h candles for the entry channel (+2 margin)
    warmupCandles: (entryLookback + 2) * 4,
    onCandle(ctx: StrategyContext): Signal {
      const c4 = ctx.candles4h;
      const i = c4.length - 1;
      if (i < entryLookback) return { kind: 'hold' };
      const last = c4[i]!;

      if (ctx.position) {
        if (i < exitLookback) return { kind: 'hold' };
        const lowest = donchianBounds(c4, exitLookback, exitLookback)!.lower;
        return last.close < lowest
          ? { kind: 'exit', reason: `4h close below ${exitLookback}-candle low ${lowest.toFixed(0)}` }
          : { kind: 'hold' };
      }

      const highest = donchianBounds(c4, entryLookback, entryLookback)!.upper;
      return last.close > highest
        ? { kind: 'enter-long', reason: `4h close above ${entryLookback}-candle high ${highest.toFixed(0)}` }
        : { kind: 'hold' };
    },
  };
}
