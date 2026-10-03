/**
 * Two browser tabs sharing localStorage, each with its own copy of the store
 * module. Guards against a tab that merely *follows* a person switch writing
 * its stale in-memory copy over newer data, or resurrecting a deleted person.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

type Listener = (e: unknown) => void;
type FakeWin = {
  localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
  addEventListener(t: string, f: Listener): void;
  removeEventListener(t: string, f: Listener): void;
  dispatchEvent(): boolean;
  fire(t: string, e: unknown): void;
};

const shared = new Map<string, string>();
const wins: FakeWin[] = [];
const g = globalThis as unknown as { window?: FakeWin; CustomEvent?: unknown };

function makeWin(): FakeWin {
  const ls: Record<string, Listener[]> = {};
  const w: FakeWin = {
    localStorage: {
      getItem: (k) => (shared.has(k) ? shared.get(k)! : null),
      setItem: (k, v) => {
        shared.set(k, v);
        wins.filter((o) => o !== w).forEach((o) => o.fire("storage", { key: k, newValue: v, storageArea: o.localStorage }));
      },
      removeItem: (k) => {
        shared.delete(k);
        wins.filter((o) => o !== w).forEach((o) => o.fire("storage", { key: k, newValue: null, storageArea: o.localStorage }));
      },
    },
    addEventListener: (t, f) => void (ls[t] ??= []).push(f),
    removeEventListener: (t, f) => void (ls[t] = (ls[t] ?? []).filter((x) => x !== f)),
    dispatchEvent: () => true,
    fire: (t, e) => as(w, () => (ls[t] ?? []).forEach((f) => f(e))),
  };
  return w;
}
function as<T>(w: FakeWin, f: () => T): T {
  const prev = g.window;
  g.window = w;
  try {
    return f();
  } finally {
    g.window = prev;
  }
}
const tick = () => new Promise((r) => setTimeout(r, 20));

type Store = typeof import("../src/lib/store");
let A: FakeWin, B: FakeWin, SA: Store, SB: Store;

before(async () => {
  g.CustomEvent = class {
    constructor(
      public type: string,
      public init: unknown,
    ) {}
  };
  A = makeWin();
  B = makeWin();
  wins.push(A, B);
  const url = pathToFileURL(path.resolve("src/lib/store.ts")).href;
  g.window = A;
  SA = (await import(`${url}?tab=A`)) as Store;
  g.window = B;
  SB = (await import(`${url}?tab=B`)) as Store;
  g.window = undefined;
  as(A, () => SA.initActivePerson());
  as(B, () => SB.initActivePerson());
  // The page always subscribes to prefs; the record panel in tab B stays closed (no record subscriber).
  as(A, () => SA.prefsStore.subscribe(() => {}));
  as(B, () => SB.prefsStore.subscribe(() => {}));
});

test("a tab following a person switch never overwrites newer data", async () => {
  as(A, () => SA.prefsStore.set((p) => ({ ...p, people: [...p.people, { id: "kid", name: "Kid", emoji: "👧" }] })));
  as(A, () => SA.recordStore.set((r) => ({ ...r, goals: [{ id: "g1", title: "walk", cadence: "daily", createdAt: "", completions: [], active: true }] })));
  assert.equal(JSON.parse(shared.get("hypo.record.v1")!).goals.length, 1);

  as(A, () => SA.switchPerson("kid"));
  await tick();
  assert.equal(as(B, () => SB.recordStore.currentKey()), "hypo.record.kid", "tab B followed the switch");
  assert.equal(JSON.parse(shared.get("hypo.record.v1")!).goals.length, 1, "Me's goal survived tab B following");

  // Tab B, now on Kid, still sees Me's latest data when switching back.
  as(B, () => SB.switchPerson("me"));
  await tick();
  assert.equal(as(B, () => SB.recordStore.get().goals.length), 1);
});

test("removing a person in one tab is not undone by another tab", async () => {
  as(A, () => SA.switchPerson("kid"));
  await tick();
  as(A, () => SA.recordStore.set((r) => ({ ...r, profile: { ...r.profile, name: "Kid" } })));
  await tick();
  as(A, () => SA.removePerson("kid"));
  await tick();
  assert.equal(shared.has("hypo.record.kid"), false, "record stays deleted");
  assert.equal(shared.has("hypo.chat.kid"), false, "chat stays deleted");
  assert.equal(as(B, () => SB.recordStore.currentKey()), "hypo.record.v1", "tab B moved back to Me");
});
