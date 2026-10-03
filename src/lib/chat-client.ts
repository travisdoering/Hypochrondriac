"use client";

import type Anthropic from "@anthropic-ai/sdk";
import {
  type HealthRecord,
  type JournalEntry,
  type LabPanel,
  type TriageLevel,
  isoDay,
  summarizeRecordForModel,
  uid,
} from "./record";
import type {
  AddCarePlanInput,
  AddGoalInput,
  CompleteGoalInput,
  LogJournalInput,
  RecordLabPanelInput,
  SetTriageInput,
  UpdateProfileInput,
} from "./tools";
import { chatStore, prefsStore, recordStore, type Attachment, type ChatMessage, type ToolEvent } from "./store";
import { detectRedFlags } from "./redflags";

// ---- Attachment helpers ----------------------------------------------------

export function dataUrlToBase64(dataUrl: string): { mediaType: string; data: string } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error("not a base64 data URL");
  return { mediaType: m[1], data: m[2] };
}

/** Downscale an image file/blob to max 1280px JPEG and return a data URL. */
export async function compressImage(blob: Blob, max = 1280, quality = 0.82): Promise<string> {
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) {
    return await blobToDataUrl(blob);
  }
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Image types the Claude API accepts. */
const API_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * Upper bound on attachment data (base64 chars) per request. Hosted
 * serverless platforms cap request bodies at ~4.5 MB; a local or self-hosted
 * server doesn't. Override with NEXT_PUBLIC_MAX_REQUEST_MB.
 */
export function requestBudgetChars(): number {
  const env = Number(process.env.NEXT_PUBLIC_MAX_REQUEST_MB);
  const hosted = typeof location !== "undefined" && /\.(vercel|netlify)\.app$/i.test(location.hostname);
  const mb = Number.isFinite(env) && env > 0 ? env : hosted ? 4 : 24;
  return Math.floor(mb * 1024 * 1024 * 0.8); // leave room for history and the record
}

export async function fileToAttachment(file: File): Promise<Attachment> {
  const id = uid();
  const isHeic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type);
  if (file.type.startsWith("image/") || isHeic) {
    const data = await compressImage(file);
    const mediaType = /^data:([^;]+);/.exec(data)?.[1] ?? "";
    if (!API_IMAGE_TYPES.has(mediaType)) {
      throw new Error(
        `This browser can't read "${file.name}"${isHeic ? " (HEIC photo)" : ""}. Use a JPG or PNG, or take the photo with the in-app camera.`,
      );
    }
    return { id, kind: "image", name: file.name, mediaType, data, origin: "upload" };
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    const maxBytes = Math.min(20 * 1024 * 1024, Math.floor((requestBudgetChars() * 3) / 4));
    if (file.size > maxBytes) {
      throw new Error(
        `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit here is ${(maxBytes / 1024 / 1024).toFixed(1)} MB. Try a photo of the important page instead.`,
      );
    }
    const data = await blobToDataUrl(file);
    return { id, kind: "pdf", name: file.name, mediaType: "application/pdf", data, origin: "upload" };
  }
  // treat everything else as text (txt, csv, json, html, hl7...)
  if (file.size > 2 * 1024 * 1024) throw new Error("Text file is over 2 MB");
  const text = await file.text();
  return { id, kind: "text", name: file.name, mediaType: file.type || "text/plain", data: text, origin: "upload" };
}

function safeDataUrl(s: string): { mediaType: string; data: string } | null {
  try {
    return dataUrlToBase64(s);
  } catch {
    return null;
  }
}

// ---- Build API messages from display messages ------------------------------

const HISTORY_LIMIT = 40;
const IMAGE_TURNS_KEPT = 6;

