import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTool, toApiMessages } from "../src/lib/chat-client";
import { EMPTY_RECORD, isoDay, type HealthRecord } from "../src/lib/record";
import type { ChatMessage } from "../src/lib/store";

const base = (): HealthRecord => structuredClone(EMPTY_RECORD);

test("log_journal_entry appends an entry with vitals", () => {
  const r = applyTool(base(), { name: "log_journal_entry", input: { notes: "tired", symptoms: ["fatigue"], tags: [], mood: 4, vitals: { sleepHours: 5 } } });
  assert.equal(r.journal.length, 1);
  assert.equal(r.journal[0].mood, 4);
  assert.equal(r.journal[0].vitals?.sleepHours, 5);
  assert.equal(r.journal[0].source, "assistant");
});

test("update_profile adds without duplicates and removes only when asked", () => {
  let r = base();
  r.profile.medications = ["Metformin 500 mg"];
  r = applyTool(r, { name: "update_profile", input: { age: 52, medications_add: ["metformin 500 mg", "lisinopril"], allergies_add: ["penicillin"], postalCode: "78701", conditions_add: [], conditions_remove: [], medications_remove: [], allergies_remove: [] } });
  assert.equal(r.profile.age, 52);
  assert.deepEqual(r.profile.medications, ["Metformin 500 mg", "lisinopril"]);
  assert.deepEqual(r.profile.allergies, ["penicillin"]);
  assert.equal(r.profile.location?.postalCode, "78701");
  r = applyTool(r, { name: "update_profile", input: { medications_remove: ["lisinopril"], medications_add: [], conditions_add: [], conditions_remove: [], allergies_add: [], allergies_remove: [] } });
  assert.deepEqual(r.profile.medications, ["Metformin 500 mg"]);
});

test("goals: add is idempotent, complete marks today, once-goals retire", () => {
  let r = base();
  r = applyTool(r, { name: "add_goal", input: { title: "Walk 10 minutes after lunch", cadence: "daily" } });
  r = applyTool(r, { name: "add_goal", input: { title: "walk 10 minutes after lunch", cadence: "daily" } });
  assert.equal(r.goals.length, 1);
  r = applyTool(r, { name: "complete_goal", input: { title: "walk 10 minutes" } });
  assert.deepEqual(r.goals[0].completions, [isoDay(new Date())]);
  r = applyTool(r, { name: "add_goal", input: { title: "Book eye exam", cadence: "once" } });
  r = applyTool(r, { name: "complete_goal", input: { title: "Book eye exam" } });
  assert.equal(r.goals.find((g) => g.title === "Book eye exam")?.active, false);
});

test("care plan items dedupe and lab panels are saved", () => {
  let r = base();
  r = applyTool(r, { name: "add_care_plan_item", input: { title: "See a dermatologist", urgency: "soon", specialty: "Dermatology" } });
  r = applyTool(r, { name: "add_care_plan_item", input: { title: "see a dermatologist", urgency: "soon" } });
  assert.equal(r.carePlan.length, 1);
  r = applyTool(r, { name: "record_lab_panel", input: { date: "2026-09-30", kind: "labs", summary: "CBC", results: [{ name: "Hemoglobin", value: 10.9, unit: "g/dL", flag: "low" }], questionsForDoctor: [] } });
  assert.equal(r.labs.length, 1);
  assert.equal(r.labs[0].results[0].flag, "low");
});

test("unknown and lookup-only tools leave the record unchanged", () => {
  const r = base();
  assert.equal(applyTool(r, { name: "find_providers", input: { specialty: "Dermatology" } }), r);
  assert.equal(applyTool(r, { name: "drug_info", input: { name: "ibuprofen" } }), r);
});

test("toApiMessages: drops leading assistant turns, keeps recent images, stubs old ones", () => {
  const img = "data:image/jpeg;base64,AAAA";
  const msgs: ChatMessage[] = [{ id: "a0", role: "assistant", text: "hi", ts: "" }];
  for (let i = 0; i < 8; i++) {
    msgs.push({ id: `u${i}`, role: "user", text: `turn ${i}`, ts: "", attachments: [{ id: `i${i}`, kind: "image", name: `p${i}.jpg`, mediaType: "image/jpeg", data: img }] });
    msgs.push({ id: `a${i + 1}`, role: "assistant", text: `ok ${i}`, ts: "" });
  }
  const api = toApiMessages(msgs);
  assert.equal(api[0].role, "user");
  const blocks = (m: (typeof api)[number]) => m.content as { type: string; text?: string }[];
  assert.equal(blocks(api[0])[0].type, "text", "oldest image replaced by a placeholder");
  assert.match(String(blocks(api[0])[0].text), /image attached earlier/);
  assert.equal(blocks(api[api.length - 2])[0].type, "image", "recent image kept");
});

test("toApiMessages: empty assistant turns (errors) are skipped so roles still alternate", () => {
  const msgs: ChatMessage[] = [
    { id: "u1", role: "user", text: "hello", ts: "" },
    { id: "a1", role: "assistant", text: "", ts: "", error: "No key" },
    { id: "u2", role: "user", text: "hello again", ts: "" },
  ];
  const api = toApiMessages(msgs);
  assert.deepEqual(
    api.map((m) => m.role),
    ["user", "user"],
  );
});
