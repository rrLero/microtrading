import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ccxt, { type Exchange } from 'ccxt';
import { TIMEFRAME_MS, aggregate1hTo4h, isClosed, validateSeries, type Candle, type Timeframe } from '@microtrading/core';
import { CandleRepository } from './candle-repository.js';

/**
 * REST backfill + (later) WebSocket live ingestion.
 *
 * Venue notes (SPEC §2.4):
 * - Kraken's REST OHLC endpoint only returns the most recent ~720 candles per
 *   timeframe. Deep history comes from Kraken's downloadable OHLCVT CSV archives
 *   (see import-csv CLI) or from an exchange with paginated history (e.g. Bybit).
 * - Everything ingested here is upserted idempotently; re-runs are safe.
 */
@Injectable()
export class IngestionService {
  private readonly log = new Logger(IngestionService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly repo: CandleRepository,
  ) {}

  /** Public so the §6.3 spread sampler can quote the SAME venue we model costs for. */
  /**
   * `exchangeId` overrides the data venue — the spread sampler needs the book of
   * the venue we EXECUTE on, which is not the one we ingest candles from.
   * Public endpoints only; no keys are ever passed here, so this instance is
   * structurally incapable of placing an order.
   */
  createExchange(exchangeId?: string): Exchange {
    const id = exchangeId ?? this.config.get<string>('DATA_EXCHANGE', 'kraken');
    const ctor = (ccxt as unknown as Record<string, new (cfg: object) => Exchange>)[id];
    if (!ctor) throw new Error(`Unknown ccxt exchange id: ${id}`);
    return new ctor({ enableRateLimit: true });
  }

  /**
   * Paginated REST backfill of 1h candles from `since` to now.
   * Derived 4h candles are aggregated locally from 1h (single source of truth,
   * and guarantees the 4h series obeys the closed-candle rule).
   */
  async backfill(symbol: string, sinceIso: string): Promise<void> {
    const exchange = this.createExchange();
    await exchange.loadMarkets();
    if (!exchange.markets?.[symbol]) {
      throw new Error(`Symbol ${symbol} not listed on ${exchange.id}. Available USDC pairs: ${Object.keys(exchange.markets ?? {}).filter((s) => s.endsWith('/USDC')).slice(0, 20).join(', ')}`);
    }

    const tf: Timeframe = '1h';
    const stepMs = TIMEFRAME_MS[tf];
    const now = Date.now();
    const resumeFrom = await this.repo.latestTimestamp(symbol, tf);
    let since = resumeFrom !== null ? resumeFrom + stepMs : Date.parse(sinceIso);
    this.log.log(`Backfilling ${symbol} ${tf} on ${exchange.id} from ${new Date(since).toISOString()}`);

    let total = 0;
    while (since < now) {
      const batch = (await exchange.fetchOHLCV(symbol, tf, since, 1000)) as number[][];
      if (batch.length === 0) break;

      const rows = batch
        .filter((k) => isClosed(k[0]!, tf, now)) // never store a forming candle (SPEC §3.1)
        .map((k) => ({
          symbol,
          timeframe: tf,
          source: `${exchange.id}-rest`,
          timestamp: k[0]!,
          open: k[1]!,
          high: k[2]!,
          low: k[3]!,
          close: k[4]!,
          volume: k[5]!,
        }));
      await this.repo.upsertMany(rows);
      total += rows.length;

      const lastTs = batch[batch.length - 1]![0]!;
      if (lastTs + stepMs <= since) break; // no forward progress → venue returned the same page
      since = lastTs + stepMs;
      this.log.log(`  …${total} candles, at ${new Date(since).toISOString()}`);
    }

    await this.rebuild4h(symbol, Date.parse(sinceIso));
    await this.report(symbol, Date.parse(sinceIso));
    this.log.log(`Backfill done: ${total} new 1h candles ingested.`);
  }

