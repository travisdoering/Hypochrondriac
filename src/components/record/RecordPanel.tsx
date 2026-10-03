"use client";

import { prefsStore, usePrefs, useRecord, type Prefs } from "@/lib/store";
import { TodayTab } from "./TodayTab";
import { JournalTab } from "./JournalTab";
import { LabsTab } from "./LabsTab";
import { PlanTab } from "./PlanTab";
import { ConnectionsTab } from "./ConnectionsTab";
import { VisitTab } from "./VisitTab";

const TABS: { id: Prefs["sidebarTab"]; label: string; icon: string }[] = [
  { id: "today", label: "Today", icon: "☀️" },
  { id: "journal", label: "Journal", icon: "📓" },
  { id: "labs", label: "Labs & Imaging", icon: "🧪" },
  { id: "plan", label: "Plan", icon: "🎯" },
  { id: "connections", label: "Connections", icon: "🔗" },
  { id: "visit", label: "Visit prep", icon: "🗒️" },
];

export function RecordPanel({ onClose }: { onClose?: () => void }) {
  const prefs = usePrefs();
  const r = useRecord();
  const counts: Partial<Record<Prefs["sidebarTab"], number>> = {
    journal: r.journal.length,
    labs: r.labs.length,
    plan: r.carePlan.filter((c) => !c.done).length + r.goals.filter((g) => g.active).length,
    connections: r.connections.length,
  };

  return (
    <aside className="flex h-full w-full flex-col bg-surface">
      <div className="safe-top flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-sm font-semibold">Your record</div>
        {onClose && (
          <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink lg:hidden" aria-label="Close record">
            ✕
          </button>
        )}
      </div>
      <nav className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5" aria-label="Record sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => prefsStore.set((p) => ({ ...p, sidebarTab: t.id }))}
            className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ${prefs.sidebarTab === t.id ? "bg-brand-soft text-ink" : "text-ink-2 hover:bg-surface-2"}`}
            aria-current={prefs.sidebarTab === t.id ? "page" : undefined}
          >
            <span aria-hidden>{t.icon}</span>
            {t.label}
            {counts[t.id] ? <span className="rounded-full bg-surface-2 px-1.5 text-[10px] text-ink-3">{counts[t.id]}</span> : null}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto p-3">
        {prefs.sidebarTab === "today" && <TodayTab />}
        {prefs.sidebarTab === "journal" && <JournalTab />}
        {prefs.sidebarTab === "labs" && <LabsTab />}
        {prefs.sidebarTab === "plan" && <PlanTab />}
        {prefs.sidebarTab === "connections" && <ConnectionsTab />}
        {prefs.sidebarTab === "visit" && <VisitTab />}
      </div>
    </aside>
  );
}
