import { test } from "node:test";
import assert from "node:assert/strict";
import { detectRedFlags } from "../src/lib/redflags";

test("detects chest pain as emergency", () => {
  const f = detectRedFlags("I have crushing chest pain and my left arm is numb");
  assert.ok(f);
  assert.equal(f!.level, "emergency");
  assert.match(f!.title, /heart/i);
});

test("detects stroke signs", () => {
  const f = detectRedFlags("my face is drooping on one side and I have slurred speech");
  assert.equal(f?.level, "emergency");
  assert.match(f!.title, /stroke/i);
});

test("detects suicidal ideation with crisis resources", () => {
  const f = detectRedFlags("honestly I just want to die");
  assert.equal(f?.level, "emergency");
  assert.ok(f!.resources.some((r) => r.value === "988"));
});

test("infant fever is urgent", () => {
  const f = detectRedFlags("my 6 week old has a fever of 100.6");
  assert.equal(f?.level, "urgent");
});

test("ordinary complaints do not trigger", () => {
  assert.equal(detectRedFlags("I have a mild headache and feel a bit tired"), null);
  assert.equal(detectRedFlags("my knee hurts when I run"), null);
  assert.equal(detectRedFlags("what is a CT scan like"), null);
});

test("poisoning routes to poison control", () => {
  const f = detectRedFlags("my toddler swallowed bleach");
  assert.equal(f?.level, "emergency");
  assert.ok(f!.resources.some((r) => /poison/i.test(r.label)));
});
