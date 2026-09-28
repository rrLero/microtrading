import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { modelFill, type Candle, type CostParams } from '@microtrading/core';
import { DbService } from '../db/db.service.js';
import { journal, paperAccount } from '../db/schema.js';
import { BybitDemoMirrorService } from './bybit-demo-mirror.service.js';

/**
 * Paper broker (SPEC Phase 2, §6.2 fill model): simulated account with the SAME
 * pessimistic cost rules as the backtester — taker fee + slippage on every
 * fill, stops that fill at min(stop, candle open) when a candle trades through
 * them. State persists in Postgres; every event lands in the append-only journal.
 *
 * Phase 3 (§6.3): when Bybit demo keys are configured, every fresh fill is also
 * mirrored to Bybit's demo matching engine by BybitDemoMirrorService for the
 * calibration comparison. Mirroring is fire-safe: it can never fail the paper fill.
 */

/** §6.2 costs — the backtester's own type, so the two can never drift apart. */
export type PaperCosts = CostParams;

export interface PaperState {
  readonly cash: number;
  readonly positionQty: number;
  readonly avgEntryPrice: number;
  readonly stopPrice: number | null;
  readonly openedAt: number | null;
  readonly dayKey: string | null;
  readonly dayStartEquity: number | null;
  readonly killSwitch: boolean;
  readonly lastProcessedTs: number | null;
}

@Injectable()
export class PaperBrokerService {
  private readonly log = new Logger(PaperBrokerService.name);

  constructor(
    private readonly dbs: DbService,
    private readonly mirror: BybitDemoMirrorService,
  ) {}

  /** Append a journal row; returns the inserted id (used to link demo fills to paper fills). */
  async journalEvent(kind: string, payload: unknown): Promise<number> {
    const rows = await this.dbs.db
      .insert(journal)
      .values({ kind, payload: payload as object })
      .returning({ id: journal.id });
    return rows[0]!.id;
  }

  async getOrCreate(symbol: string, initialCash: number): Promise<PaperState> {
    const rows = await this.dbs.db.select().from(paperAccount).where(eq(paperAccount.symbol, symbol));
    if (rows.length === 0) {
      await this.dbs.db.insert(paperAccount).values({ symbol, cash: initialCash });
      await this.journalEvent('ops', { event: 'paper-account-created', symbol, initialCash });
      return {
        cash: initialCash,
        positionQty: 0,
        avgEntryPrice: 0,
        stopPrice: null,
        openedAt: null,
        dayKey: null,
        dayStartEquity: null,
        killSwitch: false,
        lastProcessedTs: null,
      };
    }
    const r = rows[0]!;
    return {
      cash: r.cash,
      positionQty: r.positionQty,
      avgEntryPrice: r.avgEntryPrice,
      stopPrice: r.stopPrice ?? null,
      openedAt: r.openedAt ?? null,
      dayKey: r.dayKey ?? null,
      dayStartEquity: r.dayStartEquity ?? null,
      killSwitch: r.killSwitch === 'on',
      lastProcessedTs: r.lastProcessedTs ?? null,
    };
  }

  async setLastProcessedTs(symbol: string, ts: number): Promise<void> {
    await this.dbs.db.update(paperAccount).set({ lastProcessedTs: ts }).where(eq(paperAccount.symbol, symbol));
  }

  equity(state: PaperState, price: number): number {
    return state.cash + state.positionQty * price;
  }

  async rollDay(symbol: string, state: PaperState, price: number, utcDay: string): Promise<PaperState> {
    if (state.dayKey === utcDay) return state;
    const equity = this.equity(state, price);
    await this.dbs.db
      .update(paperAccount)
      .set({ dayKey: utcDay, dayStartEquity: equity })
      .where(eq(paperAccount.symbol, symbol));
    return { ...state, dayKey: utcDay, dayStartEquity: equity };
  }

  /** Simulate the native exchange stop against a closed candle (SPEC §5.2/§6.2). */
  async checkStop(symbol: string, state: PaperState, candle: Candle, costs: PaperCosts): Promise<PaperState> {
    if (state.positionQty <= 0 || state.stopPrice === null) return state;
    if (candle.low > state.stopPrice) return state;
    const raw = Math.min(state.stopPrice, candle.open); // gap → open, never the stop price
    return this.sell(symbol, state, raw, costs, 'stop', candle.timestamp);
  }

