/**
 * FHIR R4 client + mapping into the HealthRecord. Runs in the browser; all
 * HTTP goes through /api/fhir to avoid CORS. Supports:
 *   - open servers (sandboxes, local HAPI)                   authMode "none"
 *   - a pasted bearer token                                  authMode "bearer"
 *   - SMART on FHIR standalone launch with PKCE (patient portals) authMode "smart"
 */

import {
  type Connection,
  type HealthRecord,
  type JournalEntry,
  type LabPanel,
  type LabResult,
  type Profile,
  type Vitals,
  isoDay,
  uid,
} from "./record";

// ---- Minimal FHIR types we touch -------------------------------------------
interface Coding { system?: string; code?: string; display?: string }
interface CodeableConcept { coding?: Coding[]; text?: string }
interface Quantity { value?: number; unit?: string; code?: string }
interface Reference { reference?: string; display?: string }
interface Resource { resourceType: string; id?: string; [k: string]: unknown }
interface Bundle extends Resource {
  resourceType: "Bundle";
  entry?: { resource?: Resource; fullUrl?: string }[];
  link?: { relation: string; url: string }[];
  total?: number;
}
export interface Patient extends Resource {
  resourceType: "Patient";
  name?: { given?: string[]; family?: string; text?: string; use?: string }[];
  gender?: string;
  birthDate?: string;
  address?: { city?: string; state?: string; postalCode?: string }[];
}
interface Condition extends Resource {
  code?: CodeableConcept;
  clinicalStatus?: CodeableConcept;
  onsetDateTime?: string;
  recordedDate?: string;
}
interface MedicationRequest extends Resource {
  medicationCodeableConcept?: CodeableConcept;
  medicationReference?: Reference;
  status?: string;
  dosageInstruction?: { text?: string }[];
  authoredOn?: string;
}
interface MedicationStatement extends Resource {
  medicationCodeableConcept?: CodeableConcept;
  status?: string;
}
interface AllergyIntolerance extends Resource {
  code?: CodeableConcept;
  clinicalStatus?: CodeableConcept;
  reaction?: { manifestation?: CodeableConcept[] }[];
}
interface Observation extends Resource {
  code?: CodeableConcept;
  category?: CodeableConcept[];
  effectiveDateTime?: string;
  effectivePeriod?: { start?: string };
  issued?: string;
  valueQuantity?: Quantity;
  valueString?: string;
  valueCodeableConcept?: CodeableConcept;
  interpretation?: CodeableConcept[];
  referenceRange?: { low?: Quantity; high?: Quantity; text?: string }[];
  component?: { code?: CodeableConcept; valueQuantity?: Quantity }[];
  hasMember?: Reference[];
  status?: string;
}
interface DiagnosticReport extends Resource {
  code?: CodeableConcept;
  category?: CodeableConcept[];
  effectiveDateTime?: string;
  issued?: string;
  conclusion?: string;
  result?: Reference[];
  presentedForm?: { contentType?: string; data?: string; title?: string }[];
  status?: string;
}
interface Immunization extends Resource {
  vaccineCode?: CodeableConcept;
  occurrenceDateTime?: string;
  status?: string;
}

export interface FhirSummary {
  patient?: Patient;
  conditions: Condition[];
  medications: (MedicationRequest | MedicationStatement)[];
  allergies: AllergyIntolerance[];
  observations: Observation[];
  reports: DiagnosticReport[];
  immunizations: Immunization[];
}

