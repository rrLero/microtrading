import type { AccountState, OrderRequest, OrderState } from '../types.js';

/**
 * The single seam between the deterministic core and the outside world.
 * Implementations: PaperAdapter (local sim), BybitDemoAdapter, LiveAdapter (Kraken).
 * SPEC §4.1.1: backtest, paper, and live differ ONLY in this adapter.
 */
export interface ExchangeAdapter {
  readonly name: string;
  placeOrder(req: OrderRequest): Promise<OrderState>;
  cancelOrder(clientOrderId: string, symbol: string): Promise<void>;
  /** Open orders as the venue sees them — used for restart reconciliation (SPEC §3.5). */
  fetchOpenOrders(symbol: string): Promise<readonly OrderState[]>;
  fetchAccountState(symbol: string): Promise<AccountState>;
  /** Cancel everything and go flat. The kill switch calls this (SPEC §4.1.4). */
  flattenAll(symbol: string): Promise<void>;
}
