import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtNum, isoDay } from "../src/lib/record";
import { serializeChat, type ChatState } from "../src/lib/store";

test("fmtNum keeps whole numbers intact and trims only decimal noise", () => {
  const cases: [number | string | undefined, string][] = [
    [100, "100"],
    [250, "250"],
    [10, "10"],
    [0, "0"],
    [150.4, "150"],
    [140.21204356972208, "140"],
    [11.015916201477847, "11"],
    [3.3026608269623567, "3.3"],
    [4.1, "4.1"],
    [3.5, "3.5"],
    [4.0001, "4"],
    [0.0512, "0.051"],
    [-2.5, "-2.5"],
    ["positive", "positive"],
    [undefined, ""],
  ];
  for (const [input, want] of cases) assert.equal(fmtNum(input), want, `fmtNum(${input})`);
});

test("isoDay uses the local calendar day", () => {
  const d = new Date(2026, 0, 5, 23, 30); // local 11:30pm
  assert.equal(isoDay(d), "2026-01-05");
});

test("serializeChat drops PDFs and big images but keeps small recent ones", () => {
  const small = "data:image/jpeg;base64," + "A".repeat(1000);
  const big = "data:image/jpeg;base64," + "B".repeat(500_000);
  const pdf = "data:application/pdf;base64," + "C".repeat(10_000);
  const chat: ChatState = {
    messages: [
      { id: "1", role: "user", text: "old", ts: "", attachments: [{ id: "a", kind: "image", name: "small.jpg", mediaType: "image/jpeg", data: small }] },
      { id: "2", role: "user", text: "big", ts: "", attachments: [{ id: "b", kind: "image", name: "big.jpg", mediaType: "image/jpeg", data: big }] },
      { id: "3", role: "user", text: "pdf", ts: "", attachments: [{ id: "c", kind: "pdf", name: "labs.pdf", mediaType: "application/pdf", data: pdf }] },
      { id: "4", role: "assistant", text: "reply", ts: "", streaming: true },
    ],
    voiceReplies: false,
    handsFree: false,
    usage: { input: 0, output: 0, cacheRead: 0, turns: 0 },
  };
  const out = JSON.parse(serializeChat(chat)) as ChatState;
  assert.equal(out.messages[0].attachments![0].data, small);
  assert.equal(out.messages[1].attachments![0].data, "", "oversized image not saved");
  assert.equal(out.messages[2].attachments![0].data, "", "pdf not saved");
  assert.equal(out.messages[2].attachments![0].name, "labs.pdf", "name kept");
  assert.equal(out.messages[3].streaming, false);
  assert.equal(chat.messages[2].attachments![0].data, pdf, "in-memory state is untouched");
});