// ---- HTTP ------------------------------------------------------------------
export class FhirClient {
  constructor(
    public baseUrl: string,
    private token?: string,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const u = `/api/fhir?base=${encodeURIComponent(this.baseUrl)}&path=${encodeURIComponent(path)}`;
    const res = await fetch(u, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        const oo = JSON.parse(text);
        msg = oo?.issue?.map((i: { diagnostics?: string; details?: { text?: string } }) => i.diagnostics ?? i.details?.text).filter(Boolean).join("; ") || oo?.error_description || oo?.error || msg;
      } catch {
        /* keep text */
      }
      throw new Error(`${res.status} ${msg}`);
    }
    return JSON.parse(text) as T;
  }

  async metadata(): Promise<Resource> {
    return this.get<Resource>("metadata");
  }

  async smartConfiguration(): Promise<SmartConfig | null> {
    try {
      return await this.get<SmartConfig>(".well-known/smart-configuration");
    } catch {
      // fall back to CapabilityStatement security extension
      try {
        const cap = (await this.metadata()) as { rest?: { security?: { extension?: { url: string; extension?: { url: string; valueUri?: string }[] }[] } }[] };
        const ext = cap.rest?.[0]?.security?.extension?.find((e) => e.url.includes("oauth-uris"));
        if (!ext) return null;
        const find = (n: string) => ext.extension?.find((x) => x.url === n)?.valueUri;
        return {
          authorization_endpoint: find("authorize") ?? "",
          token_endpoint: find("token") ?? "",
          code_challenge_methods_supported: ["S256"],
        };
      } catch {
        return null;
      }
    }
  }

  async searchPatients(name: string): Promise<Patient[]> {
    const b = await this.get<Bundle>(`Patient?name=${encodeURIComponent(name)}&_count=20`);
    return (b.entry ?? []).map((e) => e.resource).filter((r): r is Patient => r?.resourceType === "Patient");
  }

  async patient(id: string): Promise<Patient> {
    return this.get<Patient>(`Patient/${encodeURIComponent(id)}`);
  }

  private async all<T extends Resource>(path: string, max = 500): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    let guard = 0;
    while (next && out.length < max && guard++ < 25) {
      const b: Bundle = await this.get<Bundle>(next);
      for (const e of b.entry ?? []) if (e.resource && e.resource.resourceType !== "OperationOutcome") out.push(e.resource as T);
      const link = b.link?.find((l) => l.relation === "next")?.url;
      next = link ? link : undefined;
    }
    return out;
  }

  async pullEverything(patientId: string, onProgress?: (msg: string) => void): Promise<FhirSummary> {
    const pid = encodeURIComponent(patientId);
    const step = async <T extends Resource>(label: string, path: string): Promise<T[]> => {
      onProgress?.(`Fetching ${label}...`);
      try {
        return await this.all<T>(path);
      } catch (e) {
        onProgress?.(`${label}: ${e instanceof Error ? e.message : "failed"} (skipped)`);
        return [];
      }
    };
    const patient = await this.patient(patientId);
    const conditions = await step<Condition>("conditions", `Condition?patient=${pid}&_count=100`);
    const medReq = await step<MedicationRequest>("medications", `MedicationRequest?patient=${pid}&_count=100`);
    const medStmt = await step<MedicationStatement>("medication statements", `MedicationStatement?patient=${pid}&_count=100`);
    const allergies = await step<AllergyIntolerance>("allergies", `AllergyIntolerance?patient=${pid}&_count=100`);
    const labs = await step<Observation>("lab results", `Observation?patient=${pid}&category=laboratory&_count=200&_sort=-date`);
    const vitals = await step<Observation>("vital signs", `Observation?patient=${pid}&category=vital-signs&_count=200&_sort=-date`);
    const reports = await step<DiagnosticReport>("diagnostic reports", `DiagnosticReport?patient=${pid}&_count=100&_sort=-date`);
    const immunizations = await step<Immunization>("immunizations", `Immunization?patient=${pid}&_count=100`);
    return {
      patient,
      conditions,
      medications: [...medReq, ...medStmt],
      allergies,
      observations: [...labs, ...vitals],
      reports,
      immunizations,
    };
  }
}

export interface SmartConfig {
  authorization_endpoint: string;
  token_endpoint: string;
  code_challenge_methods_supported?: string[];
  scopes_supported?: string[];
}

// ---- SMART on FHIR (standalone launch, public client + PKCE) ---------------
const SMART_STATE_KEY = "hypo.smart.pending";
const SMART_TOKEN_KEY = "hypo.smart.tokens";

export interface SmartPending {
  connectionId: string;
  baseUrl: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  verifier: string;
  state: string;
}

