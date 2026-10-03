"use client";

import { useState } from "react";
import { prefsStore, recordStore, useRecord, usePrefs } from "@/lib/store";
import { streak, type HealthRecord, type Profile, isoDay } from "@/lib/record";
import { Sparkline, type Point } from "../Sparkline";
import { bus } from "@/lib/bus";
import { DevicesPanel } from "./DevicesPanel";
import { EmergencyCard } from "./EmergencyCard";
import { MedicationsPanel } from "./MedicationsPanel";

const SEX_OPTS: { v: Profile["sex"]; l: string }[] = [
  { v: undefined, l: "—" },
  { v: "female", l: "Female" },
  { v: "male", l: "Male" },
  { v: "intersex", l: "Intersex" },
  { v: "prefer-not", l: "Prefer not to say" },
];

export function TodayTab() {
  const r = useRecord();
  const prefs = usePrefs();
  const set = (f: (r: HealthRecord) => HealthRecord) => recordStore.set(f);
  const setProfile = (patch: Partial<Profile>) => set((r) => ({ ...r, profile: { ...r.profile, ...patch } }));
  const us = prefs.units === "us";

  const vitalsSeries = (key: "systolic" | "diastolic" | "heartRate" | "weightKg" | "glucoseMgDl" | "spo2" | "tempC" | "sleepHours"): Point[] =>
    r.journal
      .filter((e) => e.vitals && e.vitals[key] != null)
      .map((e) => ({ x: new Date(e.ts).getTime(), y: e.vitals![key]! }))
      .sort((a, b) => a.x - b.x);

  const sys = vitalsSeries("systolic");
  const dia = vitalsSeries("diastolic");
  const hr = vitalsSeries("heartRate");
  const wt = vitalsSeries("weightKg").map((p) => ({ ...p, y: us ? Math.round(p.y * 2.2046 * 10) / 10 : p.y }));
  const glu = vitalsSeries("glucoseMgDl");
  const sleep = vitalsSeries("sleepHours");
  const mood = r.journal.filter((e) => e.mood != null).map((e) => ({ x: new Date(e.ts).getTime(), y: e.mood! }));

  const openPlan = r.carePlan.filter((c) => !c.done);
  const activeGoals = r.goals.filter((g) => g.active);
  const today = isoDay(new Date());

  return (
    <div className="flex flex-col gap-5 text-sm">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">About you</h3>
          <button
            onClick={() => prefsStore.set((p) => ({ ...p, units: p.units === "us" ? "metric" : "us" }))}
            className="rounded border border-border px-2 py-0.5 text-[11px] text-ink-2 hover:bg-surface-2"
            title="Toggle units"
          >
            {us ? "lb · in · °F" : "kg · cm · °C"} ⇄
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name">
            <input value={r.profile.name ?? ""} onChange={(e) => setProfile({ name: e.target.value || undefined })} className={inputCls} placeholder="optional" />
          </Field>
          <Field label="Age">
            <input type="number" value={r.profile.age ?? ""} onChange={(e) => setProfile({ age: e.target.value ? Number(e.target.value) : undefined })} className={inputCls} />
          </Field>
          <Field label="Sex">
            <select value={r.profile.sex ?? ""} onChange={(e) => setProfile({ sex: (e.target.value || undefined) as Profile["sex"] })} className={inputCls}>
              {SEX_OPTS.map((o) => (
                <option key={o.l} value={o.v ?? ""}>
                  {o.l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ZIP / location">
            <input
              value={r.profile.location?.postalCode ?? ""}
              onChange={(e) => setProfile({ location: { ...(r.profile.location ?? {}), postalCode: e.target.value || undefined } })}
              className={inputCls}
              placeholder="for finding care"
            />
          </Field>
          <Field label={us ? "Height (in)" : "Height (cm)"}>
            <input
              type="number"
              value={r.profile.heightCm ? (us ? Math.round(r.profile.heightCm / 2.54) : r.profile.heightCm) : ""}
              onChange={(e) => setProfile({ heightCm: e.target.value ? (us ? Math.round(Number(e.target.value) * 2.54) : Number(e.target.value)) : undefined })}
              className={inputCls}
            />
          </Field>
          <Field label={us ? "Weight (lb)" : "Weight (kg)"}>
            <input
              type="number"
              value={r.profile.weightKg ? (us ? Math.round(r.profile.weightKg * 2.2046) : r.profile.weightKg) : ""}
              onChange={(e) => setProfile({ weightKg: e.target.value ? (us ? Math.round((Number(e.target.value) / 2.2046) * 10) / 10 : Number(e.target.value)) : undefined })}
              className={inputCls}
            />
          </Field>
        </div>
        <label className="mt-2 flex items-center gap-2 text-ink-2">
          <input type="checkbox" checked={!!r.profile.pregnant} onChange={(e) => setProfile({ pregnant: e.target.checked || undefined })} className="h-4 w-4" />
          Pregnant or possibly pregnant
        </label>
      </section>

      <ChipList title="Conditions" items={r.profile.conditions} onChange={(v) => setProfile({ conditions: v })} placeholder="e.g. asthma, hypertension" />
      <ChipList title="Medications & supplements" items={r.profile.medications} onChange={(v) => setProfile({ medications: v })} placeholder="e.g. lisinopril 10 mg daily" />
      <ChipList title="Allergies" items={r.profile.allergies} onChange={(v) => setProfile({ allergies: v })} placeholder="e.g. penicillin (hives)" />

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Trends</h3>
        {sys.length + hr.length + wt.length + glu.length + mood.length + sleep.length === 0 ? (
          <p className="text-ink-3">Nothing tracked yet. Tell me a blood pressure, weight, how you slept, or how you feel and I&apos;ll start charting it.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {sys.length > 0 && (
              <Card title="Blood pressure" sub={`${sys.at(-1)!.y}/${dia.at(-1)?.y ?? "?"} mmHg · ${sys.length} readings`}>
                <div className="flex flex-col gap-1">
                  <Sparkline points={sys} color="var(--series-1)" refLow={90} refHigh={120} unit="" ariaLabel="systolic trend" />
                  <Sparkline points={dia} color="var(--series-3)" refLow={60} refHigh={80} unit="" height={40} ariaLabel="diastolic trend" />
                </div>
                <div className="mt-1 flex gap-3 text-[11px] text-ink-3">
                  <span>
                    <span style={{ color: "var(--series-1)" }}>●</span> systolic
                  </span>
                  <span>
                    <span style={{ color: "var(--series-3)" }}>●</span> diastolic
                  </span>
                  <span>band = normal range</span>
                </div>
              </Card>
            )}
            {hr.length > 0 && (
              <Card title="Resting heart rate" sub={`${hr.at(-1)!.y} bpm`}>
                <Sparkline points={hr} color="var(--series-2)" refLow={60} refHigh={100} />
              </Card>
            )}
            {glu.length > 0 && (
              <Card title="Glucose" sub={`${glu.at(-1)!.y} mg/dL`}>
                <Sparkline points={glu} color="var(--series-4)" refLow={70} refHigh={140} />
              </Card>
            )}
            {wt.length > 0 && (
              <Card title="Weight" sub={`${wt.at(-1)!.y} ${us ? "lb" : "kg"}`}>
                <Sparkline points={wt} color="var(--series-1)" />
              </Card>
            )}
            {sleep.length > 0 && (
              <Card title="Sleep" sub={`${sleep.at(-1)!.y} h last logged`}>
                <Sparkline points={sleep} color="var(--series-3)" refLow={7} refHigh={9} />
              </Card>
            )}
            {mood.length > 0 && (
              <Card title="Mood" sub={`${mood.at(-1)!.y}/10`}>
                <Sparkline points={mood} color="var(--series-2)" />
              </Card>
            )}
          </div>
        )}
      </section>

      {activeGoals.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Goals</h3>
          <ul className="flex flex-col gap-1.5">
            {activeGoals.map((g) => {
              const done = g.completions.includes(today);
              return (
                <li key={g.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2">
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={(e) =>
                      set((r) => ({
                        ...r,
                        goals: r.goals.map((x) => (x.id === g.id ? { ...x, completions: e.target.checked ? [...x.completions, today] : x.completions.filter((d) => d !== today) } : x)),
                      }))
                    }
                    className="h-4 w-4"
                  />
                  <span className={`flex-1 ${done ? "text-ink-3 line-through" : ""}`}>{g.title}</span>
                  <span className="text-xs text-ink-3">🔥 {streak(g)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {openPlan.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Next steps</h3>
          <ul className="flex flex-col gap-1.5">
            {openPlan.map((c) => (
              <li key={c.id} className="flex items-start gap-2 rounded-lg border border-border bg-surface px-2.5 py-2">
                <input type="checkbox" onChange={() => set((r) => ({ ...r, carePlan: r.carePlan.map((x) => (x.id === c.id ? { ...x, done: true } : x)) }))} className="mt-0.5 h-4 w-4" />
                <div className="flex-1">
                  <div>{c.title}</div>
                  <div className="text-xs text-ink-3">
                    <span className="font-semibold" style={{ color: `var(--t-${c.urgency.replace("-", "")})` }}>
                      {c.urgency.replace("-", " ")}
                    </span>
                    {c.specialty ? ` · ${c.specialty}` : ""}
                  </div>
                </div>
                {c.specialty && (
                  <button
                    onClick={() => bus.send({ text: `Find me a ${c.specialty} near ${r.profile.location?.postalCode ?? "me"} for: ${c.title}` })}
                    className="rounded border border-border px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-surface-2"
                  >
                    find
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <MedicationsPanel />
      <QuickLog />
      <DevicesPanel />
      <EmergencyCard />
    </div>
  );
}

function QuickLog() {
  const [open, setOpen] = useState(false);
  const [mood, setMood] = useState(6);
  const [energy, setEnergy] = useState(6);
  const [pain, setPain] = useState(0);
  const [anxiety, setAnxiety] = useState(2);
  const [sleep, setSleep] = useState("");
  const [bp, setBp] = useState("");
  const [notes, setNotes] = useState("");
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="rounded-xl border border-dashed border-border px-3 py-2 text-left text-ink-2 hover:border-brand hover:text-ink">
        + Quick check-in (sliders, no typing)
      </button>
    );
  const submit = () => {
    const m = /(\d{2,3})\s*\/\s*(\d{2,3})/.exec(bp);
    const parts = [`Mood ${mood}/10, energy ${energy}/10, pain ${pain}/10, anxiety ${anxiety}/10.`];
    if (sleep) parts.push(`Slept ${sleep} hours.`);
    if (m) parts.push(`Blood pressure ${m[1]}/${m[2]}.`);
    if (notes.trim()) parts.push(notes.trim());
    bus.send({ text: `Quick check-in: ${parts.join(" ")}`, extra: "The person used the quick check-in sliders. Log it as a journal entry with these exact numbers and reply with one or two warm sentences, noting any pattern against prior entries." });
    setOpen(false);
    setNotes("");
    setBp("");
    setSleep("");
  };
  return (
    <section className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Quick check-in</h3>
        <button onClick={() => setOpen(false)} className="text-xs text-ink-3">
          close
        </button>
      </div>
      <Slider label="Mood" v={mood} set={setMood} min={1} />
      <Slider label="Energy" v={energy} set={setEnergy} min={1} />
      <Slider label="Pain" v={pain} set={setPain} />
      <Slider label="Anxiety" v={anxiety} set={setAnxiety} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input value={sleep} onChange={(e) => setSleep(e.target.value)} className={inputCls} placeholder="Sleep hours" inputMode="decimal" />
        <input value={bp} onChange={(e) => setBp(e.target.value)} className={inputCls} placeholder="BP e.g. 128/82" inputMode="numeric" />
      </div>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputCls} mt-2 min-h-[56px]`} placeholder="Anything else? (symptoms, meds taken, what happened today)" />
      <button onClick={submit} className="mt-2 w-full rounded-lg bg-brand py-2 font-semibold text-brand-ink">
        Log it
      </button>
    </section>
  );
}

function Slider({ label, v, set, min = 0 }: { label: string; v: number; set: (n: number) => void; min?: number }) {
  return (
    <label className="flex items-center gap-2 py-1 text-ink-2">
      <span className="w-14">{label}</span>
      <input type="range" min={min} max={10} value={v} onChange={(e) => set(Number(e.target.value))} className="flex-1" />
      <span className="w-6 text-right font-semibold text-ink">{v}</span>
    </label>
  );
}

export const inputCls = "w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-ink-3">{label}</span>
      {children}
    </label>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-[var(--chart-surface)] p-3">
      <div className="mb-1 flex items-baseline justify-between">
        <div className="font-semibold">{title}</div>
        {sub && <div className="text-xs text-ink-3">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

export function ChipList({ title, items, onChange, placeholder }: { title: string; items: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!items.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...items, v]);
    setDraft("");
  };
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span key={it} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs">
            {it}
            <button onClick={() => onChange(items.filter((x) => x !== it))} className="text-ink-3 hover:text-ink" aria-label={`Remove ${it}`}>
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder={items.length ? "add..." : placeholder}
          className="min-w-[120px] flex-1 rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 text-xs outline-none focus:border-brand"
        />
      </div>
    </section>
  );
}
