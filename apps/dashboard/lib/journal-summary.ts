import type { JournalRow } from './api';

const n = (v: unknown, d = 2): string =>
  typeof v === 'number' ? v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const p4 = (v: unknown): string => (typeof v === 'number' ? `${(v * 100).toFixed(4)}%` : '—');

/**
 * One plain sentence per journal row.
 *
 * The raw payload is still one click away, but truncated JSON in a table cell
 * (`{"side":"sell","pa…`) tells an operator nothing at a glance — it is the
 * database's view of the event, not the reader's. Anything unrecognised falls
 * back to compact key/value so a new event type degrades instead of vanishing.
 */
export function summarise(row: JournalRow): string {
  const p = row.payload as Record<string, any>;

  switch (row.kind) {
    case 'decision': {
      const sig = p['signal']?.kind ?? 'unknown';
      const verb = sig === 'hold' ? 'No action' : sig === 'enter-long' ? 'ENTER LONG' : 'EXIT';
      const why = p['signal']?.reason ? ` — ${p['signal'].reason}` : '';
      return `${verb} · 4h close ${n(p['close'])}${why}${p['replayed'] ? ' (replayed)' : ''}`;
    }
    case 'equity':
      return `Marked at ${n(p['price'])} → equity ${n(p['equity'])} USDC${p['positionQty'] ? ` · holding ${p['positionQty']}` : ' · flat'}`;
    case 'fill':
      return `PAPER ${String(p['side']).toUpperCase()} ${n(p['quantity'], 6)} @ ${n(p['fillPrice'])} · fee ${n(p['fee'], 4)}${p['reason'] ? ` · ${p['reason']}` : ''}`;
    case 'demo-fill':
      return `Demo ${p['side']} ${n(p['demoFilledQty'], 6)} @ ${n(p['demoAvgPrice'])} vs modelled ${n(p['paper']?.fillPrice)}${p['probe'] ? ' (probe)' : ''}`;
    case 'risk':
      return `Blocked: ${p['event'] ?? 'risk rule'}${p['symbol'] ? ` on ${p['symbol']}` : ''}`;
    case 'ops':
      switch (p['event']) {
        case 'spread-sample':
          return `Spread on ${p['venue']}: half-spread ${p4(p['halfSpreadRate'])} vs modelled ${p4(p['modeledSlippageRate'])}`;
        case 'calibration-probe':
          return `Calibration probe — ${n(p['notionalUsdc'], 0)} USDC round trip on demo`;
        case 'kill-switch':
          return `KILL SWITCH ${p['on'] ? 'ON — flattening and halting' : 'OFF — trading resumed'}`;
        case 'catch-up':
          return `Catch-up replay: ${p['candles'] ?? '?'} missed candle(s) processed`;
        case 'mirror-error':
          return `Mirror error: ${p['message'] ?? 'unknown'}`;
        case 'mirror-skip-stale':
          return 'Mirror skipped — fill too old to compare';
        case 'mirror-skip-disabled':
          return 'Mirror skipped — demo not armed';
        case 'bybit-demo-connected':
          return 'Connected to Bybit demo';
        case 'probe-skip-kill-switch':
          return 'Probe skipped — kill switch on';
        case 'stale-data-halt':
          return 'HALTED — market data went stale';
        default:
          return String(p['event'] ?? compact(p));
      }
    default:
      return compact(p);
  }
}

function compact(p: Record<string, unknown>): string {
  return Object.entries(p)
    .slice(0, 4)
    .map(([k, v]) => `${k} ${typeof v === 'object' ? '…' : String(v)}`)
    .join(' · ');
}

/**
 * Fold each hourly spread sweep into one row.
 *
 * The sampler writes one row per pair, so a 10-pair universe emits 240 rows a
 * day and would bury the single hourly decision that actually matters. The
 * sweep is still one event to a reader; only the storage is per-pair.
 */
export interface FeedItem {
  key: string;
  at: string;
  text: string;
  sev: 'alert' | 'event' | 'routine';
  rows: JournalRow[];
}

export function toFeed(rows: JournalRow[]): FeedItem[] {
  const out: FeedItem[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const isSweep = r.kind === 'ops' && (r.payload as Record<string, unknown>)['event'] === 'spread-sample';
    if (!isSweep) {
      out.push({ key: String(r.id), at: r.at, text: summarise(r), sev: severity(r), rows: [r] });
      continue;
    }
    // Absorb the rest of this sweep — same event, written within a minute.
    const group: JournalRow[] = [r];
    while (i + 1 < rows.length) {
      const n = rows[i + 1]!;
      const alsoSweep = n.kind === 'ops' && (n.payload as Record<string, unknown>)['event'] === 'spread-sample';
      if (!alsoSweep || Date.parse(r.at) - Date.parse(n.at) > 60_000) break;
      group.push(n);
      i++;
    }
    const worst = group.reduce((a, b) =>
      ((b.payload as any).halfSpreadRate ?? 0) > ((a.payload as any).halfSpreadRate ?? 0) ? b : a,
    );
    const w = worst.payload as any;
    const breaches = group.filter((g) => (g.payload as any).exceedsModel);
    out.push({
      key: `sweep-${r.id}`,
      at: r.at,
      text:
        `Spread swept ${group.length} pair${group.length === 1 ? '' : 's'} on ${w.venue} — widest ` +
        `${w.symbol} ${(w.halfSpreadRate * 100).toFixed(4)}% vs ${(w.modeledSlippageRate * 100).toFixed(4)}% modelled` +
        (breaches.length ? ` · ${breaches.length} OVER the model` : ''),
      sev: breaches.length ? 'alert' : 'routine',
      rows: group,
    });
  }
  return out;
}

/** Rows an operator should notice without reading: anything that halted or broke something. */
export function severity(row: JournalRow): 'alert' | 'event' | 'routine' {
  const e = (row.payload as Record<string, unknown>)['event'];
  if (row.kind === 'risk' || e === 'mirror-error' || e === 'stale-data-halt' || e === 'kill-switch') return 'alert';
  // A probe is a scheduled self-test, not something the strategy decided to do.
  // Bolding two of them a day trains the eye to ignore the emphasis entirely.
  if (row.kind === 'demo-fill') return (row.payload as Record<string, unknown>)['probe'] ? 'routine' : 'event';
  if (row.kind === 'fill') return 'event';
  if (row.kind === 'decision' && (row.payload as any)?.['signal']?.kind !== 'hold') return 'event';
  return 'routine';
}
