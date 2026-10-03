/**
 * Server-side search over the person's full record. The browser sends the
 * whole record JSON with each chat request (it is the source of truth); the
 * model calls `search_record` to look past the compact summary in the system
 * prompt - e.g. "every potassium result", "headache entries in March", "what
 * did the chest X-ray report say". Pure functions, no I/O.
 */

import { fmtNum, type HealthRecord, type JournalEntry, type LabPanel } from "./record";

export interface RecordSearchQuery {
  query: string;
  scope: "labs" | "journal" | "imaging" | "plan" | "all";
  from?: string; // YYYY-MM-DD
  to?: string;
  limit: number;
}

function inRange(dateIso: string, from?: string, to?: string): boolean {
  const d = dateIso.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function terms(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[\s,;/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !["the", "and", "for", "my", "all", "any", "of", "in", "on", "to", "a", "an", "what", "did", "was", "were", "show", "me", "results", "result", "values", "value", "entries", "entry"].includes(t));
}

function matches(hay: string, ts: string[]): number {
  const h = hay.toLowerCase();
  if (!ts.length) return 1;
  return ts.reduce((n, t) => (h.includes(t) ? n + 1 : n), 0);
}

export function searchRecord(record: HealthRecord, q: RecordSearchQuery): string {
  const ts = terms(q.query);
  const out: string[] = [];
  const limit = Math.min(Math.max(q.limit || 25, 1), 100);

  if (q.scope === "labs" || q.scope === "imaging" || q.scope === "all") {
    const panels = [...record.labs]
      .filter((p) => inRange(p.date, q.from, q.to))
      .filter((p) => (q.scope === "imaging" ? p.kind === "imaging" : q.scope === "labs" ? p.kind !== "imaging" : true))
      .sort((a, b) => b.date.localeCompare(a.date));
    const hits: string[] = [];
    for (const p of panels) {
      const panelScore = matches(`${p.source ?? ""} ${p.summary ?? ""} ${p.rawText ?? ""} ${p.kind}`, ts);
      const rows = p.results
        .map((x) => ({ x, s: matches(`${x.name} ${x.explanation ?? ""}`, ts) }))
        .filter((r) => r.s > 0 || (ts.length === 0 && true));
      if (rows.length) {
        for (const { x } of rows) {
          hits.push(
            `${p.date} | ${x.name}: ${fmtNum(x.value)}${x.unit ? " " + x.unit : ""}${x.refLow != null || x.refHigh != null ? ` (ref ${x.refLow ?? ""}-${x.refHigh ?? ""})` : x.refText ? ` (ref ${x.refText})` : ""}${x.flag && x.flag !== "normal" ? ` [${x.flag.toUpperCase()}]` : ""}${p.source ? ` - ${p.source}` : ""}`,
          );
          if (hits.length >= limit) break;
        }
      } else if (panelScore > 0 && (p.kind === "imaging" || p.results.length === 0 || ts.length)) {
        hits.push(`${p.date} | ${p.kind.toUpperCase()} ${p.source ?? ""}: ${p.summary ?? ""}${p.rawText ? `\n   REPORT TEXT: ${p.rawText.slice(0, 1500)}` : ""}`);
      }
      if (hits.length >= limit) break;
    }
    if (hits.length) out.push(`LAB/IMAGING MATCHES (${hits.length}${hits.length >= limit ? ", truncated" : ""}):\n${hits.join("\n")}`);
  }

  if (q.scope === "journal" || q.scope === "all") {
    const entries = [...record.journal]
      .filter((e) => inRange(e.ts, q.from, q.to))
      .map((e) => ({ e, s: matches(journalText(e), ts) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.e.ts.localeCompare(a.e.ts))
      .slice(0, limit);
    if (entries.length) out.push(`JOURNAL MATCHES (${entries.length}):\n${entries.map(({ e }) => `${e.ts.slice(0, 16).replace("T", " ")} | ${journalText(e)}`).join("\n")}`);
  }

  if (q.scope === "plan" || q.scope === "all") {
    const plan = record.carePlan.filter((c) => matches(`${c.title} ${c.specialty ?? ""} ${c.reason ?? ""}`, ts) > 0);
    const goals = record.goals.filter((g) => matches(`${g.title} ${g.why ?? ""}`, ts) > 0);
    const notes = record.sessionNotes.filter((n) => matches(n.summary, ts) > 0 && inRange(n.ts, q.from, q.to));
    if (plan.length) out.push(`CARE PLAN:\n${plan.map((c) => `- [${c.done ? "done" : c.urgency}] ${c.title}${c.specialty ? ` (${c.specialty})` : ""} added ${c.createdAt.slice(0, 10)}`).join("\n")}`);
    if (goals.length) out.push(`GOALS:\n${goals.map((g) => `- ${g.title} (${g.cadence}, ${g.active ? "active" : "retired"}, ${g.completions.length} completions)`).join("\n")}`);
    if (notes.length) out.push(`SESSION NOTES:\n${notes.map((n) => `- ${n.ts.slice(0, 10)}: ${n.summary}`).join("\n")}`);
  }

  if (!out.length) {
    return `No matches for "${q.query}" in ${q.scope}${q.from || q.to ? ` between ${q.from ?? "start"} and ${q.to ?? "now"}` : ""}. Record has ${record.journal.length} journal entries, ${record.labs.length} lab/imaging reports (${record.labs.reduce((n, p) => n + p.results.length, 0)} values), ${record.carePlan.length} care-plan items, ${record.goals.length} goals.`;
  }
  return out.join("\n\n");
}

function journalText(e: JournalEntry): string {
  const v = e.vitals;
  const parts: string[] = [];
  if (e.mood != null) parts.push(`mood ${e.mood}`);
  if (e.energy != null) parts.push(`energy ${e.energy}`);
  if (e.pain != null) parts.push(`pain ${e.pain}`);
  if (e.anxiety != null) parts.push(`anxiety ${e.anxiety}`);
  if (e.symptoms.length) parts.push(`symptoms: ${e.symptoms.join(", ")}`);
  if (v) {
    if (v.systolic && v.diastolic) parts.push(`BP ${v.systolic}/${v.diastolic}`);
    if (v.heartRate) parts.push(`HR ${v.heartRate}`);
    if (v.tempC) parts.push(`temp ${v.tempC}C`);
    if (v.spo2) parts.push(`SpO2 ${v.spo2}`);
    if (v.weightKg) parts.push(`weight ${v.weightKg}kg`);
    if (v.glucoseMgDl) parts.push(`glucose ${v.glucoseMgDl}`);
    if (v.sleepHours) parts.push(`sleep ${v.sleepHours}h`);
    if (v.steps) parts.push(`${v.steps} steps`);
  }
  if (e.notes) parts.push(e.notes);
  if (e.tags.length) parts.push(`#${e.tags.join(" #")}`);
  if (e.triage && e.triage !== "none") parts.push(`triage:${e.triage}`);
  return parts.join(" | ");
}

/** One line per analyte: latest value/date, range over history, count. Gives the model recall without the whole table. */
export function labIndex(labs: LabPanel[]): string {
  const m = new Map<string, { name: string; unit?: string; n: number; latest: { d: string; v: number | string; flag?: string }; min?: number; max?: number; flagged: number }>();
  for (const p of [...labs].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const x of p.results) {
      const key = x.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const cur = m.get(key) ?? { name: x.name, unit: x.unit, n: 0, latest: { d: p.date, v: x.value, flag: x.flag }, flagged: 0 };
      cur.n++;
      cur.latest = { d: p.date, v: x.value, flag: x.flag };
      if (typeof x.value === "number") {
        cur.min = cur.min == null ? x.value : Math.min(cur.min, x.value);
        cur.max = cur.max == null ? x.value : Math.max(cur.max, x.value);
      }
      if (x.flag && x.flag !== "normal") cur.flagged++;
      m.set(key, cur);
    }
  }
  if (!m.size) return "";
  const rows = [...m.values()].sort((a, b) => b.flagged - a.flagged || b.n - a.n).slice(0, 80);
  return rows
    .map(
      (r) =>
        `- ${r.name}: latest ${fmtNum(r.latest.v)}${r.unit ? " " + r.unit : ""} (${r.latest.d})${r.latest.flag && r.latest.flag !== "normal" ? ` [${r.latest.flag}]` : ""}${r.n > 1 ? `; ${r.n} results, range ${fmtNum(r.min)}-${fmtNum(r.max)}${r.flagged ? `, ${r.flagged} flagged` : ""}` : ""}`,
    )
    .join("\n");
}
