"use client";

import { useMemo, useState } from "react";
import { recordStore, useRecord } from "@/lib/store";
import { isoDay } from "@/lib/record";
import { bus } from "@/lib/bus";

const SLOTS = ["morning", "midday", "evening", "bedtime"] as const;
type Slot = (typeof SLOTS)[number];
const SLOT_ICON: Record<Slot, string> = { morning: "🌅", midday: "☀️", evening: "🌆", bedtime: "🌙" };

/**
 * Medication schedule + adherence. Medications themselves live in
 * profile.medications (free text, shared with the model). This panel adds
 * a schedule per med and a daily check-off log the model can see in the
 * record summary ("took metformin this morning, missed evening dose").
 */
export function MedicationsPanel() {
  const r = useRecord();
  const [open, setOpen] = useState(false);
  const today = isoDay(new Date());
  const meds = r.profile.medications;
  const schedule = r.medSchedule ?? {};
  const log = r.medLog ?? {};

  const adherence7 = useMemo(() => {
    let due = 0;
    let taken = 0;
    for (let i = 1; i <= 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const day = isoDay(d);
      for (const m of meds) {
        const slots = schedule[m] ?? [];
        due += slots.length;
        taken += (log[day]?.[m] ?? []).filter((s) => slots.includes(s as Slot)).length;
      }
    }
    return due ? Math.round((taken / due) * 100) : null;
  }, [meds, schedule, log]);

  if (!meds.length) return null;
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="rounded-xl border border-dashed border-border px-3 py-2 text-left text-ink-2 hover:border-brand hover:text-ink">
        💊 Medication schedule &amp; check-off{adherence7 != null ? ` · ${adherence7}% last 7 days` : ""}
      </button>
    );

  const toggleSlot = (med: string, slot: Slot) =>
    recordStore.set((rec) => {
      const cur = rec.medSchedule?.[med] ?? [];
      const next = cur.includes(slot) ? cur.filter((s) => s !== slot) : [...cur, slot];
      return { ...rec, medSchedule: { ...(rec.medSchedule ?? {}), [med]: next } };
    });

  const toggleTaken = (med: string, slot: Slot) =>
    recordStore.set((rec) => {
      const day = rec.medLog?.[today] ?? {};
      const cur = day[med] ?? [];
      const next = cur.includes(slot) ? cur.filter((s) => s !== slot) : [...cur, slot];
      return { ...rec, medLog: { ...(rec.medLog ?? {}), [today]: { ...day, [med]: next } } };
    });

  return (
    <section className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Medications today</h3>
        <div className="flex items-center gap-2">
          {adherence7 != null && <span className="text-[11px] text-ink-3">{adherence7}% taken, last 7 days</span>}
          <button onClick={() => setOpen(false)} className="text-xs text-ink-3">
            close
          </button>
        </div>
      </div>
      <ul className="flex flex-col gap-2">
        {meds.map((m) => {
          const slots = schedule[m] ?? [];
          const taken = log[today]?.[m] ?? [];
          return (
            <li key={m} className="rounded-lg border border-border p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-sm font-medium">{m}</div>
                <button onClick={() => bus.send({ text: `Tell me about ${m.split("(")[0].trim()}: what it's for, common side effects, anything I shouldn't take with it, and when's the best time to take it.` })} className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-surface-2">
                  ask
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {SLOTS.map((s) => {
                  const scheduled = slots.includes(s);
                  const done = taken.includes(s);
                  return (
                    <button
                      key={s}
                      onClick={(e) => (e.shiftKey || !scheduled ? toggleSlot(m, s) : toggleTaken(m, s))}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        toggleSlot(m, s);
                      }}
                      title={scheduled ? (done ? "Taken (click to undo; right-click to unschedule)" : "Click when taken; right-click to unschedule") : "Click to add to schedule"}
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        !scheduled ? "border-dashed border-border text-ink-3 hover:text-ink" : done ? "border-[var(--good)] bg-[var(--good)]/15 text-ink" : "border-border bg-surface-2 text-ink-2"
                      }`}
                    >
                      {SLOT_ICON[s]} {s}
                      {scheduled && done ? " ✓" : ""}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-ink-3">Click a time to add it to the schedule, click again when you&apos;ve taken it. Right-click removes a time. The assistant sees today&apos;s check-offs.</p>
    </section>
  );
}
