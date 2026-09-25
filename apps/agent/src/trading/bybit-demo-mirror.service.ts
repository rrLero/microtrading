import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ccxt, { type Exchange, type Trade } from 'ccxt';
import { modelFill, type CostParams } from '@microtrading/core';
import { DbService } from '../db/db.service.js';
import { journal } from '../db/schema.js';

/**
 * §6.3 calibration mirror (SPEC Phase 3).
 *
 * Every FRESH paper fill is re-executed as a real market order on Bybit's demo
 * matching engine (api-demo.bybit.com — real order book, simulated account),
 * and the venue's actual fill is journaled as kind 'demo-fill' with a link to
 * the paper fill's journal id. After ≥2 weeks, `pnpm calibrate-report` compares
 * modeled costs (slippage + fee) against demo reality; >30% relative deviation
 * means the PaperAdapter fill model gets fixed before any paper result is
 * trusted (SPEC §6.3).
 *
 * Rules:
 * - Enabled iff BYBIT_DEMO_API_KEY + BYBIT_DEMO_API_SECRET are set. Without
 *   keys the agent behaves exactly as before.
 * - Mirroring must NEVER break the paper loop: every failure is caught and
 *   journaled as ops/mirror-error, then swallowed.
 * - Replayed fills (candle older than FRESH_MS) are NOT mirrored — a market
 *   order placed hours after the candle would calibrate nothing. The skip is
 *   journaled so the report can account for coverage honestly.
 *
 * `probeRoundTrip` (used by CalibrationProbeService) reuses the same client and
 * the same journal shape to generate calibration pairs on demand, because the
 * strategy only fills 1-2× a month — far too slow to fill the §6.3 sample.
 * Probe pairs are tagged `probe: true` and are reported as a SEPARATE population
 * from strategy fills: §6.3 asks for identical *signals* through both paths, and
 * a probe is not a signal.
 */
@Injectable()
export class BybitDemoMirrorService {
  private static readonly FRESH_MS = 2 * 60 * 60 * 1000; // 2h — one 1h candle + slack
  private static readonly READBACK_MS = 60_000; // venue-lag budget; see executionTrades()

  private readonly log = new Logger(BybitDemoMirrorService.name);
  private exchange: Exchange | null = null;
  private broken = false; // set on init failure so we do not retry every fill

  constructor(
    private readonly config: ConfigService,
    private readonly dbs: DbService,
  ) {}

  get enabled(): boolean {
    return (
      !this.broken &&
      Boolean(this.config.get<string>('BYBIT_DEMO_API_KEY')) &&
      Boolean(this.config.get<string>('BYBIT_DEMO_API_SECRET'))
    );
  }

