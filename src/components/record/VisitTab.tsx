"use client";

import { useState } from "react";
import { prefsStore, useRecord } from "@/lib/store";
import { summarizeRecordForModel } from "@/lib/record";
import { clientOverrideHeaders, transcriptText } from "@/lib/chat-client";
import { inputCls } from "./TodayTab";
import { copyText, printElement } from "@/lib/print";
import type { VisitSummary } from "@/app/api/visit-summary/route";

export function VisitTab() {
  const r = useRecord();
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [summary, setSummary] = useState<VisitSummary | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const s = window.localStorage.getItem(`hypo.visit.${prefsStore.get().activePersonId}`);
      return s ? (JSON.parse(s) as VisitSummary) : null;
    } catch {
      return null;
    }
  });

  const generate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/visit-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...clientOverrideHeaders() },
        body: JSON.stringify({ kind: "visit", recordSummary: summarizeRecordForModel(r), transcript: transcriptText(40), focus: focus || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSummary(data as VisitSummary);
      window.localStorage.setItem(`hypo.visit.${prefsStore.get().activePersonId}`, JSON.stringify(data));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-ink-2">
        Turn everything here into a one-page sheet to bring to your appointment: what to say in the first 30 seconds, what to ask, what to bring, plus a clinician-facing note.
      </p>
      <div className="flex gap-2">
        <input value={focus} onChange={(e) => setFocus(e.target.value)} className={inputCls} placeholder="What's the visit about? (optional)" />
        <button onClick={generate} disabled={busy} className="shrink-0 rounded-lg bg-brand px-3 py-1.5 font-semibold text-brand-ink disabled:opacity-50">
          {busy ? "Writing..." : summary ? "Regenerate" : "Prepare my visit"}
        </button>
      </div>
      {err && <div className="text-xs text-[var(--critical)]">{err}</div>}

      {summary && (
        <article id="visit-sheet" className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold leading-tight">{summary.title}</h2>
              <div className="text-xs text-ink-3">
                {r.profile.name ? `${r.profile.name} · ` : ""}
                {new Date().toLocaleDateString()} · {summary.suggestedVisitType}
              </div>
            </div>
            <div className="no-print flex shrink-0 gap-1.5">
              <button
                onClick={async () => {
                  const ok = await copyText(`${summary.title}\n\n${summary.clinicianNote}`);
                  setCopied(ok);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-surface-2"
                title="Copy the clinician note"
              >
                {copied ? "✓ Copied" : "📋 Copy note"}
              </button>
              <button
                onClick={() => {
                  const el = document.getElementById("visit-sheet");
                  if (el) printElement(el, summary.title);
                }}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-surface-2"
              >
                🖨️ Print / PDF
              </button>
            </div>
          </div>

          <Block title="Say this first">
            <p className="rounded-lg bg-brand-soft/60 p-2.5 text-[15px] text-ink">&ldquo;{summary.chiefConcern}&rdquo;</p>
          </Block>
          <Block title="The story">
            <p>{summary.history}</p>
          </Block>
          {summary.redFlagsToMention.length > 0 && (
            <Block title="Make sure they hear">
              <ul className="list-disc pl-5">
                {summary.redFlagsToMention.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </Block>
          )}
          <Block title="Key data">
            <ul className="list-disc pl-5">
              {summary.keyData.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </Block>
          <Block title="Relevant background">
            <ul className="list-disc pl-5">
              {summary.relevantBackground.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </Block>
          <Block title="Questions to ask">
            <ol className="list-decimal pl-5">
              {summary.questionsToAsk.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ol>
          </Block>
          <Block title="Bring">
            <ul className="list-disc pl-5">
              {summary.whatToBring.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </Block>
          <Block title="For the clinician (SBAR)">
            <p className="whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-2.5 font-mono text-xs leading-relaxed">{summary.clinicianNote}</p>
          </Block>
          <p className="mt-3 text-[11px] text-ink-3">Prepared with Hypochondriac from patient-entered data and connected records. Not a medical record; verify with the patient.</p>
        </article>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
      <div className="text-ink">{children}</div>
    </section>
  );
}
