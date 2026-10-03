"use client";

import { useEffect, useState } from "react";
import { chatStore, prefsStore, usePrefs } from "@/lib/store";

/**
 * Settings: bring-your-own API key (stored only in this browser, sent as a
 * header per request so the server never needs an .env), model and effort
 * overrides, voice preferences, and the privacy explainer.
 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefs = usePrefs();
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (open) setKey(prefs.apiKey ?? "");
  }, [open, prefs.apiKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const save = () => {
    prefsStore.set((p) => ({ ...p, apiKey: key.trim() || undefined }));
    onClose();
  };

  return (
    <div className="no-print fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Settings">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-5 text-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Settings</h2>
          <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>

        <section className="mb-4">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-3">Anthropic API key</label>
          <div className="flex gap-2">
            <input
              type={show ? "text" : "password"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-ant-..."
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-xs outline-none focus:border-brand"
            />
            <button onClick={() => setShow((s) => !s)} className="rounded-lg border border-border px-2 text-xs hover:bg-surface-2" aria-label={show ? "Hide key" : "Show key"}>
              {show ? "🙈" : "👁️"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-2">
            Optional if the server has <code>ANTHROPIC_API_KEY</code> set. Otherwise paste your own key here: it stays in this browser&apos;s storage and is sent only to this app&apos;s own server with each message, which forwards it to Anthropic. Get one at{" "}
            <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer noopener" className="text-accent underline">
              console.anthropic.com
            </a>
            .
          </p>
        </section>

        <section className="mb-4 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">Model</span>
            <select value={prefs.model ?? ""} onChange={(e) => prefsStore.set((p) => ({ ...p, model: e.target.value || undefined }))} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs">
              <option value="">Server default (Opus 5)</option>
              <option value="claude-opus-5">Claude Opus 5</option>
              <option value="claude-sonnet-5">Claude Sonnet 5 (faster, cheaper)</option>
              <option value="claude-fable-5-1">Claude Fable 5.1 (most capable)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">Thinking effort</span>
            <select value={prefs.effort ?? ""} onChange={(e) => prefsStore.set((p) => ({ ...p, effort: (e.target.value || undefined) as typeof p.effort }))} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs">
              <option value="">Server default (medium)</option>
              <option value="low">Low - snappiest</option>
              <option value="medium">Medium</option>
              <option value="high">High - more careful</option>
              <option value="xhigh">Extra high</option>
            </select>
          </label>
        </section>

        <section className="mb-4">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-3">Units</label>
          <div className="flex gap-2">
            {(["us", "metric"] as const).map((u) => (
              <button key={u} onClick={() => prefsStore.set((p) => ({ ...p, units: u }))} className={`rounded-lg border px-3 py-1 text-xs ${prefs.units === u ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-2"}`}>
                {u === "us" ? "lb · in · °F" : "kg · cm · °C"}
              </button>
            ))}
          </div>
        </section>

        <section className="mb-4">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-3">This conversation</label>
          <button
            onClick={() => {
              const msgs = chatStore.get().messages;
              const md = [`# Hypochondriac conversation - ${new Date().toLocaleString()}`, "", ...msgs.map((m) => `**${m.role === "user" ? "Me" : "Hypochondriac"}** (${new Date(m.ts).toLocaleTimeString()}):\n\n${m.text}${m.attachments?.length ? `\n\n_Attachments: ${m.attachments.map((a) => a.name).join(", ")}_` : ""}\n`)].join("\n");
              const blob = new Blob([md], { type: "text/markdown" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `hypochondriac-conversation-${new Date().toISOString().slice(0, 10)}.md`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-2"
          >
            📝 Export conversation as Markdown
          </button>
        </section>

        <section className="mb-4 rounded-lg bg-surface-2 p-3 text-xs text-ink-2">
          <div className="mb-1 font-semibold text-ink">Privacy, plainly</div>
          Your record, conversations and settings live in this browser only. Messages (with the record summary and any attached images or reports) go to this app&apos;s server and on to Anthropic to generate replies. Connected portals and imaging servers are contacted through this server as a CORS proxy; their tokens are kept in this tab&apos;s session storage. Nothing is logged or stored server-side.
        </section>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-2">
            Cancel
          </button>
          <button onClick={save} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-ink">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
