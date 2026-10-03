import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseCsvVitals } from "../src/lib/csv";

test("parses quoted csv with embedded commas and newlines", () => {
  const rows = parseCsv('a,b\n"x, y","line1\nline2"\n');
  assert.deepEqual(rows, [
    ["a", "b"],
    ["x, y", "line1\nline2"],
  ]);
});

test("imports Omron-style blood pressure export", () => {
  const csv = "Date,Time,Systolic (mmHg),Diastolic (mmHg),Pulse (bpm),Notes\n2026-09-01,07:30,128,82,66,after coffee\n2026-09-02,07:15,122,79,64,\n";
  const r = parseCsvVitals(csv, "omron.csv");
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries[0].vitals?.systolic, 128);
  assert.equal(r.entries[0].vitals?.diastolic, 82);
  assert.equal(r.entries[0].vitals?.heartRate, 66);
  assert.equal(r.entries[0].notes, "after coffee");
  assert.equal(r.skipped, 0);
});

test("converts glucose mmol/L and weight lb, handles BP in one column", () => {
  const csv = "timestamp;Blood Pressure;Glucose (mmol/L);Weight (lb)\n2026-09-01T08:00:00Z;130/85;5.5;180\n";
  const r = parseCsvVitals(csv);
  assert.equal(r.entries.length, 1);
  const v = r.entries[0].vitals!;
  assert.equal(v.systolic, 130);
  assert.equal(v.diastolic, 85);
  assert.equal(v.glucoseMgDl, 99);
  assert.equal(v.weightKg, 81.6);
});

test("skips rows without a parsable date", () => {
  const csv = "Date,Systolic,Diastolic\nnot a date,120,80\n2026-01-05,118,76\n";
  const r = parseCsvVitals(csv);
  assert.equal(r.entries.length, 1);
  assert.equal(r.skipped, 1);
});