  /** Rebuild the derived 4h series from stored 1h candles. */
  async rebuild4h(symbol: string, sinceTs: number): Promise<void> {
    const oneH = await this.repo.fetchSince(symbol, '1h', sinceTs);
    const fourH = aggregate1hTo4h(oneH);
    await this.repo.upsertMany(
      fourH.map((c: Candle) => ({ ...c, symbol, timeframe: '4h' as Timeframe, source: 'derived-1h' })),
    );
    this.log.log(`Derived ${fourH.length} 4h candles from ${oneH.length} 1h candles.`);
  }

  /** Detect ranges of missing 1h candles longer than maxFillHours. */
  private findHoles(
    oneH: readonly { timestamp: number }[],
    maxFillHours: number,
  ): { from: number; to: number; hours: number }[] {
    const step = TIMEFRAME_MS['1h'];
    const holes: { from: number; to: number; hours: number }[] = [];
    for (let i = 1; i < oneH.length; i++) {
      const prev = oneH[i - 1]!;
      const cur = oneH[i]!;
      const missing = Math.round((cur.timestamp - prev.timestamp) / step) - 1;
      if (missing > maxFillHours) {
        holes.push({ from: prev.timestamp + step, to: cur.timestamp - step, hours: missing });
      }
    }
    return holes;
  }

  /**
   * Fill data holes by aggregating Kraken's public *trades* history into 1h
   * candles. The Trades endpoint has full paginated history (unlike OHLC's
   * ~720-candle cap), so this recovers any range — slowly (~1 req/s).
   * Candles built this way carry source='kraken-trades'.
   */
  async backfillTradesForHoles(symbol: string, maxFillHours = 48): Promise<void> {
    const tf: Timeframe = '1h';
    const step = TIMEFRAME_MS[tf];
    const oneH = await this.repo.fetchSince(symbol, tf, 0);
    const holes = this.findHoles(oneH, maxFillHours);
    if (holes.length === 0) {
      this.log.log('No data holes to fill from trades.');
      return;
    }

    const exchange = this.createExchange();
    await exchange.loadMarkets();

    for (const hole of holes) {
      this.log.log(
        `Rebuilding ${new Date(hole.from).toISOString()} → ${new Date(hole.to).toISOString()} (${hole.hours}h) from trade history…`,
      );
      const buckets = new Map<number, { o: number; h: number; l: number; c: number; v: number; lastTs: number }>();
      const endMs = hole.to + step; // hole.to is the OPEN of the last missing candle
      let since = hole.from;
      let pages = 0;
      let done = false;

      while (!done && since < endMs) {
        const trades = await exchange.fetchTrades(symbol, since, 1000);
        if (trades.length === 0) break;
        for (const t of trades) {
          const ts = t.timestamp;
          const price = t.price;
          const amount = t.amount ?? 0;
          if (ts === undefined || price === undefined) continue;
          if (ts >= endMs) {
            done = true;
            break;
          }
          const bucket = Math.floor(ts / step) * step;
          const b = buckets.get(bucket);
          if (!b) {
            buckets.set(bucket, { o: price, h: price, l: price, c: price, v: amount, lastTs: ts });
          } else {
            b.h = Math.max(b.h, price);
            b.l = Math.min(b.l, price);
            if (ts >= b.lastTs) {
              b.c = price;
              b.lastTs = ts;
            }
            b.v += amount;
          }
        }
        const lastTs = trades[trades.length - 1]!.timestamp;
        if (lastTs === undefined || lastTs + 1 <= since) break; // no forward progress
        since = lastTs + 1;
        pages++;
        if (pages % 25 === 0) {
          this.log.log(`  …page ${pages}, at ${new Date(since).toISOString()}, ${buckets.size} candles built`);
        }
      }

      const rows = [...buckets.entries()]
        .filter(([ts]) => ts >= hole.from && ts <= hole.to)
        .sort((a, b) => a[0] - b[0])
        .map(([ts, b]) => ({
          symbol,
          timeframe: tf,
          source: 'kraken-trades',
          timestamp: ts,
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v,
        }));
      await this.repo.upsertMany(rows);
      this.log.log(`  Recovered ${rows.length}/${hole.hours} candles for this range (${pages} pages).`);
    }
    this.log.log('Trades backfill done — now run heal-gaps to fill residual zero-trade hours and re-validate.');
  }

