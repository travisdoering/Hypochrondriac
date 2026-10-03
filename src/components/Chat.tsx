"use client";

import { useEffect, useRef } from "react";
import { Markdown } from "./Markdown";
import { ProviderCard } from "./ProviderCard";
import type { ChatMessage, ToolEvent } from "@/lib/store";
import { recordStore } from "@/lib/store";
import { uid } from "@/lib/record";
import type { Provider } from "@/lib/nppes";

const STARTERS = [
  { icon: "🤒", text: "I've had a sore throat and a low fever for two days. What should I do?" },
  { icon: "📸", text: "Can I show you a rash on my arm?" },
  { icon: "🧪", text: "I just got blood work back and don't understand it." },
  { icon: "😮‍💨", text: "I've been anxious and not sleeping well lately." },
  { icon: "🏃", text: "Help me build a habit I'll actually keep." },
  { icon: "🩺", text: "What kind of doctor do I need for knee pain, and who's near me?" },
  { icon: "📝", text: "Quick check-in: how am I trending this week?" },
  { icon: "🏥", text: "What's an MRI with contrast actually like?" },
];

function toolChip(t: ToolEvent): { label: string; detail?: string } | null {
  const i = t.input as Record<string, unknown>;
  switch (t.name) {
    case "set_triage":
      return { label: `Urgency: ${String(i.level).replace("-", " ")}` };
    case "log_journal_entry":
      return { label: "Logged in journal", detail: String(i.notes ?? "").slice(0, 80) };
    case "update_profile": {
      const bits: string[] = [];
      for (const k of ["conditions_add", "medications_add", "allergies_add"] as const) {
        const v = i[k] as string[] | undefined;
        if (v?.length) bits.push(`${k.replace("_add", "")}: ${v.join(", ")}`);
      }
      if (i.age != null) bits.push(`age ${i.age}`);
      if (i.postalCode || i.city) bits.push(`location ${[i.city, i.state, i.postalCode].filter(Boolean).join(" ")}`);
      return { label: "Updated profile", detail: bits.join(" · ").slice(0, 100) };
    }
    case "add_goal":
      return { label: "New goal", detail: String(i.title) };
    case "complete_goal":
      return { label: "Goal completed", detail: String(i.title) };
    case "add_care_plan_item":
      return { label: `Care plan: ${String(i.urgency).replace("-", " ")}`, detail: String(i.title) };
    case "record_lab_panel":
      return { label: `Saved ${i.kind === "imaging" ? "imaging report" : "lab results"}`, detail: `${(i.results as unknown[])?.length ?? 0} values` };
    case "find_providers":
      return { label: "Searched providers", detail: `${String(i.specialty)} near ${String(i.postal_code ?? [i.city, i.state].filter(Boolean).join(", "))}` };
    case "drug_info":
      return { label: "Checked FDA label", detail: String(i.name) };
    case "search_record":
      return { label: "Searched your record", detail: `${String(i.query)}${i.scope && i.scope !== "all" ? ` · ${String(i.scope)}` : ""}` };
    case "patient_education":
      return { label: "Pulled MedlinePlus", detail: `${String(i.codeSystem).toUpperCase()} ${String(i.code)}` };
    default:
      return null;
  }
}

