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
