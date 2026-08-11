/**
 * Core domain types. Pure TypeScript — no framework imports allowed in this package.
 * All timestamps are UTC epoch milliseconds (SPEC §3: UTC everywhere, display-only conversion).
 */

export type Timeframe = '1h' | '4h';

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1h': 3_600_000,
  '4h': 14_400_000,
};

/** A fully CLOSED candle. Forming candles must never construct this type (SPEC §3.1). */
export interface Candle {
  /** Open time, UTC epoch ms, aligned to the timeframe boundary. */
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export type Side = 'buy' | 'sell';

export type OrderType = 'market' | 'limit' | 'stop-market';

export type OrderStatus = 'pending' | 'open' | 'filled' | 'partially-filled' | 'canceled' | 'rejected';

export interface OrderRequest {
  /** Client-generated idempotency key (SPEC §4.1.3). */
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly side: Side;
  readonly type: OrderType;
  /** Base-asset quantity. */
  readonly quantity: number;
  /** Required for limit orders. */
  readonly limitPrice?: number;
  /** Required for stop-market orders. */
  readonly stopPrice?: number;
}

export interface Fill {
  readonly orderClientId: string;
  readonly timestamp: number;
  readonly price: number;
  readonly quantity: number;
  /** Fee in quote currency, always >= 0. */
  readonly fee: number;
}

export interface OrderState {
  readonly request: OrderRequest;
  readonly status: OrderStatus;
  readonly fills: readonly Fill[];
}

export interface Position {
  readonly symbol: string;
  /** Base-asset quantity currently held. 0 = flat. */
  readonly quantity: number;
  readonly avgEntryPrice: number;
  /** clientOrderId of the protective stop attached to this position (SPEC §5.2). */
  readonly stopOrderId: string | null;
  readonly openedAt: number;
}

export interface AccountState {
  /** Equity in quote currency (cash + mark-to-market of positions). */
  readonly equity: number;
  readonly cash: number;
  readonly position: Position | null;
}

/** What a strategy is allowed to say. It cannot size positions or place orders. */
export type Signal =
  | { readonly kind: 'enter-long'; readonly reason: string }
  | { readonly kind: 'exit'; readonly reason: string }
  | { readonly kind: 'hold' };

/** Read-only view a strategy receives. Only CLOSED candles (SPEC §3.1–3.3). */
export interface StrategyContext {
  readonly symbol: string;
  /** Closed 1h candles, oldest → newest. Last element is the decision candle t. */
  readonly candles1h: readonly Candle[];
  /** Closed 4h candles as of the decision time — the forming 4h candle is excluded (SPEC §3.3). */
  readonly candles4h: readonly Candle[];
  readonly position: Position | null;
}

export interface Strategy {
  readonly id: string;
  /** Params must be serializable — they are hashed into the experiment registry (SPEC §7.1). */
  readonly params: Readonly<Record<string, number | string | boolean>>;
  /** Minimum number of 1h candles required before the strategy can emit non-hold signals. */
  readonly warmupCandles: number;
  onCandle(ctx: StrategyContext): Signal;
}