export function toApiMessages(messages: ChatMessage[], budgetChars = requestBudgetChars()): Anthropic.MessageParam[] {
  const recent = messages.filter((m) => !m.error || m.text).slice(-HISTORY_LIMIT);
  // Only the most recent user turns keep their binary attachments, newest
  // first, within the request budget. Anything else becomes a short note.
  const userIdx = recent.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
  const keepBinary = new Set<string>();
  let budget = budgetChars;
  for (const i of userIdx.slice(-IMAGE_TURNS_KEPT).reverse()) {
    for (const a of recent[i].attachments ?? []) {
      if (a.kind === "text" || !a.data) continue;
      const parsed = safeDataUrl(a.data);
      if (!parsed) continue;
      if (a.kind === "image" && !API_IMAGE_TYPES.has(parsed.mediaType)) continue;
      if (parsed.data.length > budget) continue;
      budget -= parsed.data.length;
      keepBinary.add(a.id);
    }
  }

  const out: Anthropic.MessageParam[] = [];
  recent.forEach((m) => {
    if (m.role === "assistant") {
      if (m.text.trim()) out.push({ role: "assistant", content: m.text });
      return;
    }
    const blocks: Anthropic.ContentBlockParam[] = [];
    for (const a of m.attachments ?? []) {
      if (a.kind === "image") {
        if (keepBinary.has(a.id)) {
          const { mediaType, data } = dataUrlToBase64(a.data);
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data },
          });
        } else {
          blocks.push({ type: "text", text: `[image attached earlier, no longer available: ${a.name}]` });
        }
      } else if (a.kind === "pdf") {
        if (keepBinary.has(a.id)) {
          const { data } = dataUrlToBase64(a.data);
          blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data }, title: a.name });
        } else {
          blocks.push({ type: "text", text: `[PDF attached earlier, no longer available: ${a.name}]` });
        }
      } else {
        blocks.push({ type: "text", text: `<attached_file name="${a.name}">\n${a.data.slice(0, 60_000)}\n</attached_file>` });
      }
    }
    blocks.push({ type: "text", text: m.text.trim() || "(see attachment)" });
    out.push({ role: "user", content: blocks });
  });
  // API requires the first message to be from the user.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

// ---- Apply tool events to the record ---------------------------------------

export function applyTool(record: HealthRecord, ev: ToolEvent): HealthRecord {
  const now = new Date().toISOString();
  switch (ev.name) {
    case "log_journal_entry": {
      const i = ev.input as unknown as LogJournalInput;
      const entry: JournalEntry = {
        id: uid(),
        ts: now,
        source: "assistant",
        mood: i.mood,
        energy: i.energy,
        pain: i.pain,
        anxiety: i.anxiety,
        symptoms: i.symptoms ?? [],
        tags: i.tags ?? [],
        notes: i.notes,
        vitals: i.vitals && Object.keys(i.vitals).length ? i.vitals : undefined,
      };
      return { ...record, journal: [...record.journal, entry] };
    }
    case "update_profile": {
      const i = ev.input as unknown as UpdateProfileInput;
      const p = { ...record.profile };
      if (i.name) p.name = i.name;
      if (i.age != null) p.age = i.age;
      if (i.sex) p.sex = i.sex;
      if (i.heightCm != null) p.heightCm = i.heightCm;
      if (i.weightKg != null) p.weightKg = i.weightKg;
      if (i.pregnant != null) p.pregnant = i.pregnant;
      const rm = (list: string[], remove: string[]) => list.filter((x) => !remove.some((r) => x.toLowerCase().includes(r.toLowerCase())));
      const add = (list: string[], adds: string[]) => {
        const seen = new Set(list.map((x) => x.toLowerCase()));
        return [...list, ...adds.filter((a) => a && !seen.has(a.toLowerCase()))];
      };
      p.conditions = add(rm(p.conditions, i.conditions_remove ?? []), i.conditions_add ?? []);
      p.medications = add(rm(p.medications, i.medications_remove ?? []), i.medications_add ?? []);
      p.allergies = add(rm(p.allergies, i.allergies_remove ?? []), i.allergies_add ?? []);
      if (i.city || i.state || i.postalCode) {
        p.location = { ...(p.location ?? {}), ...(i.city ? { city: i.city } : {}), ...(i.state ? { state: i.state } : {}), ...(i.postalCode ? { postalCode: i.postalCode } : {}) };
      }
      return { ...record, profile: p };
    }
    case "add_goal": {
      const i = ev.input as unknown as AddGoalInput;
      if (record.goals.some((g) => g.active && g.title.toLowerCase() === i.title.toLowerCase())) return record;
      return { ...record, goals: [...record.goals, { id: uid(), title: i.title, why: i.why, cadence: i.cadence, createdAt: now, completions: [], active: true }] };
    }
    case "complete_goal": {
      const i = ev.input as unknown as CompleteGoalInput;
      const today = isoDay(new Date());
      const t = i.title.toLowerCase();
      return {
        ...record,
        goals: record.goals.map((g) => {
          if (!g.active || !(g.title.toLowerCase().includes(t) || t.includes(g.title.toLowerCase()))) return g;
          const completions = g.completions.includes(today) ? g.completions : [...g.completions, today];
          return { ...g, completions, active: g.cadence === "once" ? false : g.active };
        }),
      };
    }
    case "add_care_plan_item": {
      const i = ev.input as unknown as AddCarePlanInput;
      if (record.carePlan.some((c) => !c.done && c.title.toLowerCase() === i.title.toLowerCase())) return record;
      return { ...record, carePlan: [...record.carePlan, { id: uid(), createdAt: now, title: i.title, urgency: i.urgency, specialty: i.specialty, reason: i.reason, done: false }] };
    }
    case "record_lab_panel": {
      const i = ev.input as unknown as RecordLabPanelInput;
      const panel: LabPanel = {
        id: uid(),
        date: i.date || isoDay(new Date()),
        kind: i.kind,
        source: i.source,
        source_system: "assistant",
        summary: i.summary,
        results: i.results,
        questionsForDoctor: i.questionsForDoctor,
      };
      return { ...record, labs: [...record.labs, panel] };
    }
    case "set_triage": {
      const i = ev.input as unknown as SetTriageInput;
      // also stamp the most recent journal entry from this exchange
      const j = [...record.journal];
      const last = j[j.length - 1];
      if (last && Date.now() - new Date(last.ts).getTime() < 120_000) j[j.length - 1] = { ...last, triage: i.level };
      return { ...record, journal: j };
    }
    default:
      return record;
  }
}

