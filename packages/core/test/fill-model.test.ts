import { describe, it, expect } from 'vitest';
import { modelFill } from '../src/fill-model.js';

const costs = { takerFeeRate: 0.0026, slippageRate: 0.0003 };

describe('modelFill (SPEC §6.2)', () => {
  it('moves the price against the trader on both sides', () => {
    expect(modelFill('buy', 100, 1, costs).fillPrice).toBeCloseTo(100.03, 10);
    expect(modelFill('sell', 100, 1, costs).fillPrice).toBeCloseTo(99.97, 10);
  });

  it('charges the taker fee on the post-slippage notional', () => {
    const buy = modelFill('buy', 100, 2, costs);
    expect(buy.notional).toBeCloseTo(200.06, 10);
    expect(buy.fee).toBeCloseTo(200.06 * 0.0026, 10);
  });

  it('round-trips at a loss with zero price movement — costs are never free', () => {
    const buy = modelFill('buy', 100, 1, costs);
    const sell = modelFill('sell', 100, 1, costs);
    expect(sell.notional - sell.fee).toBeLessThan(buy.notional + buy.fee);
  });

  // The §6.3 gate is only meaningful if the probe's paper side is THIS function.
  // If someone reintroduces a local copy, this pins the arithmetic it must match.
  it('matches the arithmetic the calibration probe reports as "modeled"', () => {
    const { fillPrice, fee } = modelFill('buy', 64019, 0.015619, costs);
    expect(fillPrice).toBeCloseTo(64019 * 1.0003, 10);
    expect(fee).toBeCloseTo(0.015619 * 64019 * 1.0003 * 0.0026, 10);
  });
});
