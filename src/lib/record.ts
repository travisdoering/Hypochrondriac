/**
 * The shared health record. Every mode (Journal, Coach, Diagnostician,
 * Therapist, Labs & Imaging, Find Care) reads from and writes to this one
 * structure. It lives in the browser (localStorage) - nothing is stored on
 * a server.
 */

/** Where a piece of data came from. */
export type Source = "user" | "assistant" | "fhir" | "dicom" | "import";

export type TriageLevel =
  | "emergency" // call 911 / go to ER now
  | "urgent" // urgent care or same-day appointment
  | "soon" // see a clinician within days to a couple of weeks
  | "self-care" // monitor at home, reasonable self-care
  | "routine" // preventive / no action needed
  | "none";

export interface Profile {
  name?: string;
  age?: number;
  sex?: "female" | "male" | "intersex" | "prefer-not";
  heightCm?: number;
  weightKg?: number;
  conditions: string[];
  medications: string[];
  allergies: string[];
  pregnant?: boolean;
  location?: { city?: string; state?: string; postalCode?: string };
}

export interface Vitals {
  systolic?: number;
  diastolic?: number;
  heartRate?: number;
  tempC?: number;
  spo2?: number;
  weightKg?: number;
  glucoseMgDl?: number;
  sleepHours?: number;
  steps?: number;
}

export interface JournalEntry {
  id: string;
  ts: string; // ISO
  source?: Source;
  mood?: number; // 1-10
  energy?: number; // 1-10
  pain?: number; // 0-10
  anxiety?: number; // 0-10
  symptoms: string[];
  tags: string[];
  notes: string;
  vitals?: Vitals;
  triage?: TriageLevel;
}

export interface LabResult {
  name: string;
  value: number | string;
  unit?: string;
  refLow?: number;
  refHigh?: number;
  refText?: string;
  flag?: "low" | "high" | "critical-low" | "critical-high" | "abnormal" | "normal";
  explanation?: string;
}

export interface LabPanel {
  id: string;
  date: string; // ISO date
  source?: string; // lab name / uploaded file name
  kind: "labs" | "imaging" | "other";
  source_system?: Source;
  summary?: string;
  /** For imaging pulled over DICOMweb: study UID + rendered thumbnails. */
  imaging?: { studyUid: string; modality?: string; description?: string; seriesCount?: number; instanceCount?: number; server?: string };
  results: LabResult[];
  rawText?: string;
  questionsForDoctor?: string[];
}

export interface Goal {
  id: string;
  title: string;
  why?: string;
  cadence: "daily" | "weekly" | "once";
  createdAt: string;
  completions: string[]; // ISO dates (YYYY-MM-DD)
  active: boolean;
}

export interface CarePlanItem {
  id: string;
  createdAt: string;
  title: string; // e.g. "See a dermatologist about the mole"
  urgency: TriageLevel;
  specialty?: string;
  reason?: string;
  done: boolean;
}

export interface SessionNote {
  id: string;
  ts: string;
  summary: string; // short summary of a conversation, written by the assistant
  triage?: TriageLevel;
}

export interface Connection {
  id: string;
  kind: "fhir" | "dicomweb";
  label: string;
  baseUrl: string;
  patientId?: string;
  lastSync?: string;
  /** Access token kept only in memory/sessionStorage, never here. */
  authMode?: "none" | "bearer" | "smart";
  clientId?: string;
  scope?: string;
  counts?: Record<string, number>;
}

export interface EmergencyInfo {
  contactName?: string;
  contactPhone?: string;
  bloodType?: string;
  notes?: string;
}

export interface HealthRecord {
  version: 1;
  profile: Profile;
  emergency?: EmergencyInfo;
  /** med name -> scheduled slots (morning/midday/evening/bedtime) */
  medSchedule?: Record<string, string[]>;
  /** YYYY-MM-DD -> med name -> slots taken */
  medLog?: Record<string, Record<string, string[]>>;
  connections: Connection[];
  journal: JournalEntry[];
  labs: LabPanel[];
  goals: Goal[];
  carePlan: CarePlanItem[];
  sessionNotes: SessionNote[];
}

export const EMPTY_RECORD: HealthRecord = {
  version: 1,
  profile: { conditions: [], medications: [], allergies: [] },
  connections: [],
  journal: [],
  labs: [],
  goals: [],
  carePlan: [],
  sessionNotes: [],
};

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const TRIAGE_ORDER: TriageLevel[] = [
  "emergency",
  "urgent",
  "soon",
  "self-care",
  "routine",
  "none",
];

export function moreUrgent(a: TriageLevel, b: TriageLevel): TriageLevel {
  return TRIAGE_ORDER.indexOf(a) <= TRIAGE_ORDER.indexOf(b) ? a : b;
}

