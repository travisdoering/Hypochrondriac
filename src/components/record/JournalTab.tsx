"use client";

import { useMemo, useState } from "react";
import { recordStore, useRecord } from "@/lib/store";
import { fmtNum, type JournalEntry } from "@/lib/record";
import { bus } from "@/lib/bus";
import { SymptomHeatmap } from "./SymptomHeatmap";

export function JournalTab() {
  const r = useRecord();
  const [filter, setFilter] = useState("");
  const entries = useMemo(
    () =>
      [...r.journal]
        .sort((a, b) => b.ts.localeCompare(a.ts))
        .filter((e) => !filter || JSON.stringify(e).toLowerCase().includes(filter.toLowerCase())),
    [r.journal, filter],
  );

  const byDay = useMemo(() => {
    const m = new Map<string, JournalEntry[]>();
    for (const e of entries) {
      const d = e.ts.slice(0, 10);
      m.set(d, [...(m.get(d) ?? []), e]);
    }
    return [...m.entries()];
  }, [entries]);

  const weekly = useMemo(() => {
    const cutoff = Date.now() - 7 * 86_400_000;
    const week = r.journal.filter((e) => new Date(e.ts).getTime() > cutoff);
    const avg = (k: "mood" | "pain" | "anxiety" | "energy") => {
      const v = week.map((e) => e[k]).filter((x): x is number => x != null);
      return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null;
    };
    const symptoms = new Map<string, number>();
    for (const e of week) for (const s of e.symptoms) symptoms.set(s.toLowerCase(), (symptoms.get(s.toLowerCase()) ?? 0) + 1);
    return { n: week.length, mood: avg("mood"), pain: avg("pain"), anxiety: avg("anxiety"), energy: avg("energy"), top: [...symptoms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4) };
  }, [r.journal]);

  return (
    <div className="flex flex-col gap-4 text-sm">
      {r.journal.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="mb-1 flex items-center justify-between">
            <div className="font-semibold">Last 7 days</div>
            <button
              onClick={() => bus.send({ text: "Give me an honest look-back on my last week from the journal: patterns, anything I should pay attention to, and one small thing to try." })}
              className="rounded border border-border px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-2"
            >
              Ask for a look-back
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <Stat label="entries" v={String(weekly.n)} />
            <Stat label="mood" v={weekly.mood ?? "—"} />
            <Stat label="pain" v={weekly.pain ?? "—"} />
            <Stat label="anxiety" v={weekly.anxiety ?? "—"} />
          </div>
          {weekly.top.length > 0 && (
            <div className="mt-2 text-xs text-ink-2">
              Most mentioned: {weekly.top.map(([s, n]) => `${s} (${n})`).join(", ")}
            </div>
          )}
        </div>
      )}

      <SymptomHeatmap journal={r.journal} />

      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search entries (symptom, tag, word)..." className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 outline-none focus:border-brand" />

      {byDay.length === 0 && <p className="text-ink-3">No journal entries yet. Anything you tell me about how you feel gets logged here automatically. You can also use the quick check-in on the Today tab.</p>}

      {byDay.map(([day, list]) => (
        <div key={day}>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">{fmtDay(day)}</div>
          <ul className="flex flex-col gap-1.5">
            {list.map((e) => (
              <li key={e.id} className="group rounded-xl border border-border bg-surface p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-ink-3">{new Date(e.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                    {e.source && e.source !== "assistant" && e.source !== "user" && <Tag>{e.source === "fhir" ? "from EHR" : e.source}</Tag>}
                    {e.triage && e.triage !== "none" && (
                      <Tag color={`var(--t-${e.triage.replace("-", "")})`}>{e.triage.replace("-", " ")}</Tag>
                    )}
                    {e.mood != null && <Tag>mood {e.mood}</Tag>}
                    {e.energy != null && <Tag>energy {e.energy}</Tag>}
                    {e.pain != null && e.pain > 0 && <Tag>pain {e.pain}</Tag>}
                    {e.anxiety != null && e.anxiety > 0 && <Tag>anxiety {e.anxiety}</Tag>}
                  </div>
                  <button
                    onClick={() => recordStore.set((r) => ({ ...r, journal: r.journal.filter((x) => x.id !== e.id) }))}
                    className="invisible text-xs text-ink-3 hover:text-[var(--critical)] group-hover:visible"
                    aria-label="Delete entry"
                  >
                    delete
                  </button>
                </div>
                {e.notes && <p className="mt-1 text-ink">{e.notes}</p>}
                {e.symptoms.length > 0 && <div className="mt-1 text-xs text-ink-2">Symptoms: {e.symptoms.join(", ")}</div>}
                {e.vitals && (
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-2">
                    {e.vitals.systolic && e.vitals.diastolic && <span>BP {Math.round(e.vitals.systolic)}/{Math.round(e.vitals.diastolic)}</span>}
                    {e.vitals.heartRate && <span>HR {Math.round(e.vitals.heartRate)}</span>}
                    {e.vitals.tempC && <span>Temp {fmtNum(e.vitals.tempC)}°C / {Math.round((e.vitals.tempC * 9) / 5 + 32)}°F</span>}
                    {e.vitals.spo2 && <span>SpO₂ {Math.round(e.vitals.spo2)}%</span>}
                    {e.vitals.weightKg && <span>Wt {fmtNum(e.vitals.weightKg)} kg</span>}
                    {e.vitals.glucoseMgDl && <span>Glucose {Math.round(e.vitals.glucoseMgDl)}</span>}
                    {e.vitals.sleepHours && <span>Sleep {fmtNum(e.vitals.sleepHours)} h</span>}
                    {e.vitals.steps && <span>{e.vitals.steps.toLocaleString()} steps</span>}
                  </div>
                )}
                {e.tags.length > 0 && <div className="mt-1 text-[11px] text-ink-3">#{e.tags.join(" #")}</div>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums">{v}</div>
      <div className="text-[11px] text-ink-3">{label}</div>
    </div>
  );
}

export function Tag({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span className="rounded-full border px-1.5 py-0.5 text-[10px]" style={color ? { borderColor: color, color } : { borderColor: "var(--border)", color: "var(--ink-2)" }}>
      {children}
    </span>
  );
}

export function fmtDay(day: string): string {
  const d = new Date(day + "T12:00:00");
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}
