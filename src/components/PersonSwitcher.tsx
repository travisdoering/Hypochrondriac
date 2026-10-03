"use client";

import { useState } from "react";
import { addPerson as addPersonRaw, removePerson as removePersonRaw, switchPerson as switchPersonRaw, usePrefs } from "@/lib/store";
import { stopForSwitch } from "@/lib/chat-client";
import { stopSpeaking } from "@/lib/speech";

// Any reply in progress belongs to the current person: stop it cleanly first.
const switchPerson = (id: string) => {
  stopForSwitch();
  stopSpeaking();
  switchPersonRaw(id);
};
const addPerson = (name: string, emoji: string) => {
  stopForSwitch();
  stopSpeaking();
  addPersonRaw(name, emoji);
};
const removePerson = (id: string) => {
  stopForSwitch();
  removePersonRaw(id);
};

const EMOJIS = ["🙂", "👩", "👨", "👧", "👦", "👵", "👴", "🧑", "👶", "🐕"];

/** Switch between people (you, a child, a parent). Each has a separate record and conversation. */
export function PersonSwitcher() {
  const prefs = usePrefs();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🙂");
  const active = prefs.people.find((p) => p.id === prefs.activePersonId) ?? prefs.people[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs font-medium text-ink hover:bg-surface-2"
        title="Switch person"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span aria-hidden>{active?.emoji ?? "🙂"}</span>
        <span className="max-w-[90px] truncate">{active?.name ?? "Me"}</span>
        <span className="text-ink-3">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute left-0 z-40 mt-1 w-64 rounded-xl border border-border bg-surface p-2 text-sm shadow-xl">
            <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Whose record?</div>
            <ul className="flex flex-col">
              {prefs.people.map((p) => (
                <li key={p.id} className="group flex items-center">
                  <button
                    role="menuitem"
                    onClick={() => {
                      switchPerson(p.id);
                      setOpen(false);
                    }}
                    className={`flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2 ${p.id === prefs.activePersonId ? "bg-brand-soft" : ""}`}
                  >
                    <span aria-hidden>{p.emoji}</span>
                    <span className="flex-1 truncate">{p.name}</span>
                  </button>
                  {p.id !== "me" && (
                    <button
                      onClick={() => {
                        if (confirm(`Remove ${p.name} and delete their record from this browser?`)) removePerson(p.id);
                      }}
                      className="invisible rounded px-1.5 text-xs text-ink-3 hover:text-[var(--critical)] group-hover:visible"
                      aria-label={`Remove ${p.name}`}
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                addPerson(name.trim(), emoji);
                setName("");
                setOpen(false);
              }}
              className="mt-2 border-t border-border pt-2"
            >
              <div className="mb-1.5 flex flex-wrap gap-1">
                {EMOJIS.map((e) => (
                  <button key={e} type="button" onClick={() => setEmoji(e)} className={`rounded px-1 text-base ${emoji === e ? "bg-brand-soft" : "hover:bg-surface-2"}`} aria-label={`icon ${e}`}>
                    {e}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a family member" className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-brand" />
                <button className="rounded-lg bg-brand px-2.5 text-xs font-semibold text-brand-ink">Add</button>
              </div>
            </form>
            <p className="mt-2 px-1 text-[10px] text-ink-3">Each person gets their own record and conversation. The assistant is told who it&apos;s talking about.</p>
          </div>
        </>
      )}
    </div>
  );
}
