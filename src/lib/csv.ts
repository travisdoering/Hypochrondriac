/**
 * Forgiving CSV import for vitals exported from device apps and spreadsheets
 * (Omron, Withings, Apple Health via third-party exporters, Dexcom/Libre
 * clarity exports, or a hand-kept sheet). Finds a date column and any
 * recognizable vitals columns by header name.
 */

import { type JournalEntry, type Vitals, uid } from "./record";

const HEADER_MAP: { key: keyof Vitals | "date" | "time" | "notes" | "mood" | "pain" | "sleep"; patterns: RegExp[] }[] = [
  { key: "date", patterns: [/^date/i, /timestamp/i, /^time ?stamp/i, /datetime/i, /measured/i, /^day$/i] },
  { key: "time", patterns: [/^time$/i, /^clock/i] },
  { key: "systolic", patterns: [/sys/i, /^sbp/i, /blood ?pressure/i, /^bp$/i] },
  { key: "diastolic", patterns: [/dia/i, /^dbp/i] },
  { key: "heartRate", patterns: [/pulse/i, /heart ?rate/i, /^hr$/i, /bpm/i] },
  { key: "glucoseMgDl", patterns: [/glucose/i, /blood ?sugar/i, /^bg$/i, /historic/i, /scan glucose/i] },
  { key: "spo2", patterns: [/spo2/i, /oxygen/i, /sat/i] },
  { key: "tempC", patterns: [/temp/i] },
  { key: "weightKg", patterns: [/weight/i, /^wt$/i, /mass/i] },
  { key: "sleepHours", patterns: [/sleep/i] },
  { key: "steps", patterns: [/steps/i] },
  { key: "mood", patterns: [/mood/i] },
  { key: "pain", patterns: [/pain/i] },
  { key: "notes", patterns: [/note/i, /comment/i, /memo/i] },
];

export interface CsvImportResult {
  entries: JournalEntry[];
  columns: Record<string, string>;
  skipped: number;
}

export function parseCsvVitals(text: string, sourceLabel = "CSV import"): CsvImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { entries: [], columns: {}, skipped: rows.length };
  const header = rows[0].map((h) => h.trim());
  const col: Partial<Record<string, number>> = {};
  const columns: Record<string, string> = {};
  header.forEach((h, i) => {
    for (const m of HEADER_MAP) {
      if (col[m.key] == null && m.patterns.some((p) => p.test(h))) {
        col[m.key] = i;
        columns[m.key] = h;
        break;
      }
    }
  });
  if (col.date == null) {
    // try to find a column whose values parse as dates
    for (let i = 0; i < header.length; i++) {
      if (rows.slice(1, 6).every((r) => r[i] && !Number.isNaN(Date.parse(r[i])))) {
        col.date = i;
        columns.date = header[i];
        break;
      }
    }
  }
  const unitHint = (k: string) => (columns[k] ?? "").toLowerCase();
  const entries: JournalEntry[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    if (!r.some((c) => c.trim())) continue;
    const dateStr = col.date != null ? r[col.date] : "";
    const timeStr = col.time != null ? r[col.time] : "";
    const ts = parseDate(dateStr, timeStr);
    if (!ts) {
      skipped++;
      continue;
    }
    const v: Vitals = {};
    const num = (k: keyof Vitals) => {
      const i = col[k];
      if (i == null) return undefined;
      const n = parseFloat(String(r[i]).replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) ? n : undefined;
    };
    // blood pressure may be in one column "120/80"
    const sys = num("systolic");
    if (sys != null && col.diastolic == null) {
      const m = /(\d{2,3})\s*\/\s*(\d{2,3})/.exec(r[col.systolic!]);
      if (m) {
        v.systolic = Number(m[1]);
        v.diastolic = Number(m[2]);
      } else v.systolic = sys;
    } else {
      if (sys != null) v.systolic = sys;
      const dia = num("diastolic");
      if (dia != null) v.diastolic = dia;
    }
    const hr = num("heartRate");
    if (hr != null) v.heartRate = Math.round(hr);
    const g = num("glucoseMgDl");
    if (g != null) v.glucoseMgDl = unitHint("glucoseMgDl").includes("mmol") || g < 35 ? Math.round(g * 18.016) : Math.round(g);
    const s = num("spo2");
    if (s != null) v.spo2 = Math.round(s);
    const t = num("tempC");
    if (t != null) v.tempC = Math.round((unitHint("tempC").includes("f") || t > 50 ? ((t - 32) * 5) / 9 : t) * 10) / 10;
    const w = num("weightKg");
    if (w != null) v.weightKg = Math.round((unitHint("weightKg").includes("lb") || w > 250 ? w * 0.4536 : w) * 10) / 10;
    const sl = num("sleepHours");
    if (sl != null) v.sleepHours = sl > 24 ? Math.round((sl / 60) * 10) / 10 : sl;
    const st = num("steps");
    if (st != null) v.steps = Math.round(st);
    const mood = col.mood != null ? parseFloat(r[col.mood]) : NaN;
    const pain = col.pain != null ? parseFloat(r[col.pain]) : NaN;
    const notes = col.notes != null ? r[col.notes]?.trim() : "";
    if (!Object.keys(v).length && Number.isNaN(mood) && Number.isNaN(pain) && !notes) {
      skipped++;
      continue;
    }
    entries.push({
      id: `csv-${uid()}`,
      ts,
      source: "import",
      symptoms: [],
      tags: ["import"],
      notes: notes || `${sourceLabel}`,
      vitals: Object.keys(v).length ? v : undefined,
      mood: Number.isFinite(mood) ? mood : undefined,
      pain: Number.isFinite(pain) ? pain : undefined,
    });
  }
  return { entries, columns, skipped };
}

function parseDate(d: string, t: string): string | null {
  const s = [d, t].filter(Boolean).join(" ").trim();
  if (!s) return null;
  let ms = Date.parse(s);
  if (Number.isNaN(ms)) {
    // dd/mm/yyyy or dd.mm.yyyy
    const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(.*)$/.exec(s);
    if (m) ms = Date.parse(`${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}${m[4]}`);
  }
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/** RFC-4180-ish CSV parser (quotes, commas, newlines in quotes; also ; and tab). */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? "").trim());
}