// ---- Send a message & stream the reply -------------------------------------

export interface SendOptions {
  text: string;
  attachments?: Attachment[];
  extra?: string; // hidden extra system context for this turn (e.g. "user clicked Explain on panel X")
  onText?: (full: string) => void;
}

let activeAbort: AbortController | null = null;

export function stopStreaming() {
  activeAbort?.abort();
  activeAbort = null;
}

export async function sendMessage(opts: SendOptions): Promise<string> {
  const text = opts.text.trim();
  if (!text && !(opts.attachments?.length)) return "";

  // Instant keyword red-flag banner, before the model says anything.
  const flag = detectRedFlags(text);
  if (flag) {
    chatStore.set((c) => ({
      ...c,
      triage: { level: flag.level, reason: flag.title, nextStep: flag.advice, redFlags: [], ts: new Date().toISOString(), source: "keyword" },
    }));
  }

  const userMsg: ChatMessage = { id: uid(), role: "user", text, ts: new Date().toISOString(), attachments: opts.attachments };
  const asstMsg: ChatMessage = { id: uid(), role: "assistant", text: "", ts: new Date().toISOString(), tools: [], streaming: true };
  chatStore.set((c) => ({ ...c, messages: [...c.messages, userMsg, asstMsg] }));

  const apiMessages = toApiMessages([...chatStore.get().messages.slice(0, -1)]);
  const fullRecord = recordStore.get();
  const recordSummary = summarizeRecordForModel(fullRecord);
  // Full record for server-side search; trim very long report texts.
  const recordForSearch = { ...fullRecord, labs: fullRecord.labs.map((l) => (l.rawText && l.rawText.length > 6000 ? { ...l, rawText: l.rawText.slice(0, 6000) } : l)) };

  const abort = new AbortController();
  activeAbort = abort;

  // If the person is switched mid-reply, everything still arriving belongs to
  // the previous person: drop it rather than writing into the new record.
  const recordKey = recordStore.currentKey();
  const chatKey = chatStore.currentKey();
  const stillHere = () => recordStore.currentKey() === recordKey && chatStore.currentKey() === chatKey;

  const update = (patch: Partial<ChatMessage> | ((m: ChatMessage) => ChatMessage)) => {
    if (!stillHere()) return;
    chatStore.set((c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === asstMsg.id ? (typeof patch === "function" ? patch(m) : { ...m, ...patch }) : m)),
    }));
  };

  let full = "";
  let gotDone = false;
  let gotError = false;
  let httpStatus = 0;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...clientOverrideHeaders() },
      body: JSON.stringify({ messages: apiMessages, recordSummary, record: recordForSearch, extra: opts.extra }),
      signal: abort.signal,
    });
    httpStatus = res.status;
    if (!res.body) throw new Error(`The server didn't send a reply (HTTP ${res.status}).`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let lastFlush = 0;
    const flushText = (force = false) => {
      const now = performance.now();
      if (force || now - lastFlush > 40) {
        lastFlush = now;
        update({ text: full });
        opts.onText?.(full);
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!stillHere()) {
        abort.abort();
        break;
      }
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        switch (ev.t) {
          case "text":
            full += ev.d as string;
            flushText();
            break;
          case "tool": {
            if (!stillHere()) break;
            const te: ToolEvent = { name: ev.name as string, input: ev.input as Record<string, unknown>, result: ev.result as ToolEvent["result"] };
            recordStore.set((r) => applyTool(r, te));
            if (te.name === "set_triage") {
              const i = te.input as unknown as SetTriageInput;
              chatStore.set((c) => ({
                ...c,
                triage: { level: i.level, reason: i.reason, nextStep: i.next_step, redFlags: i.red_flags ?? [], ts: new Date().toISOString(), source: "model" },
              }));
            }
            update((m) => ({ ...m, tools: [...(m.tools ?? []), te] }));
            break;
          }
          case "error":
            gotError = true;
            update({ error: ev.message as string });
            break;
          case "done": {
            gotDone = true;
            if (!stillHere()) break;
            const u = ev.usage as { input: number; output: number; cacheRead: number };
            chatStore.set((c) => ({ ...c, usage: { input: c.usage.input + u.input, output: c.usage.output + u.output, cacheRead: c.usage.cacheRead + u.cacheRead, turns: c.usage.turns + 1 } }));
            break;
          }
        }
      }
    }
    flushText(true);
    if (!gotDone && !gotError && !abort.signal.aborted) {
      // Not our NDJSON (an HTML error page, a proxy timeout) or the stream was cut off.
      update({
        error:
          httpStatus >= 400
            ? httpStatus === 413
              ? "That message was too large to send (attachments are probably too big). Try a smaller file or fewer pages."
              : `The server had a problem (HTTP ${httpStatus}). Please try again.`
            : "The reply was cut off before it finished. Please try again.",
      });
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") update({ error: e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Couldn't reach the server. Check your connection and try again." });
    else if (!full) update({ error: "Stopped." });
  } finally {
    update({ streaming: false, text: full });
    if (activeAbort === abort) activeAbort = null;
  }
  return full;
}

