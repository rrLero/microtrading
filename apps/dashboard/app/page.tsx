'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type AgentStatus } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EquityChart } from '@/components/equity-chart';
import { ChannelRail } from '@/components/channel-rail';
import { toFeed } from '@/lib/journal-summary';

const num = (v: number, digits = 2) =>
  v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "4m ago" / "2h ago" — an absolute timestamp makes the reader do the subtraction. */
function ago(iso: string | null, now: number): string {
  if (!iso) return 'never';
  const mins = Math.floor((now - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 48 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

/** A scheduled job that stopped firing looks identical to one that never ran — unless we say when. */
function Heartbeat({ label, at, now, dueMins }: { label: string; at: string | null; now: number; dueMins: number }) {
  const late = !at || now - Date.parse(at) > dueMins * 60000 * 1.5;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-secondary-foreground">{label}</span>
      <span className="readout text-sm" style={{ color: late ? 'var(--status-critical)' : 'var(--muted-foreground)' }}>
        {late ? '⚠ ' : ''}
        {ago(at, now)}
      </span>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div>
      <div className="legend">{label}</div>
      <div className="readout mt-1 text-xl font-semibold leading-tight" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const status = useQuery({ queryKey: ['status'], queryFn: api.status });
  const equity = useQuery({ queryKey: ['equity'], queryFn: () => api.equity(720) });
  // ponytail: ~12 raw journal rows/hour (10 spread-sample + decision + mark), so
  // 300 covers ~24h. Bump further (cap 500, see status.controller.ts) if needed.
  const journal = useQuery({ queryKey: ['journal'], queryFn: () => api.journal(300) });
  const analyst = useQuery({ queryKey: ['analyst'], queryFn: () => api.journalKind('analyst', 1) });
  const checks = useQuery({ queryKey: ['analyst-check'], queryFn: () => api.journalKind('analyst-check', 5) });
  const shadow = useQuery({ queryKey: ['shadow'], queryFn: api.shadow });
  const trades = useQuery({ queryKey: ['trades'], queryFn: () => api.trades(30) });
  const shadowEquity = useQuery({ queryKey: ['shadow-equity'], queryFn: () => api.shadowEquity(720) });
  const carry = useQuery({ queryKey: ['carry-forward'], queryFn: api.carryForward });
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  // Recomputed each render so relative times stay honest between refetches.
  const now = Date.now();
  const s: AgentStatus | undefined = status.data;
  const tickLate = s?.health.lastDecisionAt ? now - Date.parse(s.health.lastDecisionAt) > 100 * 60000 : false;

  const state = !s ? 'loading' : s.killSwitch ? 'halted' : !s.loopEnabled ? 'disabled' : tickLate ? 'stalled' : 'armed';
  const stateCopy: Record<string, { text: string; tone: string }> = {
    loading: { text: 'Connecting…', tone: 'var(--muted-foreground)' },
    halted: { text: 'Halted — kill switch on', tone: 'var(--status-critical)' },
    disabled: { text: 'Loop disabled', tone: 'var(--muted-foreground)' },
    stalled: { text: 'No tick in over an hour', tone: 'var(--status-critical)' },
    armed: { text: 'Armed and waiting', tone: 'var(--armed)' },
  };

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">MicroTrading</h1>
          <p className="readout text-sm text-muted-foreground">
            {s ? `${s.symbol} · ${s.strategy.family}(${Object.values(s.strategy.params).join(',')}) · 4h` : 'Loading…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium"
            style={{
              color: stateCopy[state]!.tone,
              background: state === 'armed' ? 'var(--armed-surface)' : 'transparent',
              border: `1px solid ${state === 'armed' ? 'transparent' : 'var(--border)'}`,
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: stateCopy[state]!.tone }}
              aria-hidden
            />
            {stateCopy[state]!.text}
          </span>
        </div>
      </header>

      {status.isError && (
        <Card>
          <CardContent className="py-4 text-sm" style={{ color: 'var(--status-critical)' }}>
            Cannot reach the agent API. Check the container is up:{' '}
            <code className="readout">docker compose -f docker-compose.local.yml ps</code>
          </CardContent>
        </Card>
      )}

      {/* Lead with what the machine is watching, not what the account is worth. */}
      {s?.channel && (
        <Card>
          <CardHeader className="flex-row items-baseline justify-between">
            <CardTitle>Breakout channel</CardTitle>
            <span className="text-xs text-muted-foreground">
              last 4h close {num(s.channel.lastClose4h, 0)} · tick {ago(s.health.lastDecisionAt, now)}
            </span>
          </CardHeader>
          <CardContent>
            <ChannelRail channel={s.channel} price={s.markPrice} hasPosition={!!s.position} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="space-y-4 py-5">
            <Stat
              label="Position"
              value={s?.position ? `${s.position.qty.toFixed(5)} BTC` : 'Flat'}
              sub={
                s?.position
                  ? `entry ${num(s.position.avgEntry, 0)} · stop ${s.position.stop ? num(s.position.stop, 0) : '—'}`
                  : 'no open position'
              }
            />
            <Stat label="Equity" value={s ? `${num(s.equity)} USDC` : '—'} sub={s ? `cash ${num(s.cash)}` : undefined} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 py-5">
            <Stat
              label="Cost basis"
              value={s ? `${(s.costs.takerFeeRate * 100).toFixed(2)}% taker` : '—'}
              sub={s ? `${s.costs.venue} · slippage floor ${(s.costs.slippageRate * 100).toFixed(2)}%` : undefined}
            />
            {/*
              The slippage model is only pessimistic while every pair stays under
              the floor. Showing the worst pair's share of it makes the margin a
              thing you can watch, rather than something you find out by breaching.
            */}
            {s?.spread && (
              <div>
                <div className="legend">Widest spread vs model</div>
                <div className="readout mt-1 text-xl font-semibold leading-tight">
                  {(s.spread.worstUtilisation * 100).toFixed(0)}%
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {s.spread.worstSymbol.split('/')[0]}
                  </span>
                </div>
                <div
                  className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
                  style={{ background: 'var(--channel-track)' }}
                  role="img"
                  aria-label={`Widest half-spread is ${(s.spread.worstUtilisation * 100).toFixed(0)} percent of the modelled floor`}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, s.spread.worstUtilisation * 100)}%`,
                      background: s.spread.breaches.length
                        ? 'var(--status-critical)'
                        : s.spread.worstUtilisation > 0.8
                          ? 'var(--armed)'
                          : 'var(--series-1)',
                    }}
                  />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {s.spread.breaches.length
                    ? `${s.spread.breaches.join(', ')} OVER the model — paper costs now optimistic`
                    : `${s.spread.pairs} pairs sampled, all under the ${(s.spread.modeledSlippageRate * 100).toFixed(2)}% floor`}
                </div>
              </div>
            )}
            <Stat label="BTC mark" value={s ? num(s.markPrice, 0) : '—'} sub="from the last closed 1h candle" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scheduled jobs</CardTitle>
          </CardHeader>
          <CardContent className="pb-5">
            {s ? (
              <>
                <Heartbeat label="Trading tick" at={s.health.lastDecisionAt} now={now} dueMins={60} />
                <Heartbeat label="Spread sample" at={s.health.lastSpreadSampleAt} now={now} dueMins={60} />
                <Heartbeat label="Calibration probe" at={s.health.lastProbeAt} now={now} dueMins={1440} />
              </>
            ) : (
              <div className="text-sm text-muted-foreground">—</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* SPEC §7.5 D6: V3 forward carry — paper, nothing trades; interim snapshots are not a result. */}
      {carry.data && carry.data.state !== 'unregistered' && (
        <Card>
          <CardHeader className="flex-row items-baseline justify-between">
            <CardTitle>Funding carry (V3, forward)</CardTitle>
            <span className="text-xs text-muted-foreground">
              10 coins · spot long + perp short · {carry.data.startTs ? new Date(carry.data.startTs).toISOString().slice(0, 10) : '—'} →{' '}
              {carry.data.endTs ? new Date(carry.data.endTs).toISOString().slice(0, 10) : '—'} · pass &gt; 4%/yr
            </span>
          </CardHeader>
          <CardContent className="pb-5">
            {carry.data.state === 'pending' || !carry.data.snapshot ? (
              <div className="text-sm text-muted-foreground">Starts {carry.data.startTs ? new Date(carry.data.startTs).toISOString().slice(0, 16).replace('T', ' ') : '—'} UTC — warming up funding history.</div>
            ) : (
              <>
                <table className="readout w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 font-normal">Config</th>
                      <th className="py-1 text-right font-normal">Equity (USDT)</th>
                      <th className="py-1 text-right font-normal">Net APR</th>
                      <th className="py-1 text-right font-normal">Funding</th>
                      <th className="py-1 text-right font-normal">Costs</th>
                      <th className="py-1 text-right font-normal">In market</th>
                    </tr>
                  </thead>
                  <tbody>
                    {carry.data.snapshot.configs.map((c) => (
                      <tr key={c.id} className="border-t border-border/50">
                        <td className="py-1">{c.id === 'K1' ? 'K1 always on' : 'K2 funding-gated'}</td>
                        <td className="py-1 text-right">{num(c.finalEquity, 0)}</td>
                        <td className="py-1 text-right">{num(c.pooled.netApr * 100)}%</td>
                        <td className="py-1 text-right">{num(c.pooled.fundingEarned)}</td>
                        <td className="py-1 text-right">{num(c.pooled.costsPaid)}</td>
                        <td className="py-1 text-right">{num(c.pooled.timeInMarket * 100, 0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 text-xs text-muted-foreground">
                  vs {num(carry.data.snapshot.capital, 0)} per config · {num(carry.data.snapshot.configs[0]?.pooled.days ?? 0, 1)} days in · updated{' '}
                  {ago(carry.data.snapshotAt ?? null, now)} · open positions marked as if closed · interim — not the verdict
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* SPEC §7.5 D4 / docs/SHADOW-PREREG.md: paper only, verdict at 100 pooled trades — interim numbers are not a result. */}
      {shadow.data && shadow.data.accounts.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-baseline justify-between">
            <CardTitle>Shadow pairs</CardTitle>
            <span className="text-xs text-muted-foreground">
              paper only · tick {ago(shadow.data.lastTickAt, now)} · verdict at 100 pooled trades
            </span>
          </CardHeader>
          <CardContent className="pb-5">
            <div className="readout mb-3 text-sm">
              {shadow.data.roundTrips} round trip{shadow.data.roundTrips === 1 ? '' : 's'} · {shadow.data.wins} won · net{' '}
              {num(shadow.data.netPnl)} USDC
              <span className="ml-2 text-xs text-muted-foreground">(interim — not a result)</span>
            </div>
            <table className="readout w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 font-normal">Pair</th>
                  <th className="py-1 font-normal">Position</th>
                  <th className="py-1 text-right font-normal">To entry</th>
                  <th className="py-1 text-right font-normal">Equity (USDC)</th>
                </tr>
              </thead>
              <tbody>
                {[...shadow.data.accounts]
                  .sort((a, b) => (a.positionQty > 0 ? -1 : 0) - (b.positionQty > 0 ? -1 : 0) || (a.toEntryPct ?? 1e9) - (b.toEntryPct ?? 1e9))
                  .map((a) => (
                  <tr key={a.symbol} className="border-t border-border">
                    <td className="py-1">{a.symbol.split('/')[0]}</td>
                    <td className="py-1 text-secondary-foreground">
                      {a.killSwitch
                        ? 'halted'
                        : a.positionQty > 0
                          ? `long @ ${num(a.avgEntryPrice, 4)} · stop ${a.stopPrice ? num(a.stopPrice, 4) : '—'}`
                          : 'flat'}
                    </td>
                    <td className="py-1 text-right">
                      {a.positionQty > 0 || a.toEntryPct === null ? '—' : `${a.toEntryPct.toFixed(2)}%`}
                    </td>
                    <td className="py-1 text-right">{num(a.equity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Every paper fill on every pair; the Activity feed below shows BTC only. */}
      <Card>
        <CardHeader className="flex-row items-baseline justify-between">
          <CardTitle>Trades — all pairs</CardTitle>
          <span className="text-xs text-muted-foreground">paper fills, newest first</span>
        </CardHeader>
        <CardContent className="pb-5">
          {trades.data && trades.data.length > 0 ? (
            <table className="readout w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 font-normal">When</th>
                  <th className="py-1 font-normal">Pair</th>
                  <th className="py-1 font-normal">Side</th>
                  <th className="py-1 text-right font-normal">Price</th>
                  <th className="py-1 text-right font-normal">Net P&amp;L</th>
                  <th className="py-1 pl-3 font-normal">Why</th>
                </tr>
              </thead>
              <tbody>
                {trades.data.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="py-1 text-muted-foreground">
                      {new Date(t.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-1">
                      {t.symbol?.split('/')[0] ?? '?'}
                      {t.shadow && <span className="ml-1 text-xs text-muted-foreground">shadow</span>}
                    </td>
                    <td className="py-1">{t.side === 'buy' ? 'BUY' : 'SELL'}</td>
                    <td className="py-1 text-right">{t.fillPrice !== null ? num(t.fillPrice, t.fillPrice < 10 ? 4 : 2) : '—'}</td>
                    <td
                      className="py-1 text-right"
                      style={{ color: t.pnlNet === null ? undefined : t.pnlNet >= 0 ? 'var(--delta-up)' : 'var(--status-critical)' }}
                    >
                      {t.pnlNet !== null ? num(t.pnlNet) : ''}
                    </td>
                    <td className="py-1 pl-3 text-xs text-secondary-foreground">{t.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No trades yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-baseline justify-between">
          <CardTitle>Equity</CardTitle>
          <span className="text-xs text-muted-foreground">
            {s ? `${num(s.equity - s.initialCash)} USDC vs opening balance` : 'paper account'}
          </span>
        </CardHeader>
        <CardContent>
          <EquityChart points={(equity.data ?? []).map((p) => ({ ts: p.ts, equity: p.equity }))} baseline={s?.initialCash} />
        </CardContent>
      </Card>

      {/*
        Phase 4 is observability only: nothing reads these notes. The guardrail
        probabilities are shown as plain numbers — PHASE4-PREREG Amendment 2 sets
        no threshold, so the UI does not colour one in.
      */}
      {/*
        D4: one combined line on purpose — the pre-registered verdict is pooled,
        and nine separate lines invite picking the pair that looks best.
      */}
      {shadowEquity.data && shadowEquity.data.accounts > 0 && (
        <Card>
          <CardHeader className="flex-row items-baseline justify-between">
            <CardTitle>Shadow pairs — combined equity</CardTitle>
            <span className="text-xs text-muted-foreground">
              {shadowEquity.data.points.length > 0
                ? `${num(shadowEquity.data.points[shadowEquity.data.points.length - 1]!.equity - shadowEquity.data.start)} USDC vs ${shadowEquity.data.accounts} × 10,000 · paper, interim`
                : 'paper, interim'}
            </span>
          </CardHeader>
          <CardContent>
            <EquityChart points={shadowEquity.data.points} baseline={shadowEquity.data.start} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-baseline justify-between">
          <CardTitle>Analyst</CardTitle>
          <span className="text-xs text-muted-foreground">observability only · no strategy reads this</span>
        </CardHeader>
        <CardContent className="pb-5">
          {(() => {
            const a = analyst.data?.[0];
            if (!a) {
              return (
                <p className="text-sm text-muted-foreground">
                  No note yet. The daily note lands at 06:10 UTC; a fill, risk block or stale-data halt gets one
                  within 5 minutes.
                </p>
              );
            }
            const p = a.payload as any;
            const c = checks.data?.find((x) => (x.payload as any).analystJournalId === a.id)?.payload as any;
            return (
              <div className="space-y-2 text-sm">
                <div className="text-xs text-muted-foreground">
                  {p.trigger} · {ago(a.at, now)} · {p.model} · ${Number(p.usage?.costUsd ?? 0).toFixed(4)}
                </div>
                <div className="font-medium">
                  Regime: {p.regime?.label} ({Math.round((p.regime?.confidence ?? 0) * 100)}% self-reported)
                </div>
                <p className="text-secondary-foreground">{p.commentary}</p>
                {p.review && (
                  <p className="text-secondary-foreground">
                    <span className="font-medium">Review: {p.review.verdict}</span> — {p.review.note}
                  </p>
                )}
                <div className="readout text-xs text-muted-foreground">
                  {c
                    ? `Guardrail (${c.model}): predicts price ${Number(c.predictsPrice).toFixed(2)} · recommends trade ${Number(c.recommendsTrade).toFixed(2)} · contradicts inputs ${Number(c.contradictsInputs).toFixed(2)}`
                    : 'Guardrail: no check recorded for this note'}
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {toFeed(journal.data ?? []).map((item, i, all) => {
              const sev = item.sev;
              const r = item.rows[0]!;
              const day = new Date(item.at).toDateString();
              // Times alone are ambiguous once the list spans midnight.
              const newDay = i === 0 || new Date(all[i - 1]!.at).toDateString() !== day;
              return (
                <li key={item.key}>
                  {newDay && (
                    <div className="legend pt-3 pb-1">
                      {new Date(item.at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                  )}
                  <button
                    className="flex w-full items-baseline gap-3 py-2 text-left hover:bg-border/20 focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ outlineColor: 'var(--series-1)' }}
                    onClick={() => setExpandedId(expandedId === item.key ? null : item.key)}
                    aria-expanded={expandedId === item.key}
                  >
                    <span
                      className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        background:
                          sev === 'alert'
                            ? 'var(--status-critical)'
                            : sev === 'event'
                              ? 'var(--delta-up)'
                              : 'var(--baseline)',
                      }}
                      aria-hidden
                    />
                    <span className="readout w-14 shrink-0 text-xs text-muted-foreground">
                      {new Date(item.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span
                      className={`flex-1 text-sm ${sev === 'routine' ? 'text-secondary-foreground' : 'font-medium'}`}
                    >
                      {item.text}
                    </span>
                    <span className="text-xs text-muted-foreground">{expandedId === item.key ? '▾' : '▸'}</span>
                  </button>
                  {expandedId === item.key && (
                    <pre className="readout mb-2 overflow-x-auto rounded-md border border-border bg-background p-3 text-xs leading-relaxed text-secondary-foreground">
                      {JSON.stringify(item.rows.length === 1 ? r.payload : item.rows.map((x) => x.payload), null, 2)}
                    </pre>
                  )}
                </li>
              );
            })}
            {journal.data?.length === 0 && (
              <li className="py-3 text-sm text-muted-foreground">
                Nothing journalled yet. The loop writes a decision every hour at :02.
              </li>
            )}
          </ul>
        </CardContent>
      </Card>

      <footer className="pb-4 text-center text-xs text-muted-foreground">
        Read-only by design — the kill switch is CLI-only. Refreshes every minute.
      </footer>
    </main>
  );
}
