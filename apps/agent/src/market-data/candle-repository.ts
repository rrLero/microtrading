import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, ne, sql } from 'drizzle-orm';
import type { Candle, Timeframe } from '@microtrading/core';
import { DbService } from '../db/db.service.js';
import { candles } from '../db/schema.js';

export interface CandleRow extends Candle {
  symbol: string;
  timeframe: Timeframe;
  source: string;
}

@Injectable()
export class CandleRepository {
  constructor(private readonly dbs: DbService) {}

  /** Idempotent upsert — safe to re-run any backfill range (SPEC §4.1.3 spirit). */
  async upsertMany(rows: readonly CandleRow[]): Promise<void> {
    if (rows.length === 0) return;
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map((r) => ({
        symbol: r.symbol,
        timeframe: r.timeframe,
        ts: r.timestamp,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
        source: r.source,
      }));
      await this.dbs.db
        .insert(candles)
        .values(chunk)
        .onConflictDoUpdate({
          target: [candles.symbol, candles.timeframe, candles.ts],
          set: {
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            close: sql`excluded.close`,
            volume: sql`excluded.volume`,
            source: sql`excluded.source`,
          },
        });
    }
  }

  async fetchSince(symbol: string, timeframe: Timeframe, sinceTs: number): Promise<Candle[]> {
    const rows = await this.dbs.db
      .select()
      .from(candles)
      .where(and(eq(candles.symbol, symbol), eq(candles.timeframe, timeframe), gte(candles.ts, sinceTs)))
      .orderBy(asc(candles.ts));
    return rows.map((r) => ({
      timestamp: r.ts,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));
  }

  /** Remove candles by source tag (e.g. purge 'gap-fill-flat' before re-healing). */
  async deleteBySource(symbol: string, timeframe: Timeframe, source: string): Promise<void> {
    await this.dbs.db
      .delete(candles)
      .where(and(eq(candles.symbol, symbol), eq(candles.timeframe, timeframe), eq(candles.source, source)));
  }

  /** Remove a whole derived timeframe (4h is fully rebuildable from 1h). */
  async deleteTimeframe(symbol: string, timeframe: Timeframe): Promise<void> {
    await this.dbs.db
      .delete(candles)
      .where(and(eq(candles.symbol, symbol), eq(candles.timeframe, timeframe)));
  }

  /** Rows stored under a source other than the expected one — i.e. a venue change we must not silently splice. */
  async countBySourceOtherThan(symbol: string, source: string): Promise<number> {
    const rows = await this.dbs.db
      .select({ n: sql<string | number>`count(*)` })
      .from(candles)
      .where(and(eq(candles.symbol, symbol), ne(candles.source, source)));
    return Number(rows[0]?.n ?? 0);
  }

  async countRows(symbol: string, timeframe: Timeframe): Promise<number> {
    const rows = await this.dbs.db
      .select({ n: sql<string | number>`count(*)` })
      .from(candles)
      .where(and(eq(candles.symbol, symbol), eq(candles.timeframe, timeframe)));
    return Number(rows[0]?.n ?? 0);
  }

  async earliestTimestamp(symbol: string, timeframe: Timeframe): Promise<number | null> {
    const rows = await this.dbs.db
      .select({ ts: sql<string | number | null>`min(${candles.ts})` })
      .from(candles)
      .where(and(eq(candles.symbol, symbol), eq(candles.timeframe, timeframe)));
    const raw = rows[0]?.ts;
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  async latestTimestamp(symbol: string, timeframe: Timeframe): Promise<number | null> {
    const rows = await this.dbs.db
      .select({ ts: sql<string | number | null>`max(${candles.ts})` })
      .from(candles)
      .where(and(eq(candles.symbol, symbol), eq(candles.timeframe, timeframe)));
    const raw = rows[0]?.ts;
    // node-pg returns bigint aggregates as strings — coerce or `+ stepMs` concatenates
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
}