export function Chat({ messages, onStarter }: { messages: ChatMessage[]; onStarter: (t: string) => void }) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    if (stickRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const addProviderToPlan = (p: Provider) => {
    recordStore.set((r) => ({
      ...r,
      carePlan: [
        ...r.carePlan,
        { id: uid(), createdAt: new Date().toISOString(), title: `Call ${p.name}${p.phone ? ` (${p.phone})` : ""}`, urgency: "soon", specialty: p.specialty, reason: "Found via provider search", done: false },
      ],
    }));
  };

  if (messages.length === 0) {
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center px-4 py-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-brand text-2xl text-brand-ink">+</div>
          <h1 className="text-2xl font-semibold tracking-tight">What&apos;s going on today?</h1>
          <p className="mt-2 text-ink-2">
            Talk, type, or show me. I&apos;ll listen, keep track, make sense of reports, and tell you straight how urgent something is and who to see.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {STARTERS.map((s) => (
            <button
              key={s.text}
              onClick={() => onStarter(s.text)}
              className="flex items-start gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left text-sm text-ink hover:border-brand hover:bg-brand-soft/40"
            >
              <span className="text-lg leading-none">{s.icon}</span>
              <span>{s.text}</span>
            </button>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-ink-3">
          Not a substitute for a clinician. In an emergency call 911. For a mental-health crisis call or text 988.
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} onScroll={onScroll} className="h-full overflow-y-auto px-3 py-4 sm:px-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} onAddProvider={addProviderToPlan} />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function MessageBubble({ m, onAddProvider }: { m: ChatMessage; onAddProvider: (p: Provider) => void }) {
  const isUser = m.role === "user";
  const providers = m.tools?.flatMap((t) => t.result?.providers ?? []) ?? [];
  const education = m.tools?.flatMap((t) => t.result?.education?.entries ?? []) ?? [];
  const drugs = (m.tools ?? []).map((t) => t.result?.drug).filter((d): d is NonNullable<typeof d> => !!d);
  const chips = (m.tools ?? []).map(toolChip).filter((c): c is { label: string; detail?: string } => !!c);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[92%] sm:max-w-[85%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1.5`}>
        {m.attachments && m.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {m.attachments.map((a) =>
              a.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={a.id} src={a.data} alt={a.name} className="max-h-48 rounded-xl border border-border object-cover" />
              ) : (
                <div key={a.id} className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-ink-2">
                  {a.kind === "pdf" ? "📄" : "📎"} {a.name}
                </div>
              ),
            )}
          </div>
        )}
        {(m.text || m.streaming) && (
          <div
            className={`rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm ${
              isUser ? "rounded-br-md bg-[var(--user-bubble)] text-ink" : "rounded-bl-md border border-border bg-[var(--assistant-bubble)] text-ink"
            }`}
          >
            {isUser ? (
              <div className="whitespace-pre-wrap">{m.text}</div>
            ) : m.text ? (
              <Markdown text={m.text} />
            ) : (
              <div className="typing py-1" aria-label="Thinking">
                <span />
                <span />
                <span />
              </div>
            )}
            {!isUser && m.streaming && m.text && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded bg-ink-3 align-middle" />}
          </div>
        )}
        {m.error && (
          <div className="rounded-xl border border-[var(--critical)]/40 bg-[var(--critical)]/10 px-3 py-2 text-xs text-ink">
            {m.error}
          </div>
        )}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2" title={c.detail}>
                <span className="text-brand">●</span> {c.label}
                {c.detail ? <span className="max-w-[180px] truncate text-ink-3">· {c.detail}</span> : null}
              </span>
            ))}
          </div>
        )}
        {providers.length > 0 && (
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
            {providers.slice(0, 8).map((p) => (
              <ProviderCard key={p.npi} p={p} onAddToPlan={onAddProvider} />
            ))}
          </div>
        )}
        {(education.length > 0 || drugs.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {education.map((e) => (
              <a key={e.url} href={e.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-ink hover:border-brand">
                <span aria-hidden>📘</span>
                <span>
                  <span className="font-semibold">{e.title}</span> <span className="text-ink-3">· MedlinePlus (NIH)</span>
                </span>
              </a>
            ))}
            {drugs.map((d) => (
              <a key={d.sourceUrl} href={d.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-ink hover:border-brand">
                <span aria-hidden>💊</span>
                <span>
                  <span className="font-semibold">{d.genericNames[0] ?? d.query}</span> <span className="text-ink-3">· FDA label{d.boxedWarning ? " · boxed warning" : ""}</span>
                </span>
              </a>
            ))}
          </div>
        )}
        <div className={`text-[10px] text-ink-3 ${isUser ? "text-right" : ""}`}>{new Date(m.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
      </div>
    </div>
  );
}
