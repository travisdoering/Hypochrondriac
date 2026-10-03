"use client";

/**
 * Tiny persistent stores (localStorage) with React 19's useSyncExternalStore.
 * One for the health record, one for the conversation. No server storage.
 */

import { useSyncExternalStore } from "react";
import { EMPTY_RECORD, type HealthRecord, type TriageLevel } from "./record";
import type { Provider } from "./nppes";
import type { DrugInfo } from "./openfda";
import type { EduResult } from "./medlineplus";

function createStore<T>(initialKey: string, initial: T, migrate?: (raw: unknown) => T) {
  let key = initialKey;
  let state: T = initial;
  let loaded = false;
  const listeners = new Set<() => void>();

  const load = () => {
    if (loaded || typeof window === "undefined") return;
    loaded = true;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = migrate ? migrate(parsed) : (parsed as T);
      }
    } catch {
      state = initial;
    }
  };

  const persist = () => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* quota or private mode - keep in memory */
    }
  };

  const get = () => {
    load();
    return state;
  };
  const set = (next: T | ((prev: T) => T)) => {
    load();
    state = typeof next === "function" ? (next as (p: T) => T)(state) : next;
    persist();
    listeners.forEach((l) => l());
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        try {
          state = migrate ? migrate(JSON.parse(e.newValue)) : (JSON.parse(e.newValue) as T);
          l();
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(l);
      window.removeEventListener("storage", onStorage);
    };
  };
  const useStore = () => useSyncExternalStore(subscribe, get, () => initial);
  /** Re-point the store at a different localStorage key (e.g. another person). */
  const rekey = (newKey: string) => {
    if (newKey === key) return;
    persist();
    key = newKey;
    loaded = false;
    state = initial;
    load();
    listeners.forEach((l) => l());
  };
  return { get, set, subscribe, useStore, rekey, currentKey: () => key };
}

// ---- Record ----------------------------------------------------------------
function migrateRecord(raw: unknown): HealthRecord {
  const r = (raw ?? {}) as Partial<HealthRecord>;
  return {
    ...EMPTY_RECORD,
    ...r,
    profile: { ...EMPTY_RECORD.profile, ...(r.profile ?? {}) },
    connections: r.connections ?? [],
    journal: r.journal ?? [],
    labs: r.labs ?? [],
    goals: r.goals ?? [],
    carePlan: r.carePlan ?? [],
    sessionNotes: r.sessionNotes ?? [],
  };
}
export const recordStore = createStore<HealthRecord>("hypo.record.v1", EMPTY_RECORD, migrateRecord);
export const useRecord = recordStore.useStore;

// ---- Conversation ----------------------------------------------------------
export interface Attachment {
  id: string;
  kind: "image" | "pdf" | "text";
  name: string;
  mediaType: string;
  /** data: URL for images/pdf; raw text for text */
  data: string;
  /** label for where it came from */
  origin?: "camera" | "live" | "upload" | "imaging" | "record";
}

export interface ToolEvent {
  name: string;
  input: Record<string, unknown>;
  result?: { providers?: Provider[]; drug?: DrugInfo | null; education?: EduResult; error?: string };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: string;
  attachments?: Attachment[];
  tools?: ToolEvent[];
  error?: string;
  streaming?: boolean;
}

export interface TriageState {
  level: TriageLevel;
  reason: string;
  nextStep?: string;
  redFlags: string[];
  ts: string;
  source: "model" | "keyword";
  dismissed?: boolean;
}

export interface ChatState {
  messages: ChatMessage[];
  triage?: TriageState;
  voiceReplies: boolean;
  handsFree: boolean;
  usage: { input: number; output: number; cacheRead: number; turns: number };
}

const EMPTY_CHAT: ChatState = {
  messages: [],
  voiceReplies: false,
  handsFree: false,
  usage: { input: 0, output: 0, cacheRead: 0, turns: 0 },
};

export const chatStore = createStore<ChatState>("hypo.chat.v1", EMPTY_CHAT, (raw) => {
  const c = (raw ?? {}) as Partial<ChatState>;
  return {
    ...EMPTY_CHAT,
    ...c,
    messages: (c.messages ?? []).map((m) => ({ ...m, streaming: false })),
    usage: { ...EMPTY_CHAT.usage, ...(c.usage ?? {}) },
  };
});
export const useChat = chatStore.useStore;

// ---- UI prefs --------------------------------------------------------------
export interface Person {
  id: string;
  name: string;
  emoji: string;
}
export interface Prefs {
  theme: "system" | "light" | "dark";
  sidebarOpen: boolean;
  sidebarTab: "today" | "journal" | "labs" | "plan" | "connections" | "visit";
  units: "us" | "metric";
  seenIntro: boolean;
  people: Person[];
  activePersonId: string;
  /** Bring-your-own key; stored locally, sent as a header per request. */
  apiKey?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}
const DEFAULT_PREFS: Prefs = {
  theme: "system",
  sidebarOpen: true,
  sidebarTab: "today",
  units: "us",
  seenIntro: false,
  people: [{ id: "me", name: "Me", emoji: "🙂" }],
  activePersonId: "me",
};
export const prefsStore = createStore<Prefs>("hypo.prefs.v1", DEFAULT_PREFS, (raw) => {
  const p = (raw ?? {}) as Partial<Prefs>;
  const people = p.people?.length ? p.people : DEFAULT_PREFS.people;
  return { ...DEFAULT_PREFS, ...p, people, activePersonId: people.some((x) => x.id === p.activePersonId) ? p.activePersonId! : people[0].id };
});
export const usePrefs = prefsStore.useStore;

// ---- People (family profiles) ---------------------------------------------
/** "me" keeps the original keys so existing data is untouched. */
function recordKeyFor(personId: string) {
  return personId === "me" ? "hypo.record.v1" : `hypo.record.${personId}`;
}
function chatKeyFor(personId: string) {
  return personId === "me" ? "hypo.chat.v1" : `hypo.chat.${personId}`;
}

export function switchPerson(id: string) {
  const prefs = prefsStore.get();
  if (!prefs.people.some((p) => p.id === id)) return;
  recordStore.rekey(recordKeyFor(id));
  chatStore.rekey(chatKeyFor(id));
  prefsStore.set((p) => ({ ...p, activePersonId: id }));
}

export function addPerson(name: string, emoji = "🙂") {
  const id = `p_${Math.random().toString(36).slice(2, 10)}`;
  prefsStore.set((p) => ({ ...p, people: [...p.people, { id, name, emoji }] }));
  switchPerson(id);
  // seed the new record's profile name
  recordStore.set((r) => ({ ...r, profile: { ...r.profile, name } }));
}

export function removePerson(id: string) {
  if (id === "me") return;
  const prefs = prefsStore.get();
  if (prefs.activePersonId === id) switchPerson("me");
  try {
    window.localStorage.removeItem(recordKeyFor(id));
    window.localStorage.removeItem(chatKeyFor(id));
  } catch {
    /* ignore */
  }
  prefsStore.set((p) => ({ ...p, people: p.people.filter((x) => x.id !== id) }));
}

/** Point the record/chat stores at the active person on first load. */
export function initActivePerson() {
  const prefs = prefsStore.get();
  recordStore.rekey(recordKeyFor(prefs.activePersonId));
  chatStore.rekey(chatKeyFor(prefs.activePersonId));
}

export function activePerson(): Person {
  const prefs = prefsStore.get();
  return prefs.people.find((p) => p.id === prefs.activePersonId) ?? prefs.people[0];
}
