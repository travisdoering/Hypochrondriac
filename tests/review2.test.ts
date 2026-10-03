/** Regression tests for the second review round. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapFhirToRecord, type FhirSummary } from "../src/lib/fhir";
import { plausibleTime } from "../src/lib/bluetooth";
import { toApiMessages } from "../src/lib/chat-client";
import type { ChatMessage } from "../src/lib/store";

test("date-only EHR vitals stay on their calendar day in any time zone", () => {
  const summary = {
    conditions: [],
    medications: [],
    allergies: [],
    reports: [],
    immunizations: [],
    observations: [
      { resourceType: "Observation", category: [{ coding: [{ code: "vital-signs" }] }], code: { coding: [{ code: "29463-7" }] }, effectiveDateTime: "2024-03-05", valueQuantity: { value: 80, unit: "kg" } },
    ],
  } as unknown as FhirSummary;
  const imp = mapFhirToRecord(summary, "Test");
  assert.equal(imp.journal.length, 1);
  assert.equal(imp.journal[0].id, "fhir-vitals-2024-03-05");
});

test("device clocks that were never set don't back-date readings", () => {
  const now = new Date("2026-10-03T12:00:00");
  assert.equal(plausibleTime(new Date("2000-01-01T08:00:00"), now), undefined, "factory-default year");
  assert.equal(plausibleTime(new Date("2026-10-05T12:00:00"), now), undefined, "days in the future");
  const yesterday = new Date("2026-10-02T07:30:00");
  assert.equal(plausibleTime(yesterday, now), yesterday, "a stored reading from yesterday keeps its time");
  assert.equal(plausibleTime(undefined, now), undefined);
});

test("a file in the current message that can't be sent is described honestly", () => {
  const msgs: ChatMessage[] = [{ id: "u1", role: "user", text: "here's my report", ts: "", attachments: [{ id: "p", kind: "pdf", name: "huge.pdf", mediaType: "application/pdf", data: "data:application/pdf;base64," + "X".repeat(5000) }] }];
  const api = toApiMessages(msgs, 1000);
  const text = (api[0].content as { type: string; text?: string }[])[0].text ?? "";
  assert.match(text, /"huge\.pdf" was attached but couldn't be sent/);
});