export const TRIAGE_LABEL: Record<TriageLevel, string> = {
  emergency: "Emergency - call 911 / go to the ER now",
  urgent: "Urgent - urgent care or same-day visit",
  soon: "See a clinician soon",
  "self-care": "Self-care and monitor",
  routine: "Routine / preventive",
  none: "No triage set",
};

/**
 * Compact, model-facing summary of the record. Kept small and deterministic
 * so it fits comfortably in the system prompt on every turn.
 */
export function summarizeRecordForModel(r: HealthRecord, now = new Date()): string {
  const lines: string[] = [];
  lines.push(`RECORD SIZE: ${r.journal.length} journal entries, ${r.labs.length} lab/imaging reports (${r.labs.reduce((n, p) => n + p.results.length, 0)} values). Use search_record for anything not shown below.`);
  const p = r.profile;
  const prof: string[] = [];
  if (p.name) prof.push(`name: ${p.name}`);
  if (p.age != null) prof.push(`age: ${p.age}`);
  if (p.sex) prof.push(`sex: ${p.sex}`);
  if (p.heightCm) prof.push(`height: ${p.heightCm} cm`);
  if (p.weightKg) prof.push(`weight: ${p.weightKg} kg`);
  if (p.pregnant) prof.push("pregnant: yes");
  if (p.location?.state || p.location?.postalCode)
    prof.push(
      `location: ${[p.location.city, p.location.state, p.location.postalCode].filter(Boolean).join(", ")}`,
    );
  lines.push(`PROFILE: ${prof.length ? prof.join("; ") : "(nothing entered yet)"}`);
  lines.push(`CONDITIONS: ${p.conditions.length ? p.conditions.join(", ") : "none listed"}`);
  lines.push(`MEDICATIONS: ${p.medications.length ? p.medications.join(", ") : "none listed"}`);
  lines.push(`ALLERGIES: ${p.allergies.length ? p.allergies.join(", ") : "none listed"}`);
  if (r.medSchedule && Object.keys(r.medSchedule).length) {
    const today = isoDay(now);
    const yesterday = isoDay(new Date(now.getTime() - 86_400_000));
    const fmtDay = (d: string) =>
      Object.entries(r.medSchedule!)
        .filter(([, slots]) => slots.length)
        .map(([med, slots]) => {
          const taken = r.medLog?.[d]?.[med] ?? [];
          const missed = slots.filter((s) => !taken.includes(s));
          return `${med}: ${taken.length ? `took ${taken.join("/")}` : "none yet"}${missed.length ? `, ${d === today ? "still due" : "MISSED"} ${missed.join("/")}` : ""}`;
        })
        .join("; ");
    lines.push(`MEDICATION CHECK-OFF today: ${fmtDay(today)}`);
    lines.push(`MEDICATION CHECK-OFF yesterday: ${fmtDay(yesterday)}`);
  }
  if (r.emergency?.bloodType || r.emergency?.notes) lines.push(`EMERGENCY INFO: ${[r.emergency.bloodType ? `blood type ${r.emergency.bloodType}` : "", r.emergency.notes].filter(Boolean).join("; ")}`);

  const recent = [...r.journal]
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 20);
  if (recent.length) {
    lines.push(`RECENT JOURNAL (${recent.length} most recent, newest first):`);
    for (const e of recent) {
      const d = new Date(e.ts);
      const ago = Math.round((now.getTime() - d.getTime()) / 86_400_000);
      const parts: string[] = [];
      if (e.mood != null) parts.push(`mood ${e.mood}/10`);
      if (e.energy != null) parts.push(`energy ${e.energy}/10`);
      if (e.pain != null) parts.push(`pain ${e.pain}/10`);
      if (e.anxiety != null) parts.push(`anxiety ${e.anxiety}/10`);
      if (e.symptoms.length) parts.push(`symptoms: ${e.symptoms.join(", ")}`);
      if (e.vitals) {
        const v = e.vitals;
        const vs: string[] = [];
        if (v.systolic && v.diastolic) vs.push(`BP ${Math.round(v.systolic)}/${Math.round(v.diastolic)}`);
        if (v.heartRate) vs.push(`HR ${Math.round(v.heartRate)}`);
        if (v.tempC) vs.push(`temp ${fmtNum(v.tempC)}C`);
        if (v.spo2) vs.push(`SpO2 ${Math.round(v.spo2)}%`);
        if (v.weightKg) vs.push(`wt ${fmtNum(v.weightKg)}kg`);
        if (v.glucoseMgDl) vs.push(`glucose ${Math.round(v.glucoseMgDl)}`);
        if (v.sleepHours) vs.push(`sleep ${fmtNum(v.sleepHours)}h`);
        if (vs.length) parts.push(vs.join(" "));
      }
      if (e.notes) parts.push(`notes: ${e.notes.slice(0, 240)}`);
      lines.push(
        `- ${d.toISOString().slice(0, 10)} (${ago === 0 ? "today" : `${ago}d ago`})${e.source && e.source !== "user" && e.source !== "assistant" ? ` [${e.source}]` : ""} ${parts.join(" | ")}`,
      );
    }
  } else {
    lines.push("RECENT JOURNAL: no entries yet");
  }

  const idx = labIndexInline(r.labs);
  if (idx) lines.push(`LAB INDEX (latest value per test, flagged first):\n${idx}`);

  const labs = [...r.labs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  if (labs.length) {
    lines.push(`RECENT LABS/IMAGING (${labs.length} most recent of ${r.labs.length}):`);
    for (const l of labs) {
      lines.push(`- ${l.date} ${l.kind}${l.source ? ` (${l.source})` : ""}${l.source_system && l.source_system !== "assistant" ? ` [from ${l.source_system}]` : ""}: ${l.summary ?? ""}`);
      if (l.imaging) lines.push(`    * imaging study ${l.imaging.modality ?? ""} ${l.imaging.description ?? ""} (${l.imaging.seriesCount ?? "?"} series, ${l.imaging.instanceCount ?? "?"} images)`);
      const flagged = l.results.filter((x) => x.flag && x.flag !== "normal");
      for (const x of flagged.slice(0, 12)) {
        lines.push(
          `    * ${x.name}: ${fmtNum(x.value)}${x.unit ? " " + x.unit : ""} [${x.flag}]${x.refLow != null || x.refHigh != null ? ` ref ${x.refLow ?? "?"}-${x.refHigh ?? "?"}` : x.refText ? ` ref ${x.refText}` : ""}`,
        );
      }
    }
  }

  const goals = r.goals.filter((g) => g.active);
  if (goals.length) {
    lines.push("ACTIVE GOALS:");
    for (const g of goals) {
      lines.push(`- ${g.title} (${g.cadence}; ${g.completions.length} completions; streak ${streak(g)})`);
    }
  }

  const plan = r.carePlan.filter((c) => !c.done);
  if (plan.length) {
    lines.push("OPEN CARE PLAN ITEMS:");
    for (const c of plan) lines.push(`- [${c.urgency}] ${c.title}${c.specialty ? ` (${c.specialty})` : ""}`);
  }

  if (r.connections.length) {
    lines.push("CONNECTED SYSTEMS:");
    for (const c of r.connections)
      lines.push(`- ${c.kind === "fhir" ? "EHR/FHIR" : "Imaging/DICOMweb"}: ${c.label}${c.lastSync ? ` (last sync ${c.lastSync.slice(0, 10)})` : " (not yet synced)"}${c.counts ? " " + Object.entries(c.counts).map(([k, v]) => `${v} ${k}`).join(", ") : ""}`);
  }

  const notes = [...r.sessionNotes].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 5);
  if (notes.length) {
    lines.push("PRIOR SESSION SUMMARIES (newest first):");
    for (const n of notes) lines.push(`- ${n.ts.slice(0, 10)} ${n.summary}`);
  }

  return lines.join("\n");
}

