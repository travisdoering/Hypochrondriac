#!/usr/bin/env node
/**
 * A tiny stand-in for the Anthropic Messages API, for tests and offline UI
 * work. It speaks the real wire format (SSE streaming with text, thinking and
 * tool_use blocks; JSON for non-streaming structured-output calls) so the
 * app's whole tool loop can run without an API key.
 *
 *   node scripts/mock-anthropic.mjs            # listens on :4010
 *   npm run dev:mock                           # mock + next dev wired together
 *
 * Replies are canned and keyword-driven. It is NOT a model - never use it
 * to judge the quality of health advice.
 */
import http from "node:http";
import { pathToFileURL } from "node:url";

let idSeq = 0;
const nid = (p) => `${p}_mock${Date.now().toString(36)}${(idSeq++).toString(36)}`;

/** Decide what the "model" does for a request. Returns { blocks, stop_reason }. */
export function defaultScenario(body) {
  const msgs = body.messages ?? [];
  const last = msgs[msgs.length - 1];
  const lastContent = Array.isArray(last?.content) ? last.content : [{ type: "text", text: String(last?.content ?? "") }];
  const toolResults = lastContent.filter((b) => b.type === "tool_result");

  if (toolResults.length) {
    const errors = toolResults.filter((t) => t.is_error);
    return {
      blocks: [
        { type: "thinking" },
        {
          type: "text",
          text: errors.length
            ? `One of my lookups failed (${errors.length}), so I'll go from what I know. `
            : "I've logged that and set how urgent it is. " +
              "A dull headache for three days with a reading of **142/91** is worth keeping an eye on rather than an emergency. " +
              "Recheck your blood pressure twice a day for a week, seated and rested, and book a routine visit if it stays above 130/80.",
        },
      ],
      stop_reason: "end_turn",
    };
  }

  const text = lastContent
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .toLowerCase();

  if (text.includes("headache")) {
    return {
      blocks: [
        { type: "thinking" },
        { type: "text", text: "Thanks for telling me. Let me note this down." },
        {
          type: "tool_use",
          name: "set_triage",
          input: { level: "soon", reason: "Three days of dull headache with mildly raised blood pressure.", red_flags: ["worst headache of your life", "weakness or numbness", "vision loss"], next_step: "Recheck BP twice daily; book a routine visit if it stays high." },
        },
        { type: "tool_use", name: "log_journal_entry", input: { symptoms: ["headache"], tags: ["blood pressure"], notes: "Dull headache for 3 days; BP 142/91 this morning.", pain: 3, vitals: { systolic: 142, diastolic: 91 } } },
        { type: "tool_use", name: "add_care_plan_item", input: { title: "Book a routine visit about blood pressure", urgency: "soon", specialty: "Family Medicine", reason: "Headaches with BP 142/91" } },
      ],
      stop_reason: "tool_use",
    };
  }
  if (text.includes("potassium")) {
    return { blocks: [{ type: "tool_use", name: "search_record", input: { query: "potassium", scope: "labs", limit: 10 } }], stop_reason: "tool_use" };
  }
  if (text.includes("bad tool")) {
    return { blocks: [{ type: "tool_use", name: "set_triage", input: { level: "catastrophic" } }], stop_reason: "tool_use" };
  }
  if (text.includes("i'm 52") || text.includes("i am 52")) {
    return {
      blocks: [{ type: "tool_use", name: "update_profile", input: { age: 52, medications_add: ["lisinopril 10 mg daily"], allergies_add: ["penicillin"], postalCode: "78701" } }],
      stop_reason: "tool_use",
    };
  }
  return { blocks: [{ type: "thinking" }, { type: "text", text: "I'm here. Tell me what's going on, and I'll help you sort out what it might be and what to do next." }], stop_reason: "end_turn" };
}

/** Canned structured output for messages.parse (visit prep / session notes). */
export function structuredReply(body) {
  const schema = body.output_config?.format?.schema ?? {};
  const props = schema.properties ?? {};
  if ("chiefConcern" in props) {
    return {
      title: "Visit prep: headaches and blood pressure",
      chiefConcern: "I've had a dull headache for three days and my blood pressure was 142/91.",
      history: "Dull, constant headache for three days. Home BP 142/91 on the morning of day three. No weakness, vision change or confusion.",
      relevantBackground: ["No known allergies recorded"],
      keyData: ["BP 142/91 (home cuff)"],
      questionsToAsk: ["Is my blood pressure high enough to treat?", "Could the headaches be from blood pressure?", "How often should I check it at home?"],
      redFlagsToMention: [],
      whatToBring: ["Your home BP readings", "A list of medicines and supplements"],
      suggestedVisitType: "Primary care, routine appointment",
      clinicianNote: "S: 3 days of dull headache. B: no known history. A: home BP 142/91. R: please assess for hypertension and headache etiology.",
    };
  }
  if ("followUps" in props) {
    return { summary: "Talked about a three-day headache and a home BP of 142/91. Recommended twice-daily BP checks and a routine visit.", triage: "soon", followUps: ["Ask how the week of BP readings looked"] };
  }
  return {};
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function streamReply(res, body, plan, delayMs) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "request-id": nid("req") });
  const usageIn = Math.ceil(JSON.stringify(body).length / 4);
  sse(res, "message_start", {
    type: "message_start",
    message: { id: nid("msg"), type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usageIn, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  });
  let index = 0;
  for (const b of plan.blocks) {
    if (b.type === "thinking") {
      sse(res, "content_block_start", { type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
      sse(res, "content_block_delta", { type: "content_block_delta", index, delta: { type: "signature_delta", signature: "mock-signature" } });
    } else if (b.type === "text") {
      sse(res, "content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
      const words = b.text.match(/\S+\s*/g) ?? [b.text];
      for (const w of words) {
        sse(res, "content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: w } });
        if (delayMs) await sleep(delayMs);
      }
    } else if (b.type === "tool_use") {
      sse(res, "content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: nid("toolu"), name: b.name, input: {} } });
      const json = JSON.stringify(b.input);
      for (let i = 0; i < json.length; i += 24) sse(res, "content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json.slice(i, i + 24) } });
    }
    sse(res, "content_block_stop", { type: "content_block_stop", index });
    index++;
  }
  sse(res, "message_delta", { type: "message_delta", delta: { stop_reason: plan.stop_reason, stop_sequence: null }, usage: { output_tokens: 40 + index * 10 } });
  sse(res, "message_stop", { type: "message_stop" });
  res.end();
}

/**
 * Start the mock. Options: port (0 = random), scenario(body) override,
 * delayMs between streamed words. Returns { url, requests, close }.
 */
export function startMock({ port = 4010, scenario = defaultScenario, delayMs = 0, log = false } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "mock: not found" } }));
    }
    if (!req.headers["x-api-key"] && !req.headers["authorization"]) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "mock: missing key" } }));
    }
    if (req.headers["x-api-key"] === "sk-ant-bad") {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "mock: bad json" } }));
    }
    requests.push({ headers: req.headers, body });
    if (log) console.log(`[mock] ${body.stream ? "stream" : "json"} ${body.model} msgs=${body.messages?.length}`);

    if (body.stream) return streamReply(res, body, scenario(body), delayMs);

    const out = structuredReply(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: nid("msg"),
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: JSON.stringify(out) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      }),
    );
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ url: `http://127.0.0.1:${addr.port}`, requests, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.MOCK_PORT ?? 4010);
  startMock({ port, delayMs: 25, log: true }).then(({ url }) => console.log(`[mock] Anthropic mock listening on ${url}`));
}
