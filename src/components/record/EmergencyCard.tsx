"use client";

import { useState } from "react";
import { recordStore, useRecord } from "@/lib/store";
import { inputCls, Field } from "./TodayTab";
import { printElement } from "@/lib/print";

/**
 * Wallet-sized emergency card: who you are, what you have, what you take,
 * what you're allergic to, who to call. Printable. The kind of thing an ER
 * nurse actually wants in the first 30 seconds.
 */
export function EmergencyCard() {
  const r = useRecord();
  const [open, setOpen] = useState(false);
  const p = r.profile;
  const ec = r.emergency ?? {};
  const setEc = (patch: Partial<typeof ec>) => recordStore.set((rec) => ({ ...rec, emergency: { ...(rec.emergency ?? {}), ...patch } }));

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="rounded-xl border border-dashed border-border px-3 py-2 text-left text-ink-2 hover:border-brand hover:text-ink">
        🪪 Emergency card (print for your wallet)
      </button>
    );

  return (
    <section className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Emergency card</h3>
        <div className="flex gap-2">
          <button
            onClick={() => {
              const el = document.getElementById("emergency-card");
              if (el) printElement(el, "Emergency card");
            }}
            className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2"
          >
            🖨️ Print
          </button>
          <button onClick={() => setOpen(false)} className="text-xs text-ink-3">
            close
          </button>
        </div>
      </div>
      <div className="no-print grid grid-cols-2 gap-2">
        <Field label="Emergency contact">
          <input value={ec.contactName ?? ""} onChange={(e) => setEc({ contactName: e.target.value })} className={inputCls} placeholder="Name" />
        </Field>
        <Field label="Contact phone">
          <input value={ec.contactPhone ?? ""} onChange={(e) => setEc({ contactPhone: e.target.value })} className={inputCls} placeholder="(555) 555-5555" inputMode="tel" />
        </Field>
        <Field label="Blood type">
          <select value={ec.bloodType ?? ""} onChange={(e) => setEc({ bloodType: e.target.value })} className={inputCls}>
            <option value="">unknown</option>
            {["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"].map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </Field>
        <Field label="Other (devices, DNR, implants, language)">
          <input value={ec.notes ?? ""} onChange={(e) => setEc({ notes: e.target.value })} className={inputCls} placeholder="e.g. pacemaker, insulin pump" />
        </Field>
      </div>

      <div id="emergency-card" className="mt-3 rounded-xl border-2 border-[var(--critical)] bg-white p-3 text-[12px] leading-snug text-black print:break-inside-avoid" style={{ maxWidth: 340 }}>
        <div className="flex items-center justify-between border-b border-black/20 pb-1">
          <div className="font-bold uppercase tracking-wide text-[var(--critical)]">In case of emergency</div>
          <div className="text-[10px] text-black/60">Hypochondriac</div>
        </div>
        <div className="mt-1.5 text-base font-bold">{p.name || "Name: ______________"}</div>
        <div className="text-black/80">
          {[p.age != null ? `${p.age} y` : null, p.sex && p.sex !== "prefer-not" ? p.sex : null, ec.bloodType ? `blood type ${ec.bloodType}` : null, p.pregnant ? "PREGNANT" : null].filter(Boolean).join(" · ") || "Age / sex: __________"}
        </div>
        <Row label="Allergies" items={p.allergies} empty="No known allergies" strong />
        <Row label="Conditions" items={p.conditions} empty="None listed" />
        <Row label="Medications" items={p.medications} empty="None listed" />
        {ec.notes && (
          <div className="mt-1.5">
            <span className="font-semibold">Notes:</span> {ec.notes}
          </div>
        )}
        <div className="mt-1.5 border-t border-black/20 pt-1">
          <span className="font-semibold">Emergency contact:</span> {ec.contactName || "____________"} {ec.contactPhone ? `· ${ec.contactPhone}` : "· ____________"}
        </div>
        <div className="mt-0.5 text-[10px] text-black/60">Updated {new Date().toLocaleDateString()}. Patient-entered; verify.</div>
      </div>
    </section>
  );
}

function Row({ label, items, empty, strong }: { label: string; items: string[]; empty: string; strong?: boolean }) {
  return (
    <div className="mt-1.5">
      <span className="font-semibold">{label}:</span>{" "}
      {items.length ? <span className={strong ? "font-semibold text-[var(--critical)]" : ""}>{items.join("; ")}</span> : <span className="text-black/60">{empty}</span>}
    </div>
  );
}
