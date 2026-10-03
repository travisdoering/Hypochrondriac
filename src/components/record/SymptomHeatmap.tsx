"use client";

import { useMemo, useState } from "react";
import type { JournalEntry } from "@/lib/record";
import { isoDay } from "@/lib/record";
import { bus } from "@/lib/bus";

/**
 * Symptoms x days grid for the last 4 weeks. One hue (sequential), darker =
 * more mentions / higher score that day. Lets patterns jump out: "headaches
 * cluster on short-sleep days", "anxiety peaks midweek".
 */
export function SymptomHeatmap({ journal }: { journal: JournalEntry[] }) {
  const [hover, setHover] = useState<{ row: string; day: string; v: number } | null>(null);
  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push(isoDay(d));
    }
    return out;
  }, []);

  const { rows, max } = useMemo(() => {
    const first = days[0];
    const counts = new Map<string, Map<string, number>>();
    const bump = (row: string, day: string, n: number) => {
      const m = counts.get(row) ?? new Map<string, number>();
      m.set(day, (m.get(day) ?? 0) + n);
      counts.set(row, m);
    };
    for (const e of journal) {
      const day = isoDay(new Date(e.ts));
      if (day < first) continue;
      for (const s of e.symptoms) bump(s.toLowerCase(), day, 1);
      if (e.pain != null && e.pain > 0) bump("pain (score)", day, e.pain / 10);
      if (e.anxiety != null && e.anxiety > 0) bump("anxiety (score)", day, e.anxiety / 10);
      if (e.mood != null && e.mood <= 4) bump("low mood", day, (5 - e.mood) / 4);
      if (e.vitals?.sleepHours != null && e.vitals.sleepHours < 6.5) bump("short sleep", day, 1);
      if (e.vitals?.systolic != null && e.vitals.systolic >= 140) bump("high BP", day, 1);
    }
    const rows = [...counts.entries()]
      .map(([name, m]) => ({ name, total: [...m.values()].reduce((a, b) => a + b, 0), m }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
    const max = Math.max(1, ...rows.flatMap((r) => [...r.m.values()]));
    return { rows, max };
  }, [journal, days]);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-[var(--chart-surface)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Patterns, last 4 weeks</div>
        <button
          onClick={() => bus.send({ text: "Look at my symptom patterns over the last four weeks - what clusters together, what seems to trigger what, and is there one experiment worth trying?" })}
          className="rounded border border-border px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-2"
        >
          Find patterns
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[2px] text-[10px]" role="grid" aria-label="Symptom frequency by day">
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <th scope="row" className="max-w-[110px] truncate pr-2 text-left font-medium text-ink-2" title={r.name}>
                  {r.name}
                </th>
                {days.map((d) => {
                  const v = r.m.get(d) ?? 0;
                  const t = v / max;
                  const isHover = hover?.row === r.name && hover.day === d;
                  return (
                    <td key={d} className="p-0">
                      <div
                        onMouseEnter={() => setHover({ row: r.name, day: d, v })}
                        onMouseLeave={() => setHover(null)}
                        className={`h-3.5 w-3.5 rounded-[3px] ${isHover ? "ring-2 ring-[var(--ink)]" : ""}`}
                        style={{ background: v === 0 ? "var(--surface-2)" : `color-mix(in oklab, var(--seq-500) ${Math.round(30 + t * 70)}%, var(--chart-surface))` }}
                        title={`${r.name} · ${d} · ${v % 1 === 0 ? v : v.toFixed(1)}`}
                        role="gridcell"
                        aria-label={`${r.name} on ${d}: ${v}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td />
              {days.map((d, i) => (
                <td key={d} className="p-0 text-center text-[8px] text-ink-3">
                  {i % 7 === 0 ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "numeric", day: "numeric" }) : ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-ink-3">
        <span>{hover ? `${hover.row} · ${new Date(hover.day + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${hover.v % 1 === 0 ? hover.v : hover.v.toFixed(1)}` : "hover a cell"}</span>
        <span className="flex items-center gap-1">
          less
          {[0.2, 0.5, 0.8, 1].map((t) => (
            <span key={t} className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: `color-mix(in oklab, var(--seq-500) ${Math.round(30 + t * 70)}%, var(--chart-surface))` }} />
          ))}
          more
        </span>
      </div>
    </div>
  );
}
