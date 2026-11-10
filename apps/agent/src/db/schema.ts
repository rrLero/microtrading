import { bigint, doublePrecision, index, jsonb, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Candle store. Timestamps are UTC epoch ms (SPEC §3.4).
 * Primary key (symbol, timeframe, ts) makes ingestion idempotent via upsert.
 */
export const candles = pgTable(
  'candles',
  {
    symbol: text('symbol').notNull(),
    timeframe: text('timeframe').notNull(),
    ts: bigint('ts', { mode: 'number' }).notNull(),
    open: doublePrecision('open').notNull(),
    high: doublePrecision('high').notNull(),
    low: doublePrecision('low').notNull(),
    close: doublePrecision('close').notNull(),
    volume: doublePrecision('volume').notNull(),
    source: text('source').notNull(), // e.g. 'kraken-rest', 'kraken-csv', 'bybit-rest'
  },
  (t) => [primaryKey({ columns: [t.symbol, t.timeframe, t.ts] }), index('candles_ts_idx').on(t.ts)],
);

/**
 * Append-only journal (SPEC §4: every decision, order, fill, LLM output).
 * Rows are never updated or deleted — corrections are new entries.
 */
export const journal = pgTable(
  'journal',
  {
    id: serial('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    kind: text('kind').notNull(), // 'decision' | 'order' | 'fill' | 'llm' | 'risk' | 'ops'
    payload: jsonb('payload').notNull(),
  },
  (t) => [index('journal_kind_idx').on(t.kind), index('journal_at_idx').on(t.at)],
);

/**
 * Paper trading account state (SPEC Phase 2). One row per symbol.
 * Persisted so restarts reconcile instead of forgetting (SPEC §3.5).
 */
export const paperAccount = pgTable('paper_account', {
  symbol: text('symbol').primaryKey(),
  cash: doublePrecision('cash').notNull(),
  positionQty: doublePrecision('position_qty').notNull().default(0),
  avgEntryPrice: doublePrecision('avg_entry_price').notNull().default(0),
  stopPrice: doublePrecision('stop_price'),
  openedAt: bigint('opened_at', { mode: 'number' }),
  dayKey: text('day_key'), // UTC date of dayStartEquity
  dayStartEquity: doublePrecision('day_start_equity'),
  killSwitch: text('kill_switch').notNull().default('off'), // 'off' | 'on'
  /** Open-ts of the last candle the loop fully processed — catch-up replay resumes after it. */
  lastProcessedTs: bigint('last_processed_ts', { mode: 'number' }),
});

/**
 * Experiment registry (SPEC §7.1). Pre-registrations and trial runs.
 * The §7 tooling refuses holdout evaluation unless a pre-registration row exists
 * and the trial budget (<=20 configs/family) is respected.
 */
export const experiments = pgTable(
  'experiments',
  {
    id: serial('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    kind: text('kind').notNull(), // 'preregistration' | 'trial' | 'holdout-evaluation'
    strategyFamily: text('strategy_family').notNull(),
    paramsHash: text('params_hash'),
    gitSha: text('git_sha'),
    payload: jsonb('payload').notNull(), // grid / params / results
  },
  (t) => [index('experiments_family_idx').on(t.strategyFamily)],
);

/**
 * Perp funding prints (V2, SPEC §7.5 D5). One row per settlement, rate per 8h as a
 * fraction; positive = longs pay shorts. Idempotent on (symbol, ts).
 */
export const fundingRates = pgTable(
  'funding_rates',
  {
    symbol: text('symbol').notNull(),
    ts: bigint('ts', { mode: 'number' }).notNull(),
    rate: doublePrecision('rate').notNull(),
    source: text('source').notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.ts] })],
);
