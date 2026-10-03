import { test } from "node:test";
import assert from "node:assert/strict";
import { labIndex, searchRecord } from "../src/lib/record-search";
import { EMPTY_RECORD, summarizeRecordForModel, type HealthRecord } from "../src/lib/record";

const record: HealthRecord = {
  ...EMPTY_RECORD,
  profile: { conditions: ["hypertension"], medications: ["lisinopril 10 mg"], allergies: [] },
  journal: [
    { id: "1", ts: "2026-03-02T08:00:00Z", symptoms: ["headache"], tags: [], notes: "woke with a dull headache", vitals: { systolic: 142, diastolic: 91 } },
    { id: "2", ts: "2026-03-05T08:00:00Z", symptoms: [], tags: [], notes: "slept well", vitals: { sleepHours: 8 } },
  ],
  labs: [
    { id: "a", date: "2026-01-10", kind: "labs", source: "Quest", results: [{ name: "Potassium", value: 3.4, unit: "mmol/L", refLow: 3.5, refHigh: 5.1, flag: "low" }, { name: "Sodium", value: 140, unit: "mmol/L" }] },
    { id: "b", date: "2026-02-20", kind: "labs", source: "Quest", results: [{ name: "Potassium", value: 4.1, unit: "mmol/L", refLow: 3.5, refHigh: 5.1, flag: "normal" }] },
    { id: "c", date: "2026-02-25", kind: "imaging", source: "Chest X-ray", summary: "No acute cardiopulmonary process.", results: [], rawText: "FINDINGS: Lungs clear. Heart size normal." },
  ],
};

test("search finds every potassium result with flags", () => {
  const out = searchRecord(record, { query: "potassium", scope: "labs", limit: 25 });
  assert.match(out, /2026-01-10 \| Potassium: 3.4 mmol\/L \(ref 3.5-5.1\) \[LOW\]/);
  assert.match(out, /2026-02-20 \| Potassium: 4.1/);
  assert.doesNotMatch(out, /Sodium/);
});

test("search finds imaging report text", () => {
  const out = searchRecord(record, { query: "chest x-ray lungs", scope: "imaging", limit: 10 });
  assert.match(out, /IMAGING Chest X-ray/);
  assert.match(out, /Lungs clear/);
});

test("journal search with date range", () => {
  const out = searchRecord(record, { query: "headache", scope: "journal", from: "2026-03-01", to: "2026-03-03", limit: 10 });
  assert.match(out, /dull headache/);
  assert.match(out, /BP 142\/91/);
  const none = searchRecord(record, { query: "headache", scope: "journal", from: "2026-03-04", limit: 10 });
  assert.match(none, /No matches/);
});

test("lab index summarizes range and flags", () => {
  const idx = labIndex(record.labs);
  assert.match(idx, /Potassium: latest 4.1 mmol\/L \(2026-02-20\); 2 results, range 3.4-4.1, 1 flagged/);
});

test("record summary stays compact and includes profile", () => {
  const s = summarizeRecordForModel(record, new Date("2026-03-06T00:00:00Z"));
  assert.match(s, /CONDITIONS: hypertension/);
  assert.match(s, /MEDICATIONS: lisinopril 10 mg/);
  assert.match(s, /RECENT JOURNAL/);
  assert.ok(s.length < 6000);
});
