/**
 * SPEC §6.2 taker fill model — the single definition of what a fill costs.
 *
 * Three places need this exact arithmetic: the backtest engine, the live
 * PaperBrokerService, and the §6.3 calibration probe. It was copy-pasted into
 * all three until 2026-08-12. The copies agreed numerically, so nothing was
 * visibly broken — but a §6.2 change would have left the probe silently
 * validating the old model, which is the one bug a calibration gate must never
 * have. One definition, three callers.
 */

export interface CostParams {
  /** Taker fee per side, e.g. 0.0026 for Kraken entry tier 0.26%. */
  readonly takerFeeRate: number;
  /** Slippage per fill as a rate, e.g. 0.0003. */
  readonly slippageRate: number;
}

export interface ModeledFill {
  /** Reference price, moved against the trader by slippage. */
  readonly fillPrice: number;
  /** quantity · fillPrice — notional exchanged, before fees. */
  readonly notional: number;
  /** Taker fee charged on the notional. */
  readonly fee: number;
}

/**
 * Pessimistic taker fill (§6.2): slippage always moves the price against you,
 * buy or sell. Fees are charged on the post-slippage notional.
 *
 * ponytail: slippage is the flat configured rate, not §6.2's literal
 * max(half-spread, 0.03%) — the live loop holds no book snapshot at fill time.
 * Kraken half-spread samples (journal ops/spread-sample) have stayed well under
 * the 0.03% floor, so the flat rate is the stricter of the two in practice.
 * If sampled spreads start exceeding the floor, take the max here.
 */
export function modelFill(
  side: 'buy' | 'sell',
  refPrice: number,
  quantity: number,
  costs: CostParams,
): ModeledFill {
  const fillPrice = refPrice * (side === 'buy' ? 1 + costs.slippageRate : 1 - costs.slippageRate);
  const notional = quantity * fillPrice;
  return { fillPrice, notional, fee: notional * costs.takerFeeRate };
}