  /**
   * Fill gaps in the 1h series with flat candles (O=H=L=C=prev close, volume 0).
   * Kraken's OHLCVT files omit intervals with zero trades — a missing candle
   * documents "price did not move", so flat-filling is reconstruction, not
   * fabrication. Filled candles carry source='gap-fill-flat' so they remain
   * distinguishable. Caveat (documented for backtesting): flat candles shrink
   * ATR in sparse periods — strategies must not trade periods dominated by fills.
   */
  async healGaps(symbol: string, maxFillHours = 48): Promise<void> {
    const tf: Timeframe = '1h';
    const step = TIMEFRAME_MS[tf];

    // Purge any previous fills first — healing must be re-runnable after new imports.
    await this.repo.deleteBySource(symbol, tf, 'gap-fill-flat');
    const oneH = await this.repo.fetchSince(symbol, tf, 0);
    if (oneH.length < 2) {
      this.log.warn('Not enough candles to heal.');
      return;
    }

    const fills: import('./candle-repository.js').CandleRow[] = [];
    const missingByYear = new Map<number, number>();
    const holes: { from: number; to: number; hours: number }[] = [];
    for (let i = 1; i < oneH.length; i++) {
      const prev = oneH[i - 1]!;
      const cur = oneH[i]!;
      const missing = Math.round((cur.timestamp - prev.timestamp) / step) - 1;
      if (missing <= 0) continue;

      if (missing > maxFillHours) {
        // A gap this long is MISSING DATA, not zero-trade sparsity. Never fabricate it.
        holes.push({ from: prev.timestamp + step, to: cur.timestamp - step, hours: missing });
        continue;
      }
      const year = new Date(prev.timestamp).getUTCFullYear();
      missingByYear.set(year, (missingByYear.get(year) ?? 0) + missing);
      for (let k = 1; k <= missing; k++) {
        fills.push({
          symbol,
          timeframe: tf,
          source: 'gap-fill-flat',
          timestamp: prev.timestamp + k * step,
          open: prev.close,
          high: prev.close,
          low: prev.close,
          close: prev.close,
          volume: 0,
        });
      }
    }

    this.log.log(`Filling ${fills.length} zero-trade hours (threshold: gaps ≤ ${maxFillHours}h).`);
    for (const [year, n] of [...missingByYear.entries()].sort((a, b) => a[0] - b[0])) {
      this.log.log(`  ${year}: ${n} filled hours`);
    }
    await this.repo.upsertMany(fills);

    // 4h is fully derived — rebuild from scratch so stale buckets from old fills die.
    await this.repo.deleteTimeframe(symbol, '4h');
    await this.rebuild4h(symbol, oneH[0]!.timestamp);

    if (holes.length > 0) {
      this.log.error(`${holes.length} DATA HOLE(S) exceed ${maxFillHours}h — real data must be imported for these ranges:`);
      for (const h of holes) {
        this.log.error(`  ${new Date(h.from).toISOString()} → ${new Date(h.to).toISOString()} (${h.hours}h ≈ ${(h.hours / 24).toFixed(1)} days)`);
      }
      this.log.error('Fix: import Kraken quarterly OHLCVT CSVs covering these ranges, then re-run heal-gaps.');
    } else {
      await this.report(symbol, oneH[0]!.timestamp);
    }
  }

  /** Data-quality report: gaps and inconsistencies are printed, not hidden. */
  private async report(symbol: string, sinceTs: number): Promise<void> {
    const oneH = await this.repo.fetchSince(symbol, '1h', sinceTs);
    const problems = validateSeries(oneH, '1h');
    if (problems.length === 0) {
      this.log.log(`Series clean: ${oneH.length} 1h candles, no gaps.`);
    } else {
      this.log.warn(`Series has ${problems.length} issue(s); first 10:`);
      for (const p of problems.slice(0, 10)) this.log.warn(`  ${p}`);
      this.log.warn('Gaps in old ranges usually mean the venue lacks deep history — use the Kraken CSV import.');
    }
  }
}
