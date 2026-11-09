/** A paper fill as journaled by PaperBrokerService (only the fields P&L needs). */
export interface FillRow {
  symbol: string;
  at: number; // epoch ms
  side: 'buy' | 'sell';
  costUsdc?: number; // buy: notional spent, fee excluded
  fee?: number;
  quantity?: number;
  fillPrice?: number; // with quantity: notional for buy rows journaled before costUsdc existed
  receivedUsdc?: number; // sell: proceeds net of the exit fee
  pnlNet?: number; // sell: omits the entry fee — never use it for P&L
}

export interface RoundTrip {
  symbol: string;
  openedAt: number;
  closedAt: number;
  /** Cash out minus cash in, both fees included. */
  net: number;
  /** net over the cash put in (notional + entry fee). */
  returnPct: number;
  /** Asset notional at entry and at exit, fees excluded — what slippage is charged on. */
  entryNotional: number;
  exitNotional: number;
}

/** Pairs each sell with its symbol's open buy, in chronological order. Open positions are skipped. */
export function roundTrips(fills: FillRow[]): RoundTrip[] {
  const open = new Map<string, FillRow>();
  const out: RoundTrip[] = [];
  for (const f of [...fills].sort((a, b) => a.at - b.at)) {
    if (f.side === 'buy') {
      open.set(f.symbol, f);
      continue;
    }
    const b = open.get(f.symbol);
    if (!b) continue; // a sell with no recorded buy cannot be costed
    open.delete(f.symbol);
    const entryNotional = b.costUsdc ?? (b.quantity ?? 0) * (b.fillPrice ?? 0);
    const paidIn = entryNotional + (b.fee ?? 0);
    const net = (f.receivedUsdc ?? 0) - paidIn;
    out.push({
      symbol: f.symbol, openedAt: b.at, closedAt: f.at, net,
      returnPct: paidIn > 0 ? (net / paidIn) * 100 : 0,
      entryNotional, exitNotional: (f.receivedUsdc ?? 0) + (f.fee ?? 0),
    });
  }
  return out;
}

/** Re-prices a trip as if each leg had paid `halfSpread` instead of the modeled `modeledSlippage`. */
export function recost(t: RoundTrip, halfSpread: number, modeledSlippage: number): RoundTrip {
  const net = t.net - (halfSpread - modeledSlippage) * (t.entryNotional + t.exitNotional);
  return { ...t, net, returnPct: (t.returnPct * net) / (t.net || 1) };
}

export interface VerdictStats {
  count: number;
  net: number;
  /** net over the pooled starting capital of every account in the population. */
  netReturnPct: number;
  profitFactor: number;
  winRate: number;
  maxDrawdownPct: number;
  bestMonth: string | null;
  /** Best month's net over total net (SHADOW-PREREG §2 concentration test); NaN when total <= 0. */
  bestMonthShare: number;
  perPair: { symbol: string; count: number; net: number; profitFactor: number }[];
  /** §7.4: PF < 1.1 over >= 100 trades. */
  killProfitFactor: boolean;
  /** §7.4 / C3 (i): month ending the first 3-month run of net-negative months, or null. */
  killThreeMonths: string | null;
}

const month = (ts: number) => new Date(ts).toISOString().slice(0, 7);
const pf = (nets: number[]) => {
  const win = nets.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const loss = -nets.filter((x) => x < 0).reduce((a, b) => a + b, 0);
  return loss === 0 ? (win > 0 ? Infinity : 0) : win / loss;
};

/** The SHADOW-PREREG §2 statistics over closed round trips (pooled, chronological). */
export function verdictStats(trips: RoundTrip[], pooledCapital: number): VerdictStats {
  const sorted = [...trips].sort((a, b) => a.closedAt - b.closedAt);
  const nets = sorted.map((t) => t.net);
  const net = nets.reduce((a, b) => a + b, 0);

  let equity = pooledCapital, peak = pooledCapital, maxDd = 0;
  for (const x of nets) {
    equity += x;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, (peak - equity) / peak);
  }

  const byMonth = new Map<string, number>();
  for (const t of sorted) byMonth.set(month(t.closedAt), (byMonth.get(month(t.closedAt)) ?? 0) + t.net);
  let bestMonth: string | null = null;
  for (const [m, v] of byMonth) if (bestMonth === null || v > byMonth.get(bestMonth)!) bestMonth = m;

  // C3 (i): calendar months; a month with no closed trip breaks the run.
  let killThreeMonths: string | null = null;
  const months = [...byMonth.keys()].sort();
  for (let i = 2; i < months.length && killThreeMonths === null; i++) {
    const run = months.slice(i - 2, i + 1);
    const contiguous = run.every((m, j) => j === 0 || nextMonth(run[j - 1]!) === m);
    if (contiguous && run.every((m) => byMonth.get(m)! < 0)) killThreeMonths = months[i]!;
  }

  const symbols = [...new Set(sorted.map((t) => t.symbol))].sort();
  return {
    count: sorted.length,
    net,
    netReturnPct: (net / pooledCapital) * 100,
    profitFactor: pf(nets),
    winRate: sorted.length ? nets.filter((x) => x > 0).length / sorted.length : 0,
    maxDrawdownPct: maxDd * 100,
    bestMonth,
    bestMonthShare: net > 0 && bestMonth !== null ? byMonth.get(bestMonth)! / net : NaN,
    perPair: symbols.map((symbol) => {
      const n = sorted.filter((t) => t.symbol === symbol).map((t) => t.net);
      return { symbol, count: n.length, net: n.reduce((a, b) => a + b, 0), profitFactor: pf(n) };
    }),
    killProfitFactor: sorted.length >= 100 && pf(nets) < 1.1,
    killThreeMonths,
  };
}

function nextMonth(m: string): string {
  const [y = 0, mo = 0] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
}
