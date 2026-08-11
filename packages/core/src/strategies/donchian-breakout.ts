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
        let lowest = Infinity;
        for (let k = i - exitLookback; k < i; k++) lowest = Math.min(lowest, c4[k]!.low);
        return last.close < lowest
          ? { kind: 'exit', reason: `4h close below ${exitLookback}-candle low ${lowest.toFixed(0)}` }
          : { kind: 'hold' };
      }

      let highest = -Infinity;
      for (let k = i - entryLookback; k < i; k++) highest = Math.max(highest, c4[k]!.high);
      return last.close > highest
        ? { kind: 'enter-long', reason: `4h close above ${entryLookback}-candle high ${highest.toFixed(0)}` }
        : { kind: 'hold' };
    },
  };
}
