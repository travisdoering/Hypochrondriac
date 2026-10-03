"use client";

import { useId, useState } from "react";

export interface Point {
  x: number; // ms epoch
  y: number;
  label?: string;
}

/**
 * Small single-series line with hover tooltip, optional reference band and
 * optional direct label on the last point. Follows the dataviz mark specs:
 * 2px line, >=8px hover target, recessive grid, text in ink tokens.
 */
export function Sparkline({
  points,
  width = 220,
  height = 56,
  color = "var(--series-1)",
  refLow,
  refHigh,
  unit = "",
  format = (v: number) => (Number.isInteger(v) ? String(v) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/0$/, "")),
  showLast = true,
  ariaLabel,
}: {
  points: Point[];
  width?: number;
  height?: number;
  color?: string;
  refLow?: number;
  refHigh?: number;
  unit?: string;
  format?: (v: number) => string;
  showLast?: boolean;
  ariaLabel?: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const pts = [...points].sort((a, b) => a.x - b.x);
  if (pts.length === 0) return <div className="text-xs text-ink-3">no data</div>;

  const pad = { l: 4, r: showLast ? 34 : 4, t: 6, b: 6 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  let minY = Math.min(...ys, refLow ?? Infinity);
  let maxY = Math.max(...ys, refHigh ?? -Infinity);
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const yPad = (maxY - minY) * 0.1;
  minY -= yPad;
  maxY += yPad;
  const sx = (x: number) => pad.l + (maxX === minX ? W / 2 : ((x - minX) / (maxX - minX)) * W);
  const sy = (y: number) => pad.t + H - ((y - minY) / (maxY - minY)) * H;
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const hp = hover != null ? pts[hover] : null;

  return (
    <div className="relative inline-block" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel ?? `trend of ${pts.length} values, latest ${format(last.y)}${unit}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = e.clientX - rect.left;
          let best = 0;
          let bd = Infinity;
          pts.forEach((p, i) => {
            const dd = Math.abs(sx(p.x) - x);
            if (dd < bd) {
              bd = dd;
              best = i;
            }
          });
          setHover(best);
        }}
      >
        {(refLow != null || refHigh != null) && (
          <rect
            x={pad.l}
            width={W}
            y={sy(refHigh ?? maxY)}
            height={Math.max(0, sy(refLow ?? minY) - sy(refHigh ?? maxY))}
            fill={color}
            opacity={0.1}
            rx={2}
          />
        )}
        <line x1={pad.l} x2={pad.l + W} y1={pad.t + H} y2={pad.t + H} stroke="var(--grid)" strokeWidth={1} />
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {pts.length === 1 && <circle cx={sx(last.x)} cy={sy(last.y)} r={3} fill={color} />}
        {hp && (
          <>
            <line x1={sx(hp.x)} x2={sx(hp.x)} y1={pad.t} y2={pad.t + H} stroke="var(--axis)" strokeWidth={1} strokeDasharray="2 2" />
            <circle cx={sx(hp.x)} cy={sy(hp.y)} r={4} fill={color} stroke="var(--chart-surface)" strokeWidth={2} />
          </>
        )}
        {showLast && !hp && (
          <text x={sx(last.x) + 6} y={sy(last.y) + 4} fontSize={11} fill="var(--ink-2)" fontWeight={600}>
            {format(last.y)}
            {unit}
          </text>
        )}
        <clipPath id={id}>
          <rect x={0} y={0} width={width} height={height} />
        </clipPath>
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute -top-7 whitespace-nowrap rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] text-ink shadow-sm"
          style={{ left: Math.min(Math.max(sx(hp.x) - 30, 0), width - 90) }}
        >
          <span className="font-semibold">
            {format(hp.y)}
            {unit}
          </span>{" "}
          <span className="text-ink-3">{hp.label ?? new Date(hp.x).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        </div>
      )}
    </div>
  );
}