  private async journalEvent(kind: string, payload: unknown): Promise<void> {
    // Never throw at a caller: mirrorFill is awaited by PaperBrokerService, so a
    // failed insert here would propagate into the paper loop (AGENTS.md: mirror
    // errors must never be able to break it).
    try {
      await this.dbs.db.insert(journal).values({ kind, payload: payload as object });
    } catch (err) {
      this.log.warn(`Failed to journal mirror event ${kind}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async client(): Promise<Exchange> {
    if (this.exchange) return this.exchange;
    const ex = new ccxt.bybit({
      apiKey: this.config.getOrThrow<string>('BYBIT_DEMO_API_KEY'),
      secret: this.config.getOrThrow<string>('BYBIT_DEMO_API_SECRET'),
      enableRateLimit: true,
      options: { defaultType: 'spot' },
    });
    // Routes all requests to api-demo.bybit.com (SPEC §2.1: demo, never live).
    (ex as unknown as { enableDemoTrading: (on: boolean) => void }).enableDemoTrading(true);
    await ex.loadMarkets();
    this.exchange = ex;
    await this.journalEvent('ops', { event: 'bybit-demo-connected', venue: 'bybit-demo', mode: 'spot' });
    this.log.log('Bybit demo mirror connected (api-demo.bybit.com, spot)');
    return ex;
  }

  /**
   * Mirror one paper fill as a demo market order. Never throws.
   * `paperFillId` is the journal id of the paper fill row — the pairing key
   * used by calibrate-report. Returns the venue's fill (for callers that need
   * to act on it, e.g. the probe's sell leg), or null if skipped or errored.
   */
  async mirrorFill(p: {
    paperFillId: number;
    side: 'buy' | 'sell';
    symbol: string;
    quantity: number;
    refPrice: number;
    paperFillPrice: number;
    paperFee: number;
    reason: string;
    candleTs: number | null;
    probe?: boolean;
  }): Promise<{ filledQty: number; avgPrice: number | null } | null> {
    if (!this.enabled) {
      // A disarmed mirror used to look identical to a healthy one in the journal:
      // no demo-fill, no error, no trace. Say so, so coverage gaps are auditable.
      await this.journalEvent('ops', {
        event: 'mirror-skip-disabled',
        paperFillId: p.paperFillId,
        side: p.side,
        reason: this.broken ? 'mirror broken earlier this process — see ops/mirror-error' : 'demo keys not configured',
        probe: p.probe === true,
      });
      return null;
    }
    if (p.candleTs !== null && Date.now() - p.candleTs > BybitDemoMirrorService.FRESH_MS) {
      await this.journalEvent('ops', {
        event: 'mirror-skip-stale',
        paperFillId: p.paperFillId,
        candleTs: p.candleTs,
        note: 'replayed fill — a demo order now would not calibrate the fill model',
      });
      return null;
    }
    const started = Date.now();
    try {
      const ex = await this.client();
      const amount = Number(ex.amountToPrecision(p.symbol, p.quantity));
      // Bybit spot market BUY sizes in quote by default; passing the reference
      // price lets ccxt convert our base amount to quote cost correctly.
      const created =
        p.side === 'buy'
          ? await ex.createOrder(p.symbol, 'market', 'buy', amount, p.refPrice)
          : await ex.createOrder(p.symbol, 'market', 'sell', amount);

      // Read back the ACTUAL execution from the trade list, not the order.
      // ccxt's bybit fetchOrder() throws ArgumentsRequired unless
      // params.acknowledged is set, and a market order's create-response carries
      // no average price — so the previous `catch { break }` here silently kept
      // the unfilled response and journaled every demo fill with null price and
      // null fee. Trades are the authoritative source for both.
      const trades = await this.executionTrades(ex, p.symbol, String(created.id));
      const tradedQty = trades.reduce((a, t) => a + (t.amount ?? 0), 0);
      const notional = trades.reduce((a, t) => a + (t.cost ?? (t.price ?? 0) * (t.amount ?? 0)), 0);
      // Execution list stayed empty → ask the order record (see readbackOrder).
      const fromOrder = trades.length === 0 ? await this.readbackOrder(String(created.id), p.symbol).catch(() => null) : null;
      const filledQty = tradedQty > 0 ? tradedQty : (fromOrder?.filledQty ?? created.filled ?? amount);
      const avgPrice =
        tradedQty > 0 && notional > 0
          ? notional / tradedQty
          : (fromOrder?.avgPrice ?? created.average ?? created.price ?? null);
      const feeUsdc =
        trades.length > 0
          ? this.feeInQuote({ fees: trades.map((t) => t.fee) }, avgPrice ?? p.refPrice, p.symbol)
          : (fromOrder?.feeUsdc ?? null);

      await this.journalEvent('demo-fill', {
        paperFillId: p.paperFillId,
        probe: p.probe === true,
        venue: 'bybit-demo',
        symbol: p.symbol,
        side: p.side,
        requestedQty: amount,
        readbackTrades: trades.length, // 0 and readbackSource null ⇒ price/fee unusable; excluded from the report
        readbackSource: trades.length > 0 ? 'trades' : fromOrder ? 'order' : null,
        demoOrderId: created.id,
        demoAvgPrice: avgPrice,
        demoFilledQty: filledQty,
        demoFeeUsdc: feeUsdc,
        refPrice: p.refPrice,
        paper: {
          fillPrice: p.paperFillPrice,
          fee: p.paperFee,
          reason: p.reason,
          candleTs: p.candleTs,
        },
        latencyMs: Date.now() - started,
      });
      this.log.log(
        `DEMO ${p.side.toUpperCase()} ${filledQty} ${p.symbol} @ ${avgPrice ?? '?'} (paper ${p.paperFillPrice.toFixed(2)})`,
      );
      return { filledQty, avgPrice };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.journalEvent('ops', { event: 'mirror-error', paperFillId: p.paperFillId, side: p.side, message, probe: p.probe === true });
      this.log.warn(`Bybit demo mirror failed for paper fill #${p.paperFillId}: ${message}`);
      if (!this.exchange) this.broken = true; // could not even connect — stop retrying every fill
      return null;
    }
  }

  /**
   * §6.3 calibration probe: one tiny buy→sell round trip on the demo venue,
   * each leg paired with what the PaperAdapter model WOULD have charged for the
   * same size at the same instant.
   *
   * The reference price is re-read from the venue immediately before each leg —
   * using a stale candle close would fold an hour of price drift into what is
   * supposed to be a pure slippage measurement.
   *
   * `probeId` is the journal id of the ops/calibration-probe row, so probe pairs
   * link back exactly the way strategy pairs link to their paper fill.
   * Never throws: the caller is a cron, and §6.3 data is never worth an incident.
   */
  async probeRoundTrip(p: {
    symbol: string;
    notionalUsdc: number;
    costs: CostParams;
    probeId: number;
  }): Promise<void> {
    if (!this.enabled) {
      await this.journalEvent('ops', { event: 'probe-skip-disabled', probeId: p.probeId });
      return;
    }
    try {
      const ex = await this.client();
      const refBuy = await this.lastPrice(ex, p.symbol);
      const qty = p.notionalUsdc / refBuy;

      // §6.3 compares the paper model against the venue, so the paper side must
      // come from the model itself — not a lookalike formula written here.
      const buy = modelFill('buy', refBuy, qty, p.costs);
      const bought = await this.mirrorFill({
        paperFillId: p.probeId,
        side: 'buy',
        symbol: p.symbol,
        quantity: qty,
        refPrice: refBuy,
        paperFillPrice: buy.fillPrice,
        paperFee: buy.fee,
        reason: 'calibration probe',
        candleTs: null,
        probe: true,
      });
      if (!bought) return; // buy failed and was journaled — never sell what we may not hold

      // Bybit spot charges the BUY fee in the base asset, so we hold slightly
      // less BTC than we ordered; selling the full amount would be rejected.
      // ponytail: fixed 0.2% haircut, dust accrues in the demo wallet — read the
      // actual base balance instead if that dust ever becomes worth reclaiming.
      const sellQty = bought.filledQty * 0.998;
      const refSell = await this.lastPrice(ex, p.symbol);
      const sell = modelFill('sell', refSell, sellQty, p.costs);
      await this.mirrorFill({
        paperFillId: p.probeId,
        side: 'sell',
        symbol: p.symbol,
        quantity: sellQty,
        refPrice: refSell,
        paperFillPrice: sell.fillPrice,
        paperFee: sell.fee,
        reason: 'calibration probe',
        candleTs: null,
        probe: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.journalEvent('ops', { event: 'mirror-error', paperFillId: p.probeId, side: 'probe', message, probe: true });
      this.log.warn(`Calibration probe #${p.probeId} failed: ${message}`);
      if (!this.exchange) this.broken = true;
    }
  }

  /**
   * The venue's own record of what an order actually executed at.
   *
   * Bybit demo publishes a filled spot order to the execution list 4-9s after
   * the order response (measured 2026-08-11), so this polls for up to
   * READBACK_MS and returns as soon as the trade shows up — usually well under
   * that. Anything shorter silently yields null price/fee. Retune if the venue
   * gets slower; an empty result is returned rather than thrown so the fill is
   * still journaled (flagged readbackTrades: 0) instead of vanishing.
   *
   * Budget raised 25s → 60s on 2026-08-20: the venue lag is not bounded by the
   * 08-11 measurement. The 08-18 16:02Z donchian entry — the ONLY strategy fill
   * in 13 days, and the entire §6.3 axis-3/4 population — exhausted the 25s
   * budget and was excluded from calibrate-report with readbackTrades: 0, while
   * probe fills the same day read back fine. Strategy fills are far too rare to
   * lose one to a tuning constant; the extra wait costs nothing on a path that
   * fires roughly once a fortnight.
   *
   * This blocks the paper loop for those seconds. That is deliberate and
   * bounded: at most a couple of fresh fills per hourly tick, and the tick has
   * nothing time-critical left to do afterwards.
   */
  private async executionTrades(ex: Exchange, symbol: string, orderId: string): Promise<Trade[]> {
    let lastErr: unknown = null;
    const attempts = Math.ceil(BybitDemoMirrorService.READBACK_MS / 500);
    for (let i = 0; i < attempts; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const trades = await ex.fetchMyTrades(symbol, undefined, 20, { orderId });
        const mine = trades.filter((t) => String(t.order) === orderId);
        if (mine.length > 0) return mine;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) {
      this.log.warn(
        `Could not read back demo trades for order ${orderId}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
      );
    }
    return [];
  }

  /**
   * The order record's own average price, filled qty and fee — the fallback
   * when the execution list stays empty. It did for the whole budget on the
   * 08-18, 09-18 and 09-23 strategy fills (all 16:02Z) although each executed
   * within ~1s; queried afterwards, the order carried avgPrice and cumExecFee.
   * Also used by the backfill-demo-readback CLI. Null if the order is not filled.
   */
  async readbackOrder(orderId: string, symbol: string): Promise<{ avgPrice: number; filledQty: number; feeUsdc: number | null } | null> {
    const ex = await this.client();
    const o = await ex.fetchOrder(orderId, symbol, { acknowledged: true });
    if (!o.average || !o.filled) return null;
    // Only o.fee: ccxt repeats it in an (untyped) o.fees and feeInQuote would sum both.
    return { avgPrice: o.average, filledQty: o.filled, feeUsdc: this.feeInQuote({ fee: o.fee }, o.average, symbol) };
  }

  private async lastPrice(ex: Exchange, symbol: string): Promise<number> {
    const t = await ex.fetchTicker(symbol);
    const price = t.last ?? t.close;
    if (!price || !Number.isFinite(price)) throw new Error(`no usable ticker price for ${symbol}`);
    return price;
  }

  /** Normalize the venue fee to quote currency (USDC). Spot buys often charge fees in the base asset. */
  private feeInQuote(order: { fee?: { cost?: number | undefined; currency?: string | undefined } | undefined; fees?: ({ cost?: number | undefined; currency?: string | undefined } | undefined)[] | undefined }, price: number, symbol: string): number | null {
    const [base, quote] = symbol.split('/');
    const parts = [...(order.fees ?? []), ...(order.fee ? [order.fee] : [])];
    if (parts.length === 0) return null;
    let total = 0;
    for (const f of parts) {
      if (!f?.cost) continue;
      if (f.currency === base) total += f.cost * price;
      else if (f.currency === quote || f.currency === undefined) total += f.cost;
    }
    return total;
  }
}
