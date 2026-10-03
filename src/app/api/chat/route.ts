import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { crossSiteRejection } from "@/lib/proxy-guard";
import { CORE_SYSTEM, buildVolatileSystem } from "@/lib/prompts";
import { TOOLS, TOOL_SCHEMAS, type ToolName } from "@/lib/tools";
import { providersToText, searchProviders } from "@/lib/nppes";
import { drugInfoToText, lookupDrug } from "@/lib/openfda";
import { eduToText, patientEducation } from "@/lib/medlineplus";
import { searchRecord } from "@/lib/record-search";
import type { HealthRecord } from "@/lib/record";

export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = process.env.HYPO_MODEL ?? "claude-opus-5";
const EFFORT = (process.env.HYPO_EFFORT as "low" | "medium" | "high" | "xhigh" | "max" | undefined) ?? "medium";
const MAX_ITERATIONS = 6;

interface ChatBody {
  messages: Anthropic.MessageParam[];
  recordSummary: string;
  /** Full record JSON - held in memory for this request only so tools can search it. */
  record?: HealthRecord;
  extra?: string;
}

/**
 * Streams newline-delimited JSON events:
 *   {t:"text", d:string}                       - assistant text delta
 *   {t:"tool", name, input, result?}           - a validated tool call (client applies record mutations)
 *   {t:"stop", reason}                         - end of one model turn
 *   {t:"done", usage}                          - whole exchange complete
 *   {t:"error", message, code?}
 */