export function streak(g: Goal): number {
  if (g.cadence !== "daily") return g.completions.length;
  const set = new Set(g.completions);
  let n = 0;
  const d = new Date();
  // allow today to be incomplete
  if (!set.has(isoDay(d))) d.setDate(d.getDate() - 1);
  while (set.has(isoDay(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** One line per analyte with latest value, history range and flagged count (capped). */
function labIndexInline(labs: LabPanel[]): string {
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
  return [...m.values()]
    .sort((a, b) => b.flagged - a.flagged || b.n - a.n)
    .slice(0, 60)
    .map((r) => `- ${r.name}: ${fmtNum(r.latest.v)}${r.unit ? " " + r.unit : ""} (${r.latest.d})${r.latest.flag && r.latest.flag !== "normal" ? ` [${r.latest.flag}]` : ""}${r.n > 1 ? `; ${r.n}x, range ${fmtNum(r.min)}-${fmtNum(r.max)}${r.flagged ? `, ${r.flagged} flagged` : ""}` : ""}`)
    .join("\n");
}

/** Human-friendly number: trims floating-point noise, keeps meaningful precision. */
export function fmtNum(v: number | string | undefined | null): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  const d = Number.isInteger(v) ? 0 : a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return v.toFixed(d).replace(/\.?0+$/, "");
}

export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
