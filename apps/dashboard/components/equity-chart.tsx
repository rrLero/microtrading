'use client';

import * as React from 'react';

export interface EquityPoint {
  ts: number;
  equity: number;
}

/**
 * Equity line (single series → no legend; the title names it).
 * Dataviz specs: 2px line in series-1, hairline grid, recessive axes,
 * crosshair + tooltip on hover with an 8px marker, text in ink tokens,
 * tabular figures on ticks.
 */
export function EquityChart({ points, baseline }: { points: EquityPoint[]; baseline?: number }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);

  const W = 800;
  const H = 260;
  // r leaves room for the last x-label, which otherwise clips at the plot edge.
  const PAD = { l: 56, r: 34, t: 12, b: 28 };

  if (points.length < 2) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        Not enough equity points yet — the loop journals one per hourly tick.
      </div>
    );
  }

  const xs = points.map((p) => p.ts);
  const ys = points.map((p) => p.equity);
  const xMin = xs[0]!;
  const xMax = xs[xs.length - 1]!;

  /*
   * Auto-scaling to the data alone turns ±0.05% of drift into a rollercoaster:
   * a 4 USDC wobble on a 10,000 account filled the full plot height and read as
   * volatility that is not there. The domain is therefore anchored to the
   * account's starting equity and held to a floor of ±0.5% around it, so the
   * line stays visually flat until something actually happens.
   */
  const start = baseline ?? ys[0]!;
  const MIN_HALF_SPAN = start * 0.005;
  const reach = Math.max(MIN_HALF_SPAN, ...ys.map((v) => Math.abs(v - start))) * 1.15;
  const yMin = start - reach;
  const yMax = start + reach;

  const x = (ts: number) => PAD.l + ((ts - xMin) / (xMax - xMin || 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - ((v - yMin) / (yMax - yMin || 1)) * (H - PAD.t - PAD.b);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ts).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ');

  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / yTicks);
  const xTickCount = Math.min(5, points.length);
  const xTickVals = Array.from({ length: xTickCount }, (_, i) => xMin + ((xMax - xMin) * i) / (xTickCount - 1 || 1));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(x(points[i]!.ts) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHover(best);
  };

  const hp = hover !== null ? points[hover]! : null;
  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Paper account equity over time"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {yTickVals.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--gridline)" strokeWidth={1} />
            <text
              x={PAD.l - 8}
              y={y(v) + 3.5}
              textAnchor="end"
              fontSize={11}
              fill="var(--muted-foreground)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {v.toFixed(0)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--baseline)" strokeWidth={1} />
        {xTickVals.map((ts) => (
          <text
            key={ts}
            x={x(ts)}
            y={H - PAD.b + 16}
            textAnchor="middle"
            fontSize={11}
            fill="var(--muted-foreground)"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </text>
        ))}

        {/* Where the account opened — without it, a flat line has no meaning. */}
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={y(start)}
          y2={y(start)}
          stroke="var(--baseline)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <text x={W - PAD.r} y={y(start) - 6} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
          {baseline ? `opened at ${start.toFixed(0)}` : `window start ${start.toFixed(0)}`}
        </text>

        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />

        {hp && (
          <g>
            <line x1={x(hp.ts)} x2={x(hp.ts)} y1={PAD.t} y2={H - PAD.b} stroke="var(--baseline)" strokeWidth={1} />
            <circle cx={x(hp.ts)} cy={y(hp.equity)} r={4} fill="var(--series-1)" stroke="var(--card)" strokeWidth={2} />
          </g>
        )}
      </svg>

      {hp && (
        <div
          className="pointer-events-none absolute rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-sm"
          style={{
            left: `${(x(hp.ts) / W) * 100}%`,
            top: 0,
            transform: x(hp.ts) > W * 0.7 ? 'translateX(-110%)' : 'translateX(12px)',
          }}
        >
          <div className="text-muted-foreground">{fmtTime(hp.ts)}</div>
          <div className="font-medium" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {hp.equity.toFixed(2)} USDC
          </div>
        </div>
      )}
    </div>
  );
}