/**
 * Stop any reply in progress and mark it stopped, synchronously, so the
 * current person's conversation is saved cleanly before switching people.
 */
export function stopForSwitch() {
  stopStreaming();
  chatStore.set((c) => ({
    ...c,
    messages: c.messages.map((m) => (m.streaming ? { ...m, streaming: false, error: m.text ? m.error : "Stopped." } : m)),
  }));
  chatStore.flush();
}

/** Headers carrying the user's own API key / model / effort choices (if any). */
export function clientOverrideHeaders(): Record<string, string> {
  const p = prefsStore.get();
  const h: Record<string, string> = {};
  if (p.apiKey) h["x-anthropic-key"] = p.apiKey;
  if (p.model) h["x-hypo-model"] = p.model;
  if (p.effort) h["x-hypo-effort"] = p.effort;
  return h;
}

export function clearConversation() {
  stopStreaming();
  chatStore.set((c) => ({ ...c, messages: [], triage: undefined }));
}

export function dismissTriage() {
  chatStore.set((c) => (c.triage ? { ...c, triage: { ...c.triage, dismissed: true } } : c));
}

export function transcriptText(limit = 30): string {
  return chatStore
    .get()
    .messages.slice(-limit)
    .map((m) => `${m.role === "user" ? "PERSON" : "ASSISTANT"}: ${m.text}${m.attachments?.length ? ` [attachments: ${m.attachments.map((a) => a.name).join(", ")}]` : ""}`)
    .join("\n\n");
}

export const TRIAGE_FROM_LEVEL: Record<TriageLevel, string> = {
  emergency: "var(--t-emergency)",
  urgent: "var(--t-urgent)",
  soon: "var(--t-soon)",
  "self-care": "var(--t-selfcare)",
  routine: "var(--t-routine)",
  none: "var(--ink-3)",
};
