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

export const STORAGE_ERROR_EVENT = "hypo:storage-error";

interface StoreOptions<T> {
  migrate?: (raw: unknown) => T;
  /** Resolve the storage key lazily on first load (e.g. from the active person). */
  resolveKey?: () => string;
  /** Custom serialization (e.g. to drop bulky data before writing). */
  serialize?: (state: T) => string;
  /** Batch writes; useful for state that changes many times a second while streaming. */
  persistDelayMs?: number;
}

function createStore<T>(defaultKey: string, initial: T, opts: StoreOptions<T> = {}) {
  let key = defaultKey;
  let keyResolved = !opts.resolveKey;
  let state: T = initial;
  let loaded = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const load = () => {
    if (loaded || typeof window === "undefined") return;
    if (!keyResolved) {
      keyResolved = true;
      try {
        key = opts.resolveKey!();
      } catch {
        /* keep default */
      }
    }
    loaded = true;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = opts.migrate ? opts.migrate(parsed) : (parsed as T);
      }
    } catch {
      state = initial;
    }
  };

  /** Write now. Never writes a store that hasn't been loaded (that would clobber real data with defaults). */
  const writeNow = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!loaded || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, opts.serialize ? opts.serialize(state) : JSON.stringify(state));
    } catch (e) {
      // Quota exceeded or private mode: keep working in memory, tell the UI once per write.
      window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: { key, message: e instanceof Error ? e.message : String(e) } }));
    }
  };
  const persist = () => {
    if (!opts.persistDelayMs) return writeNow();
    if (timer) return;
    timer = setTimeout(writeNow, opts.persistDelayMs);
  };
  /**
   * Write only if this tab has an unsaved (debounced) change. Everything else
   * is already on disk, and writing the in-memory copy could overwrite newer
   * data from another tab, or bring back a person another tab just deleted.
   */
  const flushPending = () => {
    if (timer) writeNow();
  };
  if (typeof window !== "undefined") {
    if (opts.persistDelayMs) window.addEventListener("pagehide", flushPending);
    // One listener per store (not per subscriber), so the in-memory copy stays
    // current with other tabs even while no component is showing it.
    window.addEventListener("storage", (e: StorageEvent) => {
      if (e.storageArea && e.storageArea !== window.localStorage) return;
      if (!loaded || e.key !== key) return;
      try {
        state = e.newValue == null ? initial : opts.migrate ? opts.migrate(JSON.parse(e.newValue)) : (JSON.parse(e.newValue) as T);
      } catch {
        return;
      }
      listeners.forEach((l) => l());
    });
  }

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
    return () => {
      listeners.delete(l);
    };
  };
  const useStore = () => useSyncExternalStore(subscribe, get, () => initial);
  /** Re-point the store at a different localStorage key (e.g. another person). */
  const rekey = (newKey: string) => {
    load(); // make sure the current key is resolved and loaded before comparing/flushing
    if (newKey === key) return;
    flushPending(); // save this tab's unsaved change to the old key; never rewrite already-saved data
    key = newKey;
    loaded = false;
    state = initial;
    load();
    listeners.forEach((l) => l());
  };
  return { get, set, subscribe, useStore, rekey, flush: flushPending, currentKey: () => (load(), key) };
}

// ---- Record ----------------------------------------------------------------
export function migrateRecord(raw: unknown): HealthRecord {
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
export const recordStore = createStore<HealthRecord>("hypo.record.v1", EMPTY_RECORD, {
  migrate: migrateRecord,
  resolveKey: () => recordKeyFor(prefsStore.get().activePersonId),
});
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

/**
 * localStorage holds ~5 MB per site, so saved conversations keep only small,
 * recent images (newest first, within a budget) and short text files. PDFs
 * and big images stay in memory for the current session and are replaced by
 * their name afterwards. The record itself is never trimmed.
 */
const SAVED_IMAGE_MAX = 400_000; // chars of base64 per image
const SAVED_ATTACHMENT_BUDGET = 1_500_000; // chars across the whole conversation
const SAVED_TEXT_MAX = 20_000;
export function serializeChat(c: ChatState): string {
  let budget = SAVED_ATTACHMENT_BUDGET;
  const slimmed = [...c.messages].reverse().map((m) => {
    if (!m.attachments?.length) return { ...m, streaming: false };
    return {
      ...m,
      streaming: false,
      attachments: m.attachments.map((a) => {
        if (a.kind === "text") return a.data.length > SAVED_TEXT_MAX ? { ...a, data: a.data.slice(0, SAVED_TEXT_MAX) } : a;
        if (a.kind === "image" && a.data.length <= SAVED_IMAGE_MAX && a.data.length <= budget) {
          budget -= a.data.length;
          return a;
        }
        return { ...a, data: "" };
      }),
    };
  });
  return JSON.stringify({ ...c, messages: slimmed.reverse() });
}

export const chatStore = createStore<ChatState>("hypo.chat.v1", EMPTY_CHAT, {
  migrate: (raw) => {
    const c = (raw ?? {}) as Partial<ChatState>;
    return {
      ...EMPTY_CHAT,
      ...c,
      messages: (c.messages ?? []).map((m) => ({ ...m, streaming: false })),
      usage: { ...EMPTY_CHAT.usage, ...(c.usage ?? {}) },
    };
  },
  resolveKey: () => chatKeyFor(prefsStore.get().activePersonId),
  serialize: serializeChat,
  persistDelayMs: 400,
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
export const prefsStore = createStore<Prefs>("hypo.prefs.v1", DEFAULT_PREFS, {
  migrate: (raw) => {
    const p = (raw ?? {}) as Partial<Prefs>;
    const people = p.people?.length ? p.people : DEFAULT_PREFS.people;
    return { ...DEFAULT_PREFS, ...p, people, activePersonId: people.some((x) => x.id === p.activePersonId) ? p.activePersonId! : people[0].id };
  },
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

/**
 * Apply a change to a saved record that is NOT the one currently loaded
 * (e.g. a session note finishing after the person was switched). Writes
 * straight to storage; if it is in fact the loaded record, goes through the store.
 */
export function updateSavedRecord(key: string, fn: (r: HealthRecord) => HealthRecord) {
  if (recordStore.currentKey() === key) return recordStore.set(fn);
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return; // person was removed meanwhile
    window.localStorage.setItem(key, JSON.stringify(fn(migrateRecord(JSON.parse(raw)))));
  } catch (e) {
    window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: { key, message: e instanceof Error ? e.message : String(e) } }));
  }
}

/**
 * Point the record/chat stores at the active person, and follow person
 * switches made in other tabs so a tab never shows one person's name over
 * another person's data.
 */
let crossTabWired = false;
export function initActivePerson() {
  const sync = () => {
    const id = prefsStore.get().activePersonId;
    recordStore.rekey(recordKeyFor(id));
    chatStore.rekey(chatKeyFor(id));
  };
  sync();
  if (crossTabWired || typeof window === "undefined") return;
  crossTabWired = true;
  window.addEventListener("storage", (e) => {
    if (e.key !== "hypo.prefs.v1" || !e.newValue) return;
    // prefsStore's own storage listener (the page always subscribes) applies the
    // new prefs; defer so it has run, then follow the active person. No writes here.
    setTimeout(sync, 0);
  });
}

export function activePerson(): Person {
  const prefs = prefsStore.get();
  return prefs.people.find((p) => p.id === prefs.activePersonId) ?? prefs.people[0];
}
