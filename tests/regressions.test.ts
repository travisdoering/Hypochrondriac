/**
 * Regression tests for bugs found in review:
 *  - switching people must never overwrite another person's saved record
 *  - one FHIR source must not erase another's data on sync or disconnect
 *  - attachments over the request budget / unsupported image types are not sent
 *  - Bluetooth stored readings keep the device's own timestamp
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_RECORD, type HealthRecord } from "../src/lib/record";
import type { FhirImport } from "../src/lib/fhir";
import type { ChatMessage } from "../src/lib/store";

// ---- minimal browser environment for the store ------------------------------
const mem = new Map<string, string>();
const listeners = new Map<string, Set<(e: unknown) => void>>();
const fakeWindow = {
  localStorage: {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
  },
  addEventListener: (t: string, fn: (e: unknown) => void) => {
    if (!listeners.has(t)) listeners.set(t, new Set());
    listeners.get(t)!.add(fn);
  },
  removeEventListener: (t: string, fn: (e: unknown) => void) => listeners.get(t)?.delete(fn),
  dispatchEvent: () => true,
};

const meRecord: HealthRecord = { ...EMPTY_RECORD, profile: { ...EMPTY_RECORD.profile, name: "Travis", conditions: ["hypertension"] }, journal: [{ id: "j1", ts: "2026-09-01T12:00:00Z", symptoms: [], tags: [], notes: "me entry" }] };
const kidRecord: HealthRecord = { ...EMPTY_RECORD, profile: { ...EMPTY_RECORD.profile, name: "Kiddo", age: 6 } };

type StoreMod = typeof import("../src/lib/store");
let store: StoreMod;

before(async () => {
  mem.set("hypo.record.v1", JSON.stringify(meRecord));
  mem.set("hypo.record.p_kid", JSON.stringify(kidRecord));
  mem.set("hypo.prefs.v1", JSON.stringify({ people: [{ id: "me", name: "Me", emoji: "🙂" }, { id: "p_kid", name: "Kiddo", emoji: "👧" }], activePersonId: "p_kid" }));
  (globalThis as unknown as { window: unknown }).window = fakeWindow;
  store = await import("../src/lib/store");
});

test("reloading with a family member active does not wipe the main record", () => {
  // Nothing has read recordStore yet (the case that used to clobber hypo.record.v1).
  store.initActivePerson();
  assert.deepEqual(JSON.parse(mem.get("hypo.record.v1")!), meRecord, "Me's saved record untouched");
  assert.equal(store.recordStore.get().profile.name, "Kiddo");
});

test("switching back and forth keeps both records intact", () => {
  store.switchPerson("me");
  assert.equal(store.recordStore.get().profile.name, "Travis");
  assert.equal(store.recordStore.get().journal.length, 1);
  store.recordStore.set((r) => ({ ...r, profile: { ...r.profile, age: 52 } }));
  store.switchPerson("p_kid");
  assert.equal(store.recordStore.get().profile.age, 6);
  assert.equal(JSON.parse(mem.get("hypo.record.v1")!).profile.age, 52);
  assert.equal(JSON.parse(mem.get("hypo.record.p_kid")!).profile.name, "Kiddo");
});

test("a fresh store never writes defaults over saved data when re-keyed", () => {
  const before = mem.get("hypo.record.p_kid");
  store.recordStore.rekey("hypo.record.p_kid"); // no-op re-key to the same person
  assert.equal(mem.get("hypo.record.p_kid"), before);
});

// ---- FHIR: per-connection isolation ----------------------------------------
test("syncing or removing one FHIR connection leaves the others' data alone", async () => {
  const { mergeFhirImport, removeConnectionData } = await import("../src/lib/fhir");
  const connA = { id: "A", kind: "fhir" as const, label: "Portal A", baseUrl: "https://a.example/fhir" };
  const connB = { id: "B", kind: "fhir" as const, label: "Bundle B", baseUrl: "file://b.json" };
  const imp = (tag: string): FhirImport => ({
    profile: { conditions: [], medications: [], allergies: [] },
    journal: [{ id: `fhir-vitals-2026-01-0${tag === "A" ? 1 : 2}`, ts: "2026-01-01T10:00:00Z", source: "fhir", symptoms: [], tags: [], notes: `vitals ${tag}`, vitals: { systolic: 120 } }],
    labs: [{ id: `fhir-labs-${tag}`, date: "2026-01-01", kind: "labs", source_system: "fhir", results: [{ name: `Test ${tag}`, value: 1 }] }],
    counts: {},
    immunizations: [],
  });
  let r: HealthRecord = { ...EMPTY_RECORD, connections: [connA, connB], labs: [{ id: "mine", date: "2026-02-02", kind: "labs", source_system: "assistant", results: [] }] };
  r = mergeFhirImport(r, imp("A"), connA);
  r = mergeFhirImport(r, imp("B"), connB);
  assert.equal(r.labs.length, 3, "A + B + the user's own panel");
  r = mergeFhirImport(r, imp("A"), connA); // re-sync A replaces only A
  assert.equal(r.labs.filter((l) => l.connectionId === "A").length, 1);
  assert.equal(r.labs.filter((l) => l.connectionId === "B").length, 1);
  assert.equal(r.journal.length, 2);
  r = removeConnectionData(r, "A");
  assert.deepEqual(
    r.labs.map((l) => l.id).sort(),
    ["B:fhir-labs-B", "mine"],
  );
  assert.equal(r.journal.length, 1);
  assert.equal(r.connections.length, 1);
});

// ---- Request budget & media types -------------------------------------------
test("toApiMessages keeps newest attachments within budget and skips unsupported images", async () => {
  const { toApiMessages } = await import("../src/lib/chat-client");
  const pdf = (n: number) => "data:application/pdf;base64," + "P".repeat(n);
  const msgs: ChatMessage[] = [
    { id: "u1", role: "user", text: "old report", ts: "", attachments: [{ id: "p1", kind: "pdf", name: "old.pdf", mediaType: "application/pdf", data: pdf(6000) }] },
    { id: "a1", role: "assistant", text: "ok", ts: "" },
    { id: "u2", role: "user", text: "new report", ts: "", attachments: [{ id: "p2", kind: "pdf", name: "new.pdf", mediaType: "application/pdf", data: pdf(6000) }] },
    { id: "a2", role: "assistant", text: "ok", ts: "" },
    { id: "u3", role: "user", text: "photo", ts: "", attachments: [{ id: "h1", kind: "image", name: "IMG.heic", mediaType: "image/heic", data: "data:image/heic;base64,AAAA" }] },
  ];
  const api = toApiMessages(msgs, 8000); // room for one PDF only
  const kinds = api.filter((m) => m.role === "user").map((m) => (m.content as { type: string }[])[0].type);
  assert.deepEqual(kinds, ["text", "document", "text"], "older PDF and HEIC become notes; newest PDF is sent");
});

// ---- Bluetooth device timestamps --------------------------------------------
test("blood pressure readings with a stored timestamp keep that time", async () => {
  const { readingTime } = await import("../src/lib/bluetooth");
  const sf = (n: number) => [n & 0xff, (n >> 8) & 0x0f];
  // flags 0x02 = timestamp present; sys, dia, map; then 2025-12-24 07:30:15
  const bytes = [0x02, ...sf(130), ...sf(85), ...sf(100), 0xe9, 0x07, 12, 24, 7, 30, 15];
  const t = readingTime("bp", new DataView(new Uint8Array(bytes).buffer))!;
  assert.equal(t.getFullYear(), 2025);
  assert.equal(t.getMonth(), 11);
  assert.equal(t.getDate(), 24);
  assert.equal(t.getHours(), 7);
  const none = readingTime("bp", new DataView(new Uint8Array([0x00, ...sf(130), ...sf(85), ...sf(100)]).buffer));
  assert.equal(none, undefined);
});