  async buy(
    symbol: string,
    state: PaperState,
    refPrice: number,
    quantity: number,
    stopPrice: number,
    costs: PaperCosts,
    reason: string,
    ts?: number,
  ): Promise<PaperState> {
    const { fillPrice, notional: cost, fee } = modelFill('buy', refPrice, quantity, costs);
    if (cost + fee > state.cash) {
      await this.journalEvent('risk', { event: 'buy-rejected-insufficient-cash', symbol, quantity, refPrice });
      return state;
    }
    const next: PaperState = {
      ...state,
      cash: state.cash - cost - fee,
      positionQty: quantity,
      avgEntryPrice: fillPrice,
      stopPrice,
      openedAt: ts ?? Date.now(),
    };
    await this.persist(symbol, next);
    const paperFillId = await this.journalEvent('fill', {
      side: 'buy',
      symbol,
      quantity,
      fillPrice,
      costUsdc: cost, // notional spent on the asset
      fee,
      totalSpentUsdc: cost + fee,
      cashAfter: next.cash,
      stopPrice,
      reason,
      candleTs: ts ?? null,
    });
    this.log.log(`PAPER BUY ${quantity.toFixed(6)} ${symbol} @ ${fillPrice.toFixed(2)} (stop ${stopPrice.toFixed(2)}) — ${reason}`);
    await this.mirror.mirrorFill({
      paperFillId,
      side: 'buy',
      symbol,
      quantity,
      refPrice,
      paperFillPrice: fillPrice,
      paperFee: fee,
      reason,
      candleTs: ts ?? null,
    });
    return next;
  }

  async sell(
    symbol: string,
    state: PaperState,
    refPrice: number,
    costs: PaperCosts,
    reason: string,
    ts?: number,
  ): Promise<PaperState> {
    if (state.positionQty <= 0) return state;
    const quantity = state.positionQty;
    const { fillPrice, notional: proceeds, fee } = modelFill('sell', refPrice, quantity, costs);
    const pnl = proceeds - fee - quantity * state.avgEntryPrice;
    const next: PaperState = {
      ...state,
      cash: state.cash + proceeds - fee,
      positionQty: 0,
      avgEntryPrice: 0,
      stopPrice: null,
      openedAt: null,
    };
    await this.persist(symbol, next);
    const paperFillId = await this.journalEvent('fill', {
      side: 'sell',
      symbol,
      quantity,
      fillPrice,
      proceedsUsdc: proceeds,
      fee,
      receivedUsdc: proceeds - fee,
      cashAfter: next.cash,
      pnlNet: pnl,
      reason,
      candleTs: ts ?? null,
    });
    this.log.log(`PAPER SELL ${symbol} @ ${fillPrice.toFixed(2)} — ${reason} (net PnL ${pnl.toFixed(2)})`);
    await this.mirror.mirrorFill({
      paperFillId,
      side: 'sell',
      symbol,
      quantity,
      refPrice,
      paperFillPrice: fillPrice,
      paperFee: fee,
      reason,
      candleTs: ts ?? null,
    });
    return next;
  }

  /**
   * Sets the flag on EVERY paper account — the traded pair and the D4 shadow
   * accounts — so one command halts everything. Shadow accounts flatten on
   * their own next tick; the CLI flattens `symbol` immediately.
   */
  async setKillSwitch(symbol: string, on: boolean): Promise<void> {
    await this.dbs.db.update(paperAccount).set({ killSwitch: on ? 'on' : 'off' });
    await this.journalEvent('ops', { event: 'kill-switch', symbol, on, scope: 'all-accounts' });
  }

  private async persist(symbol: string, s: PaperState): Promise<void> {
    await this.dbs.db
      .update(paperAccount)
      .set({
        cash: s.cash,
        positionQty: s.positionQty,
        avgEntryPrice: s.avgEntryPrice,
        stopPrice: s.stopPrice,
        openedAt: s.openedAt,
      })
      .where(eq(paperAccount.symbol, symbol));
  }
}
