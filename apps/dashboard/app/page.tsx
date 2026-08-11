'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EquityChart } from '@/components/equity-chart';

const num = (v: number, digits = 2) =>
  v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export default function DashboardPage() {
  const status = useQuery({ queryKey: ['status'], queryFn: api.status });
  const equity = useQuery({ queryKey: ['equity'], queryFn: () => api.equity(720) });
  const journal = useQuery({ queryKey: ['journal'], queryFn: () => api.journal(25) });
  const [expandedId, setExpandedId] = React.useState<number | null>(null);

  const s = status.data;
  const initial = equity.data?.[0]?.equity ?? 10_000;
  const pnl = s ? s.equity - initial : 0;
  const pnlPct = initial > 0 ? (pnl / initial) * 100 : 0;

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">MicroTrading</h1>
          <p className="text-sm text-muted-foreground">
            {s ? `${s.symbol} · ${s.strategy.family} ${JSON.stringify(s.strategy.params)}` : 'Loading…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {s &&
            (s.killSwitch ? (
              <Badge variant="critical">⛔ kill switch ON</Badge>
            ) : s.loopEnabled ? (
              <Badge variant="good">✓ loop armed</Badge>
            ) : (
              <Badge>◌ loop disabled</Badge>
            ))}
        </div>
      </header>

      {status.isError && (
        <Card>
          <CardContent className="py-4 text-sm text-status-critical">
            ✕ Cannot reach the agent API — is the agent running? ({String(status.error)})
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Equity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{s ? num(s.equity) : '—'}</div>
            <div className="text-xs text-muted-foreground">USDC</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>P&L (window)</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-semibold"
              style={{ color: pnl >= 0 ? 'var(--delta-up)' : 'var(--delta-down)' }}
            >
              {pnl >= 0 ? '▲' : '▼'} {num(Math.abs(pnl))}
            </div>
            <div className="text-xs text-muted-foreground">{pnlPct >= 0 ? '+' : '−'}{num(Math.abs(pnlPct))}% vs window start</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Position</CardTitle>
          </CardHeader>
          <CardContent>
            {s?.position ? (
              <>
                <div className="text-2xl font-semibold">{s.position.qty.toFixed(5)}</div>
                <div className="text-xs text-muted-foreground">
                  BTC @ {num(s.position.avgEntry)} · stop {s.position.stop ? num(s.position.stop) : '—'}
                </div>
              </>
            ) : (
              <>
                <div className="text-2xl font-semibold">flat</div>
                <div className="text-xs text-muted-foreground">no open position</div>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>BTC mark</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{s ? num(s.markPrice) : '—'}</div>
            <div className="text-xs text-muted-foreground">
              last candle {s?.lastCandleTs ? new Date(s.lastCandleTs).toLocaleTimeString() : '—'}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Equity — last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          <EquityChart points={(equity.data ?? []).map((p) => ({ ts: p.ts, equity: p.equity }))} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Journal — latest {journal.data?.length ?? 0} entries</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">time</th>
                  <th className="py-2 pr-4 font-medium">kind</th>
                  <th className="py-2 font-medium">payload</th>
                </tr>
              </thead>
              <tbody>
                {(journal.data ?? []).map((r) => (
                  <React.Fragment key={r.id}>
                    <tr
                      className="cursor-pointer border-b border-border/50 align-top hover:bg-border/20"
                      onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                      title="Click to expand payload"
                    >
                      <td
                        className="whitespace-nowrap py-2 pr-4 text-muted-foreground"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        <span className="mr-1 inline-block w-3 text-muted-foreground">
                          {expandedId === r.id ? '▾' : '▸'}
                        </span>
                        {new Date(r.at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={r.kind === 'fill' ? 'good' : r.kind === 'risk' ? 'critical' : 'neutral'}>
                          {r.kind === 'fill' ? '● ' : r.kind === 'risk' ? '⚠ ' : ''}
                          {r.kind}
                        </Badge>
                      </td>
                      <td className="max-w-0 truncate py-2 font-mono text-xs text-secondary-foreground">
                        {JSON.stringify(r.payload)}
                      </td>
                    </tr>
                    {expandedId === r.id && (
                      <tr className="border-b border-border/50">
                        <td colSpan={3} className="py-2">
                          <pre className="overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-secondary-foreground">
                            {JSON.stringify(r.payload, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <footer className="pb-4 text-center text-xs text-muted-foreground">
        Read-only dashboard — the kill switch is CLI-only by design. Refreshes every minute.
      </footer>
    </main>
  );
}
