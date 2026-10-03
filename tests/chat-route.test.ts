/**
 * End-to-end test of the chat API route against a local mock of the
 * Anthropic Messages API (scripts/mock-anthropic.mjs). Exercises the real
 * SDK streaming parser, the tool loop, zod validation, server-side tools,
 * error mapping and the structured-output visit summary.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startMock } from "../scripts/mock-anthropic.mjs";
import { EMPTY_RECORD, type HealthRecord } from "../src/lib/record";

type MockReq = { headers: Record<string, string>; body: { model: string; stream?: boolean; system: { text: string; cache_control?: unknown }[]; tools: unknown[]; messages: { role: string; content: unknown }[]; thinking?: unknown; output_config?: { effort?: string; format?: unknown } } };
let mock: { url: string; requests: MockReq[]; close: () => Promise<void> };
let chatPOST: (req: Request) => Promise<Response>;
let visitPOST: (req: Request) => Promise<Response>;

before(async () => {
  mock = await startMock({ port: 0 });
  process.env.ANTHROPIC_BASE_URL = mock.url;
  process.env.ANTHROPIC_API_KEY = "sk-ant-mock";
  chatPOST = (await import("../src/app/api/chat/route")).POST as unknown as typeof chatPOST;
  visitPOST = (await import("../src/app/api/visit-summary/route")).POST as unknown as typeof visitPOST;
});
after(async () => {
  await mock.close();
});

function chatRequest(text: string, opts: { headers?: Record<string, string>; record?: HealthRecord } = {}) {
  return new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    body: JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text }] }], recordSummary: "PROFILE: (nothing entered yet)", record: opts.record }),
  });
}

async function events(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

test("streams text, runs the tool loop, and feeds tool results back", async () => {
  const before = mock.requests.length;
  const res = await chatPOST(chatRequest("I have had a dull headache for three days and my BP was 142/91"));
  assert.equal(res.status, 200);
  const ev = await events(res);

  const text = ev.filter((e) => e.t === "text").map((e) => e.d).join("");
  assert.match(text, /Let me note this down\.\n\nI've logged/, "text from separate model turns is separated");
  assert.match(text, /142\/91/);

  const tools = ev.filter((e) => e.t === "tool");
  assert.deepEqual(
    tools.map((t) => t.name),
    ["set_triage", "log_journal_entry", "add_care_plan_item"],
  );
  const triage = tools[0].input as { level: string; red_flags: string[] };
  assert.equal(triage.level, "soon");
  assert.ok(triage.red_flags.length > 0);
  const journal = tools[1].input as { vitals: { systolic: number; diastolic: number }; tags: string[] };
  assert.deepEqual(journal.vitals, { systolic: 142, diastolic: 91 });

  const done = ev.find((e) => e.t === "done") as { usage: { input: number; output: number } };
  assert.ok(done && done.usage.input > 0 && done.usage.output > 0);
  assert.ok(!ev.some((e) => e.t === "error"));

  // Two model calls: the first asked for tools, the second got their results.
  const reqs = mock.requests.slice(before);
  assert.equal(reqs.length, 2);
  const first = reqs[0].body;
  assert.equal(first.model, "claude-opus-5");
  assert.deepEqual(first.thinking, { type: "adaptive" });
  assert.equal(first.output_config?.effort, "medium");
  assert.ok(first.system[0].cache_control, "core prompt is cache-marked");
  assert.equal(first.tools.length, 11);

  const second = reqs[1].body;
  const assistant = second.messages[second.messages.length - 2] as { role: string; content: { type: string; id?: string; signature?: string }[] };
  assert.equal(assistant.role, "assistant");
  assert.ok(assistant.content.some((b) => b.type === "thinking" && b.signature === "mock-signature"), "thinking block echoed back unchanged");
  const ids = assistant.content.filter((b) => b.type === "tool_use").map((b) => b.id);
  const results = (second.messages[second.messages.length - 1].content as { type: string; tool_use_id: string; is_error?: boolean }[]).filter((b) => b.type === "tool_result");
  assert.deepEqual(
    results.map((r) => r.tool_use_id),
    ids,
  );
  assert.ok(results.every((r) => !r.is_error));
});

test("invalid tool input is returned to the model as an error, not forwarded", async () => {
  const before = mock.requests.length;
  const ev = await events(await chatPOST(chatRequest("bad tool please")));
  assert.equal(ev.filter((e) => e.t === "tool").length, 0, "invalid set_triage never reaches the client");
  const second = mock.requests[before + 1].body;
  const result = (second.messages[second.messages.length - 1].content as { is_error?: boolean; content: string }[])[0];
  assert.equal(result.is_error, true);
  assert.match(result.content, /Invalid input/);
  assert.match(ev.filter((e) => e.t === "text").map((e) => e.d).join(""), /lookups failed/);
});

test("search_record runs on the server against the record sent with the request", async () => {
  const record: HealthRecord = {
    ...EMPTY_RECORD,
    labs: [{ id: "p1", date: "2026-05-01", kind: "labs", source: "Quest", results: [{ name: "Potassium", value: 3.2, unit: "mmol/L", refLow: 3.5, refHigh: 5.1, flag: "low" }] }],
  };
  const before = mock.requests.length;
  const ev = await events(await chatPOST(chatRequest("what was my potassium?", { record })));
  assert.ok(ev.some((e) => e.t === "tool" && e.name === "search_record"));
  const second = mock.requests[before + 1].body;
  const result = (second.messages[second.messages.length - 1].content as { content: string }[])[0];
  assert.match(result.content, /Potassium: 3.2 mmol\/L \(ref 3.5-5.1\) \[LOW\]/);
});

test("header overrides pick model/effort and a bad key maps to a clear auth error", async () => {
  const before = mock.requests.length;
  await events(await chatPOST(chatRequest("hello", { headers: { "x-hypo-model": "claude-sonnet-5", "x-hypo-effort": "low" } })));
  assert.equal(mock.requests[before].body.model, "claude-sonnet-5");
  assert.equal(mock.requests[before].body.output_config?.effort, "low");

  const ignored = mock.requests.length;
  await events(await chatPOST(chatRequest("hello", { headers: { "x-hypo-model": "gpt-5" } })));
  assert.equal(mock.requests[ignored].body.model, "claude-opus-5", "unknown model ids fall back to the default");

  const ev = await events(await chatPOST(chatRequest("hello", { headers: { "x-anthropic-key": "sk-ant-bad" } })));
  const err = ev.find((e) => e.t === "error") as { code: string; message: string };
  assert.equal(err.code, "auth");
  assert.match(err.message, /rejected the API key/);
});

test("cross-site browser requests are refused", async () => {
  const res = await chatPOST(chatRequest("hello", { headers: { "sec-fetch-site": "cross-site" } }));
  assert.equal(res.status, 403);
});

test("missing key with no server key gives a setup message", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const res = await chatPOST(chatRequest("hello"));
    assert.equal(res.status, 500);
    const ev = await events(res);
    assert.equal(ev[0].code, "no_api_key");
    assert.match(String(ev[0].message), /Settings/);
  } finally {
    process.env.ANTHROPIC_API_KEY = saved;
  }
});

test("visit summary and session note come back as parsed structured output", async () => {
  const mk = (kind: string) =>
    new Request("http://localhost:3000/api/visit-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, recordSummary: "PROFILE: age 52", transcript: "PERSON: headache" }),
    });
  const visit = await visitPOST(mk("visit"));
  assert.equal(visit.status, 200);
  const v = (await visit.json()) as { chiefConcern: string; questionsToAsk: string[]; clinicianNote: string };
  assert.match(v.chiefConcern, /headache/);
  assert.ok(v.questionsToAsk.length >= 3);

  const before = mock.requests.length;
  const note = await visitPOST(mk("session"));
  assert.equal(note.status, 200);
  const n = (await note.json()) as { summary: string; triage: string };
  assert.equal(n.triage, "soon");
  const sent = mock.requests[before].body;
  assert.ok(sent.output_config?.format, "structured output schema sent");
});