export async function POST(req: NextRequest) {
  if (crossSiteRejection(req)) return ndjsonError("Cross-site requests are not allowed.", "forbidden", 403);
  const userKey = req.headers.get("x-anthropic-key")?.trim() || undefined;
  if (!userKey && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return ndjsonError(
      "No Anthropic API key. Open Settings (⚙️) and paste your key, or add ANTHROPIC_API_KEY to .env.local and restart the dev server.",
      "no_api_key",
      500,
    );
  }
  const model = sanitizeModel(req.headers.get("x-hypo-model")) ?? MODEL;
  const effort = sanitizeEffort(req.headers.get("x-hypo-effort")) ?? EFFORT;

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return ndjsonError("Invalid JSON body", "bad_request", 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return ndjsonError("messages required", "bad_request", 400);
  }

  const client = new Anthropic({ maxRetries: 2, timeout: 240_000, ...(userKey ? { apiKey: userKey } : {}) });
  const messages: Anthropic.MessageParam[] = [...body.messages];
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: CORE_SYSTEM, cache_control: { type: "ephemeral" } },
    { type: "text", text: buildVolatileSystem(body.recordSummary ?? "", body.extra) },
  ];

  const encoder = new TextEncoder();
  let closed = false;
  let current: ReturnType<typeof client.messages.stream> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          closed = true;
        }
      };
      const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      // Text before and after a tool round arrives as separate turns; keep them from running together.
      let lastChar = "";
      let breakBeforeNextText = false;
      try {
        for (let iter = 0; iter < MAX_ITERATIONS && !closed; iter++) {
          const s = client.messages.stream({
            model,
            // Adaptive thinking and tool inputs (a 40-row lab panel) share this budget.
            max_tokens: 12_000,
            system,
            tools: TOOLS,
            // On the last allowed round, make the model answer in words instead of calling more tools.
            ...(iter === MAX_ITERATIONS - 1 ? { tool_choice: { type: "none" as const } } : {}),
            messages,
            thinking: { type: "adaptive" },
            output_config: { effort },
          });

          current = s;
          s.on("text", (delta) => {
            if (!delta) return;
            let d = delta;
            if (breakBeforeNextText) {
              breakBeforeNextText = false;
              if (lastChar && !/\s/.test(lastChar) && !/^\s/.test(d)) d = "\n\n" + d;
            }
            lastChar = d[d.length - 1];
            send({ t: "text", d });
          });

          const message = await s.finalMessage();
          current = null;
          usage.input += message.usage.input_tokens;
          usage.output += message.usage.output_tokens;
          usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
          usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;

          send({ t: "stop", reason: message.stop_reason });

          if (message.stop_reason === "refusal") {
            send({
              t: "text",
              d: "\n\nI'm not able to help with that specific part. If this is about your safety or someone else's, please call 911 or 988 right now.",
            });
            break;
          }
          if (message.stop_reason === "pause_turn") {
            messages.push({ role: "assistant", content: message.content });
            continue;
          }

          if (message.stop_reason === "max_tokens") {
            send({ t: "error", message: "Reply was cut off (max_tokens)." });
            break;
          }
          const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          if (message.stop_reason !== "tool_use" || toolUses.length === 0) break;

          messages.push({ role: "assistant", content: message.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            const name = tu.name as ToolName;
            const schema = TOOL_SCHEMAS[name];
            if (!schema) {
              results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Unknown tool ${tu.name}` });
              continue;
            }
            const parsed = schema.safeParse(tu.input);
            if (!parsed.success) {
              results.push({
                type: "tool_result",
                tool_use_id: tu.id,
                is_error: true,
                content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
              });
              continue;
            }
            if (name === "find_providers") {
              const q = parsed.data as import("@/lib/tools").FindProvidersInput;
              try {
                const { providers } = await searchProviders(q);
                send({ t: "tool", name, input: q, result: { providers } });
                results.push({ type: "tool_result", tool_use_id: tu.id, content: providersToText(providers) });
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                send({ t: "tool", name, input: q, result: { error: msg } });
                results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Provider search failed: ${msg}` });
              }
              continue;
            }
            if (name === "search_record") {
              const q = parsed.data as import("@/lib/tools").SearchRecordInput;
              const text = body.record ? searchRecord(body.record, q) : "The full record was not sent with this request.";
              send({ t: "tool", name, input: q, result: { matches: text.split("\n").length } });
              results.push({ type: "tool_result", tool_use_id: tu.id, content: text });
              continue;
            }
            if (name === "drug_info") {
              const q = parsed.data as import("@/lib/tools").DrugInfoInput;
              try {
                const info = await lookupDrug(q.name);
                send({ t: "tool", name, input: q, result: { drug: info } });
                results.push({ type: "tool_result", tool_use_id: tu.id, content: drugInfoToText(info, q.name) });
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                send({ t: "tool", name, input: q, result: { error: msg } });
                results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Drug lookup failed: ${msg}. Answer from general knowledge and say the label could not be fetched.` });
              }
              continue;
            }
            if (name === "patient_education") {
              const q = parsed.data as import("@/lib/tools").PatientEducationInput;
              try {
                const edu = await patientEducation(q.codeSystem, q.code, q.displayName);
                send({ t: "tool", name, input: q, result: { education: edu } });
                results.push({ type: "tool_result", tool_use_id: tu.id, content: eduToText(edu) });
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                send({ t: "tool", name, input: q, result: { error: msg } });
                results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `MedlinePlus lookup failed: ${msg}.` });
              }
              continue;
            }
            send({ t: "tool", name, input: parsed.data });
            results.push({ type: "tool_result", tool_use_id: tu.id, content: "Recorded." });
          }
          messages.push({ role: "user", content: results });
          breakBeforeNextText = true;
        }
        send({ t: "done", usage, model });
      } catch (err) {
        if (!closed) send({ t: "error", ...describeError(err) });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
    cancel() {
      // Client went away (stop button / navigation): stop paying for tokens.
      closed = true;
      try {
        current?.abort();
      } catch {
        /* ignore */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// Only models that accept adaptive thinking plus every effort level the Settings menu offers.
// (Haiku 4.5 takes neither; Sonnet 4.6 rejects "xhigh".)
const ALLOWED_MODELS = new Set(["claude-opus-5", "claude-sonnet-5", "claude-fable-5-1", "claude-opus-4-8"]);
function sanitizeModel(m: string | null): string | undefined {
  return m && ALLOWED_MODELS.has(m) ? m : undefined;
}
function sanitizeEffort(e: string | null): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  return e === "low" || e === "medium" || e === "high" || e === "xhigh" || e === "max" ? e : undefined;
}

function describeError(err: unknown): { message: string; code: string } {
  if (err instanceof Anthropic.AuthenticationError) {
    return { message: "Anthropic rejected the API key. Check the key in Settings (⚙️) or ANTHROPIC_API_KEY in .env.local.", code: "auth" };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { message: "Rate limited by the API. Give it a few seconds and try again.", code: "rate_limit" };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { message: `The API rejected the request: ${err.message}`, code: "bad_request" };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { message: "Could not reach the Anthropic API. Check your connection.", code: "connection" };
  }
  if (err instanceof Anthropic.APIError) {
    return { message: `API error ${err.status}: ${err.message}`, code: "api" };
  }
  return { message: err instanceof Error ? err.message : String(err), code: "unknown" };
}

function ndjsonError(message: string, code: string, status: number) {
  return new Response(JSON.stringify({ t: "error", message, code }) + "\n", {
    status,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
