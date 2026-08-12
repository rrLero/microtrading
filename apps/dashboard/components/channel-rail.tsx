'use client';

export interface Channel {
  upper: number;
  lower: number;
  lastClose4h: number;
  entryLookback: number;
  exitLookback: number;
  toEntryPct: number;
  toExitPct: number;
}

const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = (v: number) => `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(2)}%`;

/**
 * The corridor the strategy watches, with price inside it.
 *
 * This is the page's lead because it answers the question an operator actually
 * has about a breakout agent that is flat by design: not "what is my equity"
 * (which barely moves) but "how close is it to doing something". The rail
 * encodes the decision rule itself — cross the top edge, it buys; fall through
 * the bottom, it sells.
 */
export function ChannelRail({ channel, price, hasPosition }: { channel: Channel; price: number; hasPosition: boolean }) {
  const span = channel.upper - channel.lower;
  // Price can sit outside the corridor between a breakout and the next fill.
  const raw = span > 0 ? (price - channel.lower) / span : 0.5;
  const posPct = Math.min(100, Math.max(0, raw * 100));
  const outside = raw < 0 || raw > 1;

  // Whichever edge the strategy is actually watching right now: flat → entry.
  const watching = hasPosition
    ? { label: 'to exit floor', value: channel.toExitPct, edge: fmt(channel.lower) }
    : { label: 'to entry trigger', value: channel.toEntryPct, edge: fmt(channel.upper) };
  const armed = watching.value <= 1;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div>
          <div className="legend">{watching.label}</div>
          <div
            className="readout text-5xl font-semibold leading-none"
            style={{ color: armed ? 'var(--armed)' : 'var(--foreground)' }}
          >
            {pct(watching.value)}
          </div>
        </div>
        <div className="text-right">
          <div className="legend">{hasPosition ? 'exit at' : 'buys above'}</div>
          <div className="readout text-2xl font-medium leading-none">{watching.edge}</div>
        </div>
      </div>

      <div className="mt-6">
        <div className="relative h-11">
          {/* corridor */}
          <div
            className="absolute inset-x-0 top-4 h-3 rounded-sm"
            style={{ background: 'var(--channel-fill)', border: '1px solid var(--channel-track)' }}
          />
          {/* edges */}
          <div className="absolute top-2 h-7 w-px" style={{ left: 0, background: 'var(--baseline)' }} />
          <div className="absolute top-2 h-7 w-px" style={{ right: 0, background: 'var(--baseline)' }} />
          {/* price marker */}
          <div
            className="absolute top-0"
            style={{ left: `${posPct}%`, transform: 'translateX(-50%)' }}
            title={`last 4h close ${fmt(channel.lastClose4h)} · mark ${fmt(price)}`}
          >
            <div
              className="h-11 w-0.5 rounded-full"
              style={{ background: outside ? 'var(--status-critical)' : 'var(--series-1)' }}
            />
          </div>
        </div>

        <div className="mt-1.5 flex items-baseline justify-between">
          <div>
            <div className="readout text-sm">{fmt(channel.lower)}</div>
            <div className="legend">{channel.exitLookback}-bar low</div>
          </div>
          <div className="text-center">
            <div className="readout text-sm font-semibold" style={{ color: 'var(--series-1)' }}>
              {fmt(price)}
            </div>
            <div className="legend">mark</div>
          </div>
          <div className="text-right">
            <div className="readout text-sm">{fmt(channel.upper)}</div>
            <div className="legend">{channel.entryLookback}-bar high</div>
          </div>
        </div>
      </div>

      <p className="mt-4 text-sm text-secondary-foreground">
        {hasPosition
          ? `Holding. Sells on a 4h close below ${fmt(channel.lower)}.`
          : `Flat. Buys on a 4h close above ${fmt(channel.upper)} — decisions use closed candles only, so the mark can cross intrabar without triggering.`}
      </p>
    </div>
  );
}
