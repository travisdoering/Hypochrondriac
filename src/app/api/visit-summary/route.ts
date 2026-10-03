import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { crossSiteRejection } from "@/lib/proxy-guard";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = process.env.HYPO_MODEL ?? "claude-opus-5";

export const VisitSummarySchema = z.object({
  title: z.string().describe("e.g. 'Visit prep: new headaches for 3 weeks'"),
  chiefConcern: z.string().describe("One or two sentences the person can read aloud to the receptionist or clinician"),
  history: z.string().describe("Concise narrative of the problem: onset, course, severity, what helps/hurts, associated symptoms, what has been tried"),
  relevantBackground: z.array(z.string()).describe("Conditions, meds, allergies, family history that matter for this visit"),
  keyData: z.array(z.string()).describe("Specific numbers/dates: vitals trends, lab values with dates, imaging findings"),
  questionsToAsk: z.array(z.string()).min(3).max(8),
  redFlagsToMention: z.array(z.string()).describe("Things the clinician should hear even if not asked"),
  whatToBring: z.array(z.string()),
  suggestedVisitType: z.string().describe("e.g. 'Primary care, routine appointment' or 'Urgent care today'"),
  clinicianNote: z.string().describe("A 4-8 sentence SBAR-style summary written for the clinician in clinical language"),
});

const SessionNoteSchema = z.object({
  summary: z.string().describe("2-4 sentences: what was discussed, what was concluded, what was recommended"),
  triage: z.enum(["emergency", "urgent", "soon", "self-care", "routine", "none"]),
  followUps: z.array(z.string()).describe("Concrete follow-ups the assistant should remember next time"),
});

export type VisitSummary = z.infer<typeof VisitSummarySchema>;
export type SessionNote = z.infer<typeof SessionNoteSchema>;

interface Body {
  kind: "visit" | "session";
  recordSummary: string;
  transcript?: string;
  focus?: string;
}

export async function POST(req: NextRequest) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const userKey = req.headers.get("x-anthropic-key")?.trim() || undefined;
  if (!userKey && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return NextResponse.json({ error: "No Anthropic API key. Open Settings (⚙️) and paste your key, or add ANTHROPIC_API_KEY to .env.local." }, { status: 500 });
  }
  const body = (await req.json()) as Body;
  const hdrModel = req.headers.get("x-hypo-model");
  const model = hdrModel && /^claude-[a-z0-9-]+$/.test(hdrModel) ? hdrModel : MODEL;
  const client = new Anthropic({ timeout: 110_000, ...(userKey ? { apiKey: userKey } : {}) });

  try {
    if (body.kind === "session") {
      const res = await client.messages.parse({
        model,
        max_tokens: 2000,
        thinking: { type: "adaptive" },
        output_config: { effort: "low", format: zodOutputFormat(SessionNoteSchema) },
        system:
          "You write brief, factual session notes for a health-companion app so the assistant remembers what happened. Plain language, no diagnosis claims, keep the person's own words for symptoms.",
        messages: [
          {
            role: "user",
            content: `HEALTH RECORD SUMMARY:\n${body.recordSummary}\n\nCONVERSATION TRANSCRIPT:\n${body.transcript ?? "(empty)"}\n\nWrite the session note.`,
          },
        ],
      });
      if (!res.parsed_output) return NextResponse.json({ error: "Could not parse note" }, { status: 502 });
      return NextResponse.json(res.parsed_output);
    }

    const res = await client.messages.parse({
      model,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: zodOutputFormat(VisitSummarySchema) },
      system:
        "You prepare patients for medical visits. From their health record and recent conversation, produce a crisp visit-prep sheet: what to say, what to ask, what to bring, and a clinician-facing SBAR note. Be specific with dates and numbers from the record. Do not invent data. Flag anything that should move the visit sooner.",
      messages: [
        {
          role: "user",
          content: `HEALTH RECORD SUMMARY:\n${body.recordSummary}\n\nRECENT CONVERSATION:\n${body.transcript ?? "(none)"}\n\n${body.focus ? `FOCUS OF THIS VISIT: ${body.focus}\n\n` : ""}Produce the visit prep sheet.`,
        },
      ],
    });
    if (!res.parsed_output) return NextResponse.json({ error: "Could not parse visit summary" }, { status: 502 });
    return NextResponse.json(res.parsed_output);
  } catch (err) {
    const message =
      err instanceof Anthropic.AuthenticationError
        ? "Anthropic rejected the API key."
        : err instanceof Anthropic.APIError
          ? `API error ${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
