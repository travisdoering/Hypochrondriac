"use client";

import { useState } from "react";
import { recordStore, useRecord } from "@/lib/store";
import { isoDay, streak, uid, type Goal, type TriageLevel } from "@/lib/record";
import { bus } from "@/lib/bus";
import { inputCls } from "./TodayTab";
import { fmtDay } from "./JournalTab";
import { buildIcs, downloadIcs } from "@/lib/ics";

export function PlanTab() {
  const r = useRecord();
  const [newGoal, setNewGoal] = useState("");
  const [cadence, setCadence] = useState<Goal["cadence"]>("daily");
  const [newStep, setNewStep] = useState("");
  const today = isoDay(new Date());
  const active = r.goals.filter((g) => g.active);
  const retired = r.goals.filter((g) => !g.active);
  const open = r.carePlan.filter((c) => !c.done).sort((a, b) => order(a.urgency) - order(b.urgency));
  const done = r.carePlan.filter((c) => c.done);

  return (
    <div className="flex flex-col gap-5 text-sm">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Care plan</h3>
          <div className="flex gap-1.5">
            {open.length > 0 && (
              <button
                onClick={() => {
                  const events = open.map((c, i) => {
                    const start = new Date();
                    start.setDate(start.getDate() + (c.urgency === "emergency" || c.urgency === "urgent" ? 0 : c.urgency === "soon" ? 3 : 14) + i * 0);
                    start.setHours(9, 0, 0, 0);
                    return { uid: c.id, title: c.title, description: [c.reason, c.specialty ? `Specialty: ${c.specialty}` : "", `Urgency: ${c.urgency}`].filter(Boolean).join("\n"), start, durationMinutes: 30, alarmMinutesBefore: 60 };
                  });
                  downloadIcs("hypochondriac-care-plan", buildIcs(events, "Hypochondriac care plan"));
                }}
                className="rounded border border-border px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-2"
                title="Download .ics for Google/Apple/Outlook calendar"
              >
                📅 Add to calendar
              </button>
            )}
            <button onClick={() => bus.send({ text: "Looking at my open next steps and my record, what should I do first this week and who exactly should I call?" })} className="rounded border border-border px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-2">
              Prioritize for me
            </button>
          </div>
        </div>
        {open.length === 0 && <p className="text-ink-3">No open next steps. When I recommend seeing someone or getting a test, it lands here.</p>}
        <ul className="flex flex-col gap-1.5">
          {open.map((c) => (
            <li key={c.id} className="rounded-xl border border-border bg-surface p-2.5">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  onChange={() => {
                    recordStore.set((r) => ({ ...r, carePlan: r.carePlan.map((x) => (x.id === c.id ? { ...x, done: true } : x)) }));
                    bus.send({
                      text: `Done: ${c.title}.`,
                      extra: `The person just checked off the care-plan item "${c.title}". In one or two warm sentences, acknowledge it and ask what happened / what they were told, so you can log the outcome. Do not re-add this item.`,
                    });
                  }}
                  className="mt-0.5 h-4 w-4"
                />
                <div className="flex-1">
                  <div className="font-medium">{c.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                    <span className="font-semibold" style={{ color: `var(--t-${c.urgency.replace("-", "")})` }}>
                      {c.urgency.replace("-", " ")}
                    </span>
                    {c.specialty && <span>· {c.specialty}</span>}
                    <span>· added {fmtDay(c.createdAt.slice(0, 10)).toLowerCase()}</span>
                  </div>
                  {c.reason && <div className="mt-1 text-xs text-ink-2">{c.reason}</div>}
                </div>
              </div>
              <div className="mt-2 flex gap-2 pl-6">
                <button
                  onClick={() => bus.send({ text: `Help me find ${c.specialty ? `a ${c.specialty}` : "the right clinician"} near ${r.profile.location?.postalCode ?? "me"} for this: ${c.title}. And what should I say when I call?` })}
                  className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-brand-ink"
                >
                  Find & book
                </button>
                <button onClick={() => bus.send({ text: `Why did you recommend "${c.title}"? What would make it more or less urgent?` })} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-surface-2">
                  Why?
                </button>
                <button onClick={() => recordStore.set((r) => ({ ...r, carePlan: r.carePlan.filter((x) => x.id !== c.id) }))} className="ml-auto text-xs text-ink-3 hover:text-[var(--critical)]">
                  remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newStep.trim()) return;
            recordStore.set((r) => ({ ...r, carePlan: [...r.carePlan, { id: uid(), createdAt: new Date().toISOString(), title: newStep.trim(), urgency: "soon", done: false }] }));
            setNewStep("");
          }}
          className="mt-2 flex gap-2"
        >
          <input value={newStep} onChange={(e) => setNewStep(e.target.value)} className={inputCls} placeholder="Add a step (e.g. schedule eye exam)" />
          <button className="rounded-lg border border-border px-3 text-xs font-semibold hover:bg-surface-2">Add</button>
        </form>
        {done.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-ink-3">{done.length} completed</summary>
            <ul className="mt-1 flex flex-col gap-1 text-xs text-ink-3">
              {done.map((c) => (
                <li key={c.id} className="line-through">
                  {c.title}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Goals & habits</h3>
          <div className="flex gap-1.5">
            {active.some((g) => g.cadence !== "once") && (
              <button
                onClick={() => {
                  const events = active
                    .filter((g) => g.cadence !== "once")
                    .map((g) => {
                      const start = new Date();
                      start.setDate(start.getDate() + 1);
                      start.setHours(g.cadence === "daily" ? 8 : 10, 0, 0, 0);
                      return { uid: g.id, title: `✅ ${g.title}`, description: g.why, start, durationMinutes: 15, alarmMinutesBefore: 0, rrule: g.cadence === "daily" ? "FREQ=DAILY" : "FREQ=WEEKLY" };
                    });
                  downloadIcs("hypochondriac-habits", buildIcs(events, "Hypochondriac habits"));
                }}
                className="rounded border border-border px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-2"
                title="Recurring calendar reminders for your habits"
              >
                📅 Remind me
              </button>
            )}
            <button onClick={() => bus.send({ text: "Be my coach for a minute: look at my goals and journal, tell me what's working, and help me adjust or pick one tiny next habit." })} className="rounded border border-border px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-2">
              Coach check-in
            </button>
          </div>
        </div>
        {active.length === 0 && <p className="text-ink-3">No active goals. Tell me what you want to work on and we&apos;ll make it small and specific.</p>}
        <ul className="flex flex-col gap-1.5">
          {active.map((g) => {
            const doneToday = g.completions.includes(today);
            const last14 = Array.from({ length: 14 }, (_, i) => {
              const d = new Date();
              d.setDate(d.getDate() - (13 - i));
              return isoDay(d);
            });
            return (
              <li key={g.id} className="rounded-xl border border-border bg-surface p-2.5">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={doneToday}
                    onChange={(e) =>
                      recordStore.set((r) => ({
                        ...r,
                        goals: r.goals.map((x) => (x.id === g.id ? { ...x, completions: e.target.checked ? [...x.completions, today] : x.completions.filter((d) => d !== today), active: x.cadence === "once" && e.target.checked ? false : x.active } : x)),
                      }))
                    }
                    className="h-4 w-4"
                  />
                  <div className="flex-1">
                    <div className={`font-medium ${doneToday ? "text-ink-3 line-through" : ""}`}>{g.title}</div>
                    {g.why && <div className="text-xs text-ink-2">{g.why}</div>}
                  </div>
                  <div className="text-right text-xs text-ink-3">
                    <div>🔥 {streak(g)}</div>
                    <div>{g.cadence}</div>
                  </div>
                </div>
                {g.cadence === "daily" && (
                  <div className="mt-2 flex gap-[3px] pl-6" aria-label="last 14 days">
                    {last14.map((d) => (
                      <span key={d} title={d} className="h-2.5 flex-1 rounded-sm" style={{ background: g.completions.includes(d) ? "var(--brand)" : "var(--surface-2)" }} />
                    ))}
                  </div>
                )}
                <div className="mt-1.5 pl-6">
                  <button onClick={() => recordStore.set((r) => ({ ...r, goals: r.goals.map((x) => (x.id === g.id ? { ...x, active: false } : x)) }))} className="text-[11px] text-ink-3 hover:text-ink">
                    retire goal
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newGoal.trim()) return;
            recordStore.set((r) => ({ ...r, goals: [...r.goals, { id: uid(), title: newGoal.trim(), cadence, createdAt: new Date().toISOString(), completions: [], active: true }] }));
            setNewGoal("");
          }}
          className="mt-2 flex gap-2"
        >
          <input value={newGoal} onChange={(e) => setNewGoal(e.target.value)} className={inputCls} placeholder="New goal (e.g. 10-min walk after lunch)" />
          <select value={cadence} onChange={(e) => setCadence(e.target.value as Goal["cadence"])} className="rounded-lg border border-border bg-surface px-2 text-xs">
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
            <option value="once">once</option>
          </select>
          <button className="rounded-lg border border-border px-3 text-xs font-semibold hover:bg-surface-2">Add</button>
        </form>
        {retired.length > 0 && <div className="mt-2 text-xs text-ink-3">{retired.length} retired goal{retired.length > 1 ? "s" : ""}</div>}
      </section>

      {r.sessionNotes.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Session notes</h3>
          <ul className="flex flex-col gap-1.5">
            {[...r.sessionNotes]
              .sort((a, b) => b.ts.localeCompare(a.ts))
              .slice(0, 10)
              .map((n) => (
                <li key={n.id} className="rounded-xl border border-border bg-surface p-2.5 text-xs">
                  <div className="mb-0.5 text-ink-3">
                    {fmtDay(n.ts.slice(0, 10))}
                    {n.triage && n.triage !== "none" ? ` · ${n.triage}` : ""}
                  </div>
                  <div className="text-ink-2">{n.summary}</div>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function order(t: TriageLevel) {
  return ["emergency", "urgent", "soon", "self-care", "routine", "none"].indexOf(t);
}
