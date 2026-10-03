"use client";

import { useEffect, useState } from "react";
import { TRIAGE_LABEL, type TriageLevel } from "@/lib/record";
import type { TriageState } from "@/lib/store";
import { CRISIS_RESOURCES } from "@/lib/redflags";

const COLORS: Record<TriageLevel, string> = {
  emergency: "var(--t-emergency)",
  urgent: "var(--t-urgent)",
  soon: "var(--t-soon)",
  "self-care": "var(--t-selfcare)",
  routine: "var(--t-routine)",
  none: "var(--ink-3)",
};

const ICON: Record<TriageLevel, string> = {
  emergency: "🚨",
  urgent: "⚠️",
  soon: "📅",
  "self-care": "🏠",
  routine: "✅",
  none: "",
};

export function TriageBanner({ triage, onDismiss }: { triage: TriageState; onDismiss: () => void }) {
  if (triage.dismissed || triage.level === "none") return null;
  const color = COLORS[triage.level];
  const isEmergency = triage.level === "emergency";
  const text = `${triage.reason} ${triage.nextStep ?? ""}`;
  const mental = /988|suicid|crisis|self-harm|you matter|kill (myself|themselves)/i.test(text);
  const poison = /poison|overdos|swallow|ingest|toxic/i.test(text);
  return <BannerBody triage={triage} onDismiss={onDismiss} color={color} isEmergency={isEmergency} mental={mental} poison={poison} />;
}

function BannerBody({
  triage,
  onDismiss,
  color,
  isEmergency,
  mental,
  poison,
}: {
  triage: TriageState;
  onDismiss: () => void;
  color: string;
  isEmergency: boolean;
  mental: boolean;
  poison: boolean;
}) {
  // Emergencies always show in full. Anything less starts expanded and can be
  // folded to one line so it doesn't eat a phone screen.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(false), [triage.ts]);
  if (collapsed && !isEmergency) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="no-print mx-auto flex w-full max-w-3xl items-center gap-2 rounded-xl border px-3 py-1.5 text-left text-xs shadow-sm"
        style={{ borderColor: color, background: `color-mix(in srgb, ${color} 10%, var(--surface))` }}
        aria-expanded={false}
      >
        <span aria-hidden>{ICON[triage.level]}</span>
        <span className="shrink-0 rounded-full px-1.5 py-0.5 font-semibold uppercase tracking-wide text-white" style={{ background: color }}>
          {triage.level.replace("-", " ")}
        </span>
        <span className="min-w-0 flex-1 truncate text-ink">{triage.reason}</span>
        <span className="text-ink-3">▾</span>
      </button>
    );
  }
  return (
    <div
      role={isEmergency ? "alert" : "status"}
      className="no-print mx-auto w-full max-w-3xl rounded-xl border px-4 py-3 text-sm shadow-sm"
      style={{ borderColor: color, background: `color-mix(in srgb, ${color} 10%, var(--surface))` }}
    >
      <div className="flex items-start gap-3">
        <div className="text-xl leading-none" aria-hidden>
          {ICON[triage.level]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide" style={{ background: color, color: "#fff" }}>
              {triage.level.replace("-", " ")}
            </span>
            <span className="font-semibold">{TRIAGE_LABEL[triage.level]}</span>
            {triage.source === "keyword" && <span className="text-xs text-ink-3">(instant check - the assistant will confirm)</span>}
          </div>
          <p className="mt-1 text-ink">{triage.reason}</p>
          {triage.nextStep && <p className="mt-1 text-ink-2">{triage.nextStep}</p>}
          {triage.redFlags.length > 0 && (
            <p className="mt-1 text-xs text-ink-2">
              <span className="font-semibold">Go now if:</span> {triage.redFlags.join("; ")}
            </p>
          )}
          {isEmergency && (
            <div className="mt-2 flex flex-wrap gap-2">
              <a href="tel:911" className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white" style={{ background: color }}>
                Call 911
              </a>
              {mental &&
                CRISIS_RESOURCES.slice(0, 2).map((r) => (
                  <a key={r.label} href={r.href} className="rounded-lg border px-3 py-1.5 text-sm font-semibold" style={{ borderColor: color, color }}>
                    {r.label}: {r.value}
                  </a>
                ))}
              {poison && (
                <a href="tel:18002221222" className="rounded-lg border px-3 py-1.5 text-sm font-semibold" style={{ borderColor: color, color }}>
                  Poison Control 1-800-222-1222
                </a>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-center">
          <button onClick={onDismiss} className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Dismiss">
            ×
          </button>
          {!isEmergency && (
            <button onClick={() => setCollapsed(true)} className="rounded p-1 text-xs text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Fold banner" aria-expanded={true}>
              ▴
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