export interface SmartTokens {
  access_token: string;
  patient?: string;
  expires_at?: number;
  scope?: string;
  id_token?: string;
  refresh_token?: string;
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function beginSmartLaunch(conn: Connection, cfg: SmartConfig): Promise<string> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
  const verifier = b64url(verifierBytes);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const redirectUri = `${window.location.origin}/smart/callback`;
  const pending: SmartPending = {
    connectionId: conn.id,
    baseUrl: conn.baseUrl,
    tokenEndpoint: cfg.token_endpoint,
    clientId: conn.clientId ?? "",
    redirectUri,
    verifier,
    state,
  };
  sessionStorage.setItem(SMART_STATE_KEY, JSON.stringify(pending));
  const scope =
    conn.scope ??
    "launch/patient openid fhirUser offline_access patient/Patient.read patient/Condition.read patient/MedicationRequest.read patient/AllergyIntolerance.read patient/Observation.read patient/DiagnosticReport.read patient/Immunization.read";
  const u = new URL(cfg.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", conn.clientId ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", scope);
  u.searchParams.set("state", state);
  u.searchParams.set("aud", conn.baseUrl);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export function readSmartPending(): SmartPending | null {
  const s = sessionStorage.getItem(SMART_STATE_KEY);
  return s ? (JSON.parse(s) as SmartPending) : null;
}

export async function completeSmartLaunch(code: string, state: string): Promise<{ connectionId: string; tokens: SmartTokens }> {
  const pending = readSmartPending();
  if (!pending) throw new Error("No pending SMART launch in this browser session.");
  if (pending.state !== state) throw new Error("State mismatch - possible CSRF; please retry the connection.");
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: pending.redirectUri,
    client_id: pending.clientId,
    code_verifier: pending.verifier,
  });
  const res = await fetch(`/api/fhir?base=${encodeURIComponent(pending.baseUrl)}&path=${encodeURIComponent(pending.tokenEndpoint)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "x-accept": "application/json" },
    body: form.toString(),
  });
  const data = (await res.json()) as SmartTokens & { expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || data.error) throw new Error(data.error_description ?? data.error ?? `Token exchange failed (${res.status})`);
  const tokens: SmartTokens = {
    access_token: data.access_token,
    patient: data.patient,
    scope: data.scope,
    id_token: data.id_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
  sessionStorage.removeItem(SMART_STATE_KEY);
  saveSmartTokens(pending.connectionId, tokens);
  return { connectionId: pending.connectionId, tokens };
}

export function saveSmartTokens(connectionId: string, tokens: SmartTokens) {
  const all = JSON.parse(sessionStorage.getItem(SMART_TOKEN_KEY) ?? "{}") as Record<string, SmartTokens>;
  all[connectionId] = tokens;
  sessionStorage.setItem(SMART_TOKEN_KEY, JSON.stringify(all));
}
export function loadSmartTokens(connectionId: string): SmartTokens | undefined {
  const all = JSON.parse(sessionStorage.getItem(SMART_TOKEN_KEY) ?? "{}") as Record<string, SmartTokens>;
  const t = all[connectionId];
  if (t?.expires_at && t.expires_at < Date.now()) return undefined;
  return t;
}
export function clearSmartTokens(connectionId: string) {
  const all = JSON.parse(sessionStorage.getItem(SMART_TOKEN_KEY) ?? "{}") as Record<string, SmartTokens>;
  delete all[connectionId];
  sessionStorage.setItem(SMART_TOKEN_KEY, JSON.stringify(all));
}

// ---- Mapping FHIR -> HealthRecord ------------------------------------------
export function ccText(c?: CodeableConcept): string | undefined {
  return c?.text ?? c?.coding?.find((x) => x.display)?.display ?? c?.coding?.[0]?.code;
}

export function patientDisplayName(p?: Patient): string {
  const n = p?.name?.find((x) => x.use === "official") ?? p?.name?.[0];
  if (!n) return "Unnamed patient";
  return n.text ?? [...(n.given ?? []), n.family].filter(Boolean).join(" ");
}

export function ageFromBirthDate(bd?: string): number | undefined {
  if (!bd) return undefined;
  const b = new Date(bd);
  if (Number.isNaN(b.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

const LOINC_VITALS: Record<string, keyof Vitals> = {
  "8480-6": "systolic",
  "8462-4": "diastolic",
  "8867-4": "heartRate",
  "8310-5": "tempC",
  "2708-6": "spo2",
  "59408-5": "spo2",
  "29463-7": "weightKg",
  "2339-0": "glucoseMgDl",
  "2345-7": "glucoseMgDl",
  "41950-7": "steps",
};

function obsDate(o: Observation | DiagnosticReport): string {
  return (o as Observation).effectiveDateTime ?? (o as Observation).effectivePeriod?.start ?? o.issued ?? new Date().toISOString();
}

function interpFlag(o: Observation): LabResult["flag"] {
  const code = o.interpretation?.[0]?.coding?.[0]?.code?.toUpperCase();
  switch (code) {
    case "L":
      return "low";
    case "H":
      return "high";
    case "LL":
      return "critical-low";
    case "HH":
      return "critical-high";
    case "A":
    case "AA":
      return "abnormal";
    case "N":
      return "normal";
  }
  const v = o.valueQuantity?.value;
  const rr = o.referenceRange?.[0];
  if (v != null && rr) {
    if (rr.low?.value != null && v < rr.low.value) return "low";
    if (rr.high?.value != null && v > rr.high.value) return "high";
    if (rr.low?.value != null || rr.high?.value != null) return "normal";
  }
  return undefined;
}

export function obsToLabResult(o: Observation): LabResult | null {
  const name = ccText(o.code);
  if (!name) return null;
  const rr = o.referenceRange?.[0];
  let value: number | string | undefined = o.valueQuantity?.value;
  if (typeof value === "number") value = roundSig(value);
  if (value == null) value = o.valueString ?? ccText(o.valueCodeableConcept);
  if (value == null && o.component?.length) {
    value = o.component.map((c) => `${ccText(c.code) ?? ""} ${c.valueQuantity?.value != null ? roundSig(c.valueQuantity.value) : ""}${c.valueQuantity?.unit ? " " + c.valueQuantity.unit : ""}`.trim()).join("; ");
  }
  if (value == null) return null;
  return {
    name,
    value,
    unit: o.valueQuantity?.unit ?? o.valueQuantity?.code,
    refLow: rr?.low?.value,
    refHigh: rr?.high?.value,
    refText: rr?.text,
    flag: interpFlag(o),
  };
}

function isVital(o: Observation): boolean {
  return (o.category ?? []).some((c) => c.coding?.some((x) => x.code === "vital-signs")) || (o.code?.coding ?? []).some((c) => c.code && LOINC_VITALS[c.code]);
}

function toC(q?: Quantity): number | undefined {
  if (q?.value == null) return undefined;
  const u = (q.unit ?? q.code ?? "").toLowerCase();
  if (u.includes("f") && !u.includes("cel")) return Math.round(((q.value - 32) * 5) / 9 * 10) / 10;
  return q.value;
}
function toKg(q?: Quantity): number | undefined {
  if (q?.value == null) return undefined;
  const u = (q.unit ?? q.code ?? "").toLowerCase();
  if (u.startsWith("lb") || u === "[lb_av]") return Math.round(q.value * 0.4536 * 10) / 10;
  return q.value;
}

/** Group vital-sign observations by day into journal entries. */
function vitalsToJournal(obs: Observation[]): JournalEntry[] {
  const byDay = new Map<string, JournalEntry>();
  for (const o of obs) {
    const ts = obsDate(o);
    const parsed = new Date(ts);
    // A bare date ("2024-03-05") is already the calendar day; parsing it would read as UTC
    // midnight and shift to the previous day in US time zones.
    const day = /^\d{4}-\d{2}-\d{2}$/.test(ts) ? ts : Number.isNaN(parsed.getTime()) ? ts.slice(0, 10) : isoDay(parsed);
    let entry = byDay.get(day);
    if (!entry) {
      entry = { id: `fhir-vitals-${day}`, ts, source: "fhir", symptoms: [], tags: ["vitals", "from-ehr"], notes: "Vital signs recorded in EHR", vitals: {} };
      byDay.set(day, entry);
    }
    const v = entry.vitals!;
    const apply = (code: string | undefined, q: Quantity | undefined) => {
      const key = code ? LOINC_VITALS[code] : undefined;
      if (!key || q?.value == null) return;
      if (key === "tempC") v.tempC = toC(q);
      else if (key === "weightKg") v.weightKg = toKg(q);
      else v[key] = roundSig(q.value);
    };
    for (const c of o.code?.coding ?? []) apply(c.code, o.valueQuantity);
    for (const comp of o.component ?? []) for (const c of comp.code?.coding ?? []) apply(c.code, comp.valueQuantity);
  }
  return [...byDay.values()].filter((e) => e.vitals && Object.keys(e.vitals).length > 0);
}

export interface FhirImport {
  profile: Partial<Profile>;
  journal: JournalEntry[];
  labs: LabPanel[];
  counts: Record<string, number>;
  immunizations: string[];
}

export function mapFhirToRecord(s: FhirSummary, label: string): FhirImport {
  const profile: Partial<Profile> = {};
  if (s.patient) {
    profile.name = patientDisplayName(s.patient);
    profile.age = ageFromBirthDate(s.patient.birthDate);
    const g = s.patient.gender;
    profile.sex = g === "female" || g === "male" ? g : g === "other" ? "intersex" : undefined;
    const a = s.patient.address?.[0];
    if (a) profile.location = { city: a.city, state: a.state, postalCode: a.postalCode };
  }
  const activeStatus = (cc?: CodeableConcept) => {
    const c = cc?.coding?.[0]?.code;
    return !c || c === "active" || c === "recurrence" || c === "relapse";
  };
  profile.conditions = dedupe(
    s.conditions.filter((c) => activeStatus(c.clinicalStatus)).map((c) => ccText(c.code)).filter((x): x is string => !!x),
  );
  profile.medications = dedupe(
    s.medications
      .filter((m) => !m.status || m.status === "active" || m.status === "completed" || m.status === "unknown")
      .map((m) => {
        const name = ccText(m.medicationCodeableConcept) ?? (m as MedicationRequest).medicationReference?.display;
        const dose = (m as MedicationRequest).dosageInstruction?.[0]?.text;
        return name ? (dose ? `${name} (${dose})` : name) : undefined;
      })
      .filter((x): x is string => !!x),
  );
  profile.allergies = dedupe(
    s.allergies
      .filter((a) => activeStatus(a.clinicalStatus))
      .map((a) => {
        const name = ccText(a.code);
        const rx = a.reaction?.[0]?.manifestation?.map(ccText).filter(Boolean).join(", ");
        return name ? (rx ? `${name} (${rx})` : name) : undefined;
      })
      .filter((x): x is string => !!x),
  );

  const vitals = s.observations.filter(isVital);
  const labObs = s.observations.filter((o) => !isVital(o));
  const journal = vitalsToJournal(vitals);

  // Group lab observations by DiagnosticReport when possible, else by day.
  const obsById = new Map<string, Observation>();
  for (const o of labObs) if (o.id) obsById.set(o.id, o);
  const used = new Set<string>();
  const labs: LabPanel[] = [];
  for (const r of s.reports) {
    const members = (r.result ?? [])
      .map((ref) => ref.reference?.split("/").pop())
      .map((id) => (id ? obsById.get(id) : undefined))
      .filter((o): o is Observation => !!o);
    members.forEach((o) => o.id && used.add(o.id));
    const results = members.map(obsToLabResult).filter((x): x is LabResult => !!x);
    const isImaging = (r.category ?? []).some((c) => c.coding?.some((x) => ["RAD", "imaging"].includes(x.code ?? ""))) || /x-?ray|ct |mri|ultrasound|radiograph|mammo|echo/i.test(ccText(r.code) ?? "");
    const note = r.presentedForm?.find((p) => p.contentType?.startsWith("text/") && p.data);
    let rawText: string | undefined;
    if (note?.data) {
      try {
        rawText = decodeURIComponent(escape(atob(note.data)));
      } catch {
        rawText = undefined;
      }
    }
    if (results.length === 0 && !r.conclusion && !rawText) continue;
    labs.push({
      id: `fhir-report-${r.id ?? uid()}`,
      date: obsDate(r).slice(0, 10),
      source: `${label}: ${ccText(r.code) ?? "Report"}`,
      kind: isImaging ? "imaging" : "labs",
      source_system: "fhir",
      summary: r.conclusion ?? (results.length ? `${results.length} results` : undefined),
      results,
      rawText,
    });
  }
  const loose = labObs.filter((o) => !o.id || !used.has(o.id));
  const byDay = new Map<string, Observation[]>();
  for (const o of loose) {
    const d = obsDate(o).slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), o]);
  }
  for (const [day, list] of byDay) {
    const results = list.map(obsToLabResult).filter((x): x is LabResult => !!x);
    if (!results.length) continue;
    labs.push({
      id: `fhir-labs-${day}`,
      date: day,
      source: `${label}: lab results`,
      kind: "labs",
      source_system: "fhir",
      summary: `${results.length} lab results${results.some((x) => x.flag && x.flag !== "normal") ? `, ${results.filter((x) => x.flag && x.flag !== "normal").length} flagged` : ""}`,
      results,
    });
  }

  const immunizations = s.immunizations
    .filter((i) => i.status !== "not-done")
    .map((i) => `${ccText(i.vaccineCode) ?? "Vaccine"}${i.occurrenceDateTime ? ` (${i.occurrenceDateTime.slice(0, 10)})` : ""}`);

  return {
    profile,
    journal,
    labs,
    immunizations,
    counts: {
      conditions: profile.conditions.length,
      medications: profile.medications.length,
      allergies: profile.allergies.length,
      "lab results": labObs.length,
      "vital-sign days": journal.length,
      reports: s.reports.length,
      immunizations: immunizations.length,
    },
  };
}

function roundSig(v: number): number {
  const a = Math.abs(v);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return Number(v.toFixed(d));
}

function dedupe(a: string[]): string[] {
  const seen = new Set<string>();
  return a.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Merge an import into the record, replacing prior data from the same connection. */
export function mergeFhirImport(record: HealthRecord, imp: FhirImport, conn: Connection): HealthRecord {
  const p = { ...record.profile };
  if (imp.profile.name && !p.name) p.name = imp.profile.name;
  if (imp.profile.age != null) p.age = imp.profile.age;
  if (imp.profile.sex) p.sex = imp.profile.sex;
  if (imp.profile.location && !p.location?.postalCode) p.location = imp.profile.location;
  p.conditions = dedupe([...p.conditions, ...(imp.profile.conditions ?? [])]);
  p.medications = dedupe([...p.medications, ...(imp.profile.medications ?? [])]);
  p.allergies = dedupe([...p.allergies, ...(imp.profile.allergies ?? [])]);
  // Replace only what THIS connection imported before. Untagged FHIR items come
  // from an older version; they're treated as this connection's only when it's the sole FHIR source.
  const soleFhir = record.connections.filter((c) => c.kind === "fhir").length <= 1;
  const mine = (connectionId: string | undefined, isFhir: boolean) => connectionId === conn.id || (!connectionId && isFhir && soleFhir);
  const tag = <T extends { id: string; connectionId?: string }>(x: T): T => ({ ...x, id: `${conn.id}:${x.id}`, connectionId: conn.id });
  const journal = [...record.journal.filter((e) => !mine(e.connectionId, e.source === "fhir")), ...imp.journal.map(tag)];
  const labs = [...record.labs.filter((l) => !mine(l.connectionId, l.source_system === "fhir")), ...imp.labs.map(tag)];
  const connections = record.connections.map((c) =>
    c.id === conn.id ? { ...c, lastSync: new Date().toISOString(), counts: imp.counts } : c,
  );
  return { ...record, profile: p, journal, labs, connections };
}

/** Remove a connection and everything it imported (leaves other sources alone). */
export function removeConnectionData(record: HealthRecord, connId: string): HealthRecord {
  const conn = record.connections.find((c) => c.id === connId);
  const soleFhir = conn?.kind === "fhir" && record.connections.filter((c) => c.kind === "fhir").length <= 1;
  const mine = (connectionId: string | undefined, isFhir: boolean) => connectionId === connId || (!connectionId && isFhir && soleFhir);
  return {
    ...record,
    connections: record.connections.filter((c) => c.id !== connId),
    journal: record.journal.filter((e) => !mine(e.connectionId, e.source === "fhir")),
    labs: record.labs.filter((l) => !mine(l.connectionId, l.source_system === "fhir")),
  };
}

/** Export the whole record as a FHIR R4 Bundle (collection) so it can travel the other way. */
export function recordToFhirBundle(r: HealthRecord): Bundle {
  const pid = "hypochondriac-patient";
  const entry: Bundle["entry"] = [];
  const p = r.profile;
  entry.push({
    resource: {
      resourceType: "Patient",
      id: pid,
      ...(p.name ? { name: [{ text: p.name }] } : {}),
      ...(p.sex && p.sex !== "prefer-not" ? { gender: p.sex === "intersex" ? "other" : p.sex } : {}),
      ...(p.location ? { address: [{ city: p.location.city, state: p.location.state, postalCode: p.location.postalCode }] } : {}),
    } as Resource,
  });
  for (const c of p.conditions)
    entry.push({ resource: { resourceType: "Condition", code: { text: c }, subject: { reference: `Patient/${pid}` }, clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] } } as Resource });
  for (const m of p.medications)
    entry.push({ resource: { resourceType: "MedicationStatement", status: "active", medicationCodeableConcept: { text: m }, subject: { reference: `Patient/${pid}` } } as Resource });
  for (const a of p.allergies)
    entry.push({ resource: { resourceType: "AllergyIntolerance", code: { text: a }, patient: { reference: `Patient/${pid}` } } as Resource });
  for (const e of r.journal) {
    const v = e.vitals ?? {};
    const mk = (loinc: string, display: string, value: number | undefined, unit: string) =>
      value != null && entry!.push({ resource: { resourceType: "Observation", status: "final", category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }], code: { coding: [{ system: "http://loinc.org", code: loinc, display }] }, subject: { reference: `Patient/${pid}` }, effectiveDateTime: e.ts, valueQuantity: { value, unit } } as Resource });
    mk("8480-6", "Systolic blood pressure", v.systolic, "mm[Hg]");
    mk("8462-4", "Diastolic blood pressure", v.diastolic, "mm[Hg]");
    mk("8867-4", "Heart rate", v.heartRate, "/min");
    mk("8310-5", "Body temperature", v.tempC, "Cel");
    mk("2708-6", "Oxygen saturation", v.spo2, "%");
    mk("29463-7", "Body weight", v.weightKg, "kg");
    mk("2339-0", "Glucose", v.glucoseMgDl, "mg/dL");
    if (e.notes || e.symptoms.length || e.mood != null)
      entry.push({
        resource: {
          resourceType: "Observation",
          status: "final",
          category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "survey" }] }],
          code: { text: "Patient journal entry" },
          subject: { reference: `Patient/${pid}` },
          effectiveDateTime: e.ts,
          valueString: [e.notes, e.symptoms.length ? `symptoms: ${e.symptoms.join(", ")}` : "", e.mood != null ? `mood ${e.mood}/10` : "", e.pain != null ? `pain ${e.pain}/10` : "", e.anxiety != null ? `anxiety ${e.anxiety}/10` : ""].filter(Boolean).join(" | "),
        } as Resource,
      });
  }
  for (const l of r.labs) {
    const obsRefs: Reference[] = [];
    for (const x of l.results) {
      const oid = uid();
      obsRefs.push({ reference: `Observation/${oid}` });
      entry.push({
        resource: {
          resourceType: "Observation",
          id: oid,
          status: "final",
          category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
          code: { text: x.name },
          subject: { reference: `Patient/${pid}` },
          effectiveDateTime: l.date,
          ...(typeof x.value === "number" ? { valueQuantity: { value: x.value, unit: x.unit } } : { valueString: String(x.value) }),
          ...(x.refLow != null || x.refHigh != null || x.refText ? { referenceRange: [{ ...(x.refLow != null ? { low: { value: x.refLow, unit: x.unit } } : {}), ...(x.refHigh != null ? { high: { value: x.refHigh, unit: x.unit } } : {}), ...(x.refText ? { text: x.refText } : {}) }] } : {}),
          ...(x.flag && x.flag !== "normal" ? { interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: x.flag === "low" ? "L" : x.flag === "high" ? "H" : x.flag === "critical-low" ? "LL" : x.flag === "critical-high" ? "HH" : "A" }] }] } : {}),
        } as Resource,
      });
    }
    entry.push({
      resource: {
        resourceType: "DiagnosticReport",
        id: l.id,
        status: "final",
        code: { text: l.source ?? (l.kind === "imaging" ? "Imaging report" : "Lab panel") },
        subject: { reference: `Patient/${pid}` },
        effectiveDateTime: l.date,
        conclusion: l.summary,
        result: obsRefs,
      } as Resource,
    });
  }
  return { resourceType: "Bundle", type: "collection", timestamp: new Date().toISOString(), entry } as Bundle;
}

/** Import a FHIR Bundle JSON file (e.g. "Download my record" from a patient portal). */
export function bundleToSummary(bundle: Bundle): FhirSummary {
  const res = (bundle.entry ?? []).map((e) => e.resource).filter((r): r is Resource => !!r);
  const pick = <T extends Resource>(type: string) => res.filter((r) => r.resourceType === type) as T[];
  return {
    patient: pick<Patient>("Patient")[0],
    conditions: pick<Condition>("Condition"),
    medications: [...pick<MedicationRequest>("MedicationRequest"), ...pick<MedicationStatement>("MedicationStatement")],
    allergies: pick<AllergyIntolerance>("AllergyIntolerance"),
    observations: pick<Observation>("Observation"),
    reports: pick<DiagnosticReport>("DiagnosticReport"),
    immunizations: pick<Immunization>("Immunization"),
  };
}

export const FHIR_PRESETS: { label: string; baseUrl: string; authMode: Connection["authMode"]; note: string; clientId?: string }[] = [
  {
    label: "SMART Health IT sandbox (R4, open)",
    baseUrl: "https://launch.smarthealthit.org/v/r4/fhir",
    authMode: "none",
    note: "Synthetic patients, no login. Search a name like 'Smith' to pick one.",
  },
  {
    label: "SMART Health IT sandbox - practice portal sign-in",
    // The "sim" segment tells the sandbox to simulate a standalone portal login.
    baseUrl: "https://launch.smarthealthit.org/v/r4/sim/eyJsYXVuY2hfdHlwZSI6InBhdGllbnQtc3RhbmRhbG9uZSJ9/fhir",
    authMode: "smart",
    clientId: "hypochondriac",
    note: "Rehearses a real patient-portal login (SMART on FHIR). On the sandbox page pick anyone and type any password - it's a demo login - then pick a patient.",
  },
  {
    label: "HAPI FHIR public test server (R4, open)",
    baseUrl: "https://hapi.fhir.org/baseR4",
    authMode: "none",
    note: "Community test server with mixed data. Search a patient name.",
  },
  {
    label: "Epic (MyChart) patient sandbox - SMART",
    baseUrl: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
    authMode: "smart",
    note: "Needs a client ID registered at fhir.epic.com with redirect URI {origin}/smart/callback. Test logins are on Epic's sandbox page.",
  },
  {
    label: "Oracle Health (Cerner) sandbox - SMART",
    baseUrl: "https://fhir-myrecord.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d",
    authMode: "smart",
    note: "Needs a client ID from code.cerner.com with redirect URI {origin}/smart/callback.",
  },
];
