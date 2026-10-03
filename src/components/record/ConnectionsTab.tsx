"use client";

import { useEffect, useRef, useState } from "react";
import { migrateRecord, recordStore, useRecord } from "@/lib/store";
import { EMPTY_RECORD, uid, type Connection, type HealthRecord, type LabPanel } from "@/lib/record";
import {
  FHIR_PRESETS,
  FhirClient,
  beginSmartLaunch,
  bundleToSummary,
  clearSmartTokens,
  loadSmartTokens,
  mapFhirToRecord,
  mergeFhirImport,
  patientDisplayName,
  recordToFhirBundle,
  removeConnectionData,
  type Patient,
} from "@/lib/fhir";
import { DICOM_PRESETS, DicomWebClient, type DicomStudy } from "@/lib/dicom";
import { inputCls, Field } from "./TodayTab";
import { bus } from "@/lib/bus";
import { parseCsvVitals } from "@/lib/csv";

export function ConnectionsTab() {
  const r = useRecord();
  const fhir = r.connections.filter((c) => c.kind === "fhir");
  const dicom = r.connections.filter((c) => c.kind === "dicomweb");
  const [adding, setAdding] = useState<null | "fhir" | "dicomweb">(null);

  return (
    <div className="flex flex-col gap-5 text-sm">
      <p className="text-ink-2">
        Hypochondriac can act as your personal health information exchange: pull your chart from a patient portal (FHIR R4 / SMART on FHIR), browse studies from an imaging facility (DICOMweb), import a downloaded record, and export everything as a standard FHIR bundle.
      </p>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Electronic health records (FHIR)</h3>
          <button onClick={() => setAdding(adding === "fhir" ? null : "fhir")} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
            {adding === "fhir" ? "cancel" : "+ connect"}
          </button>
        </div>
        {adding === "fhir" && <NewFhirConnection onDone={() => setAdding(null)} />}
        {fhir.length === 0 && adding !== "fhir" && <p className="text-ink-3">No portals connected.</p>}
        <div className="flex flex-col gap-2">
          {fhir.map((c) => (
            <FhirConnectionCard key={c.id} conn={c} />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Imaging facilities (DICOMweb)</h3>
          <button onClick={() => setAdding(adding === "dicomweb" ? null : "dicomweb")} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
            {adding === "dicomweb" ? "cancel" : "+ connect"}
          </button>
        </div>
        {adding === "dicomweb" && <NewDicomConnection onDone={() => setAdding(null)} />}
        {dicom.length === 0 && adding !== "dicomweb" && <p className="text-ink-3">No imaging servers connected.</p>}
        <div className="flex flex-col gap-2">
          {dicom.map((c) => (
            <DicomConnectionCard key={c.id} conn={c} />
          ))}
        </div>
      </section>

      <ImportExport />
    </div>
  );
}

// ---------------------------------------------------------------------------
function NewFhirConnection({ onDone }: { onDone: () => void }) {
  const [preset, setPreset] = useState(0);
  const [baseUrl, setBaseUrl] = useState(FHIR_PRESETS[0].baseUrl);
  const [label, setLabel] = useState(FHIR_PRESETS[0].label);
  const [authMode, setAuthMode] = useState<Connection["authMode"]>(FHIR_PRESETS[0].authMode);
  const [clientId, setClientId] = useState("");
  const [token, setToken] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const applyPreset = (i: number) => {
    setPreset(i);
    if (i >= 0 && FHIR_PRESETS[i]) {
      setBaseUrl(FHIR_PRESETS[i].baseUrl);
      setLabel(FHIR_PRESETS[i].label);
      setAuthMode(FHIR_PRESETS[i].authMode);
      setClientId(FHIR_PRESETS[i].clientId ?? "");
    }
  };

  const save = async () => {
    setErr(null);
    setBusy(true);
    try {
      const conn: Connection = { id: uid(), kind: "fhir", label: label || baseUrl, baseUrl: baseUrl.trim().replace(/\/+$/, ""), authMode, clientId: clientId.trim() || undefined };
      if (recordStore.get().connections.some((c) => c.kind === "fhir" && c.baseUrl === conn.baseUrl)) {
        throw new Error("That server is already connected below. Use its Sync or Log in button.");
      }
      if (authMode === "smart" && !conn.clientId) throw new Error("A client ID is required for SMART login.");
      if (authMode === "bearer" && !token.trim()) throw new Error("Paste an access token, or choose a different sign-in method.");
      const client = new FhirClient(conn.baseUrl, authMode === "bearer" ? token.trim() : undefined);
      await client.metadata(); // reachability check
      // Validate everything before saving, so a failed attempt leaves no half-made connection behind.
      const cfg = authMode === "smart" ? await client.smartConfiguration() : null;
      if (authMode === "smart" && !cfg?.authorization_endpoint) throw new Error("This server did not advertise SMART authorization endpoints.");
      if (authMode === "bearer") sessionStorage.setItem(`hypo.bearer.${conn.id}`, token.trim());
      recordStore.set((r) => ({ ...r, connections: [...r.connections, conn] }));
      if (authMode === "smart" && cfg) {
        window.location.href = await beginSmartLaunch(conn, cfg);
        return;
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <Field label="Start from">
        <select value={preset} onChange={(e) => applyPreset(Number(e.target.value))} className={inputCls}>
          {FHIR_PRESETS.map((p, i) => (
            <option key={p.baseUrl} value={i}>
              {p.label}
            </option>
          ))}
          <option value={-1}>Custom FHIR R4 server...</option>
        </select>
      </Field>
      {preset >= 0 && <p className="text-xs text-ink-3">{FHIR_PRESETS[preset].note.replace("{origin}", typeof window !== "undefined" ? window.location.origin : "")}</p>}
      <Field label="Name">
        <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
      </Field>
      <Field label="FHIR base URL">
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={inputCls} placeholder="https://.../api/FHIR/R4" />
      </Field>
      <Field label="Authentication">
        <select value={authMode} onChange={(e) => setAuthMode(e.target.value as Connection["authMode"])} className={inputCls}>
          <option value="none">Open server (no login)</option>
          <option value="smart">SMART on FHIR login (patient portal)</option>
          <option value="bearer">Paste an access token</option>
        </select>
      </Field>
      {authMode === "smart" && (
        <Field label="Client ID (registered with the portal's developer program)">
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputCls} placeholder="public client id" />
        </Field>
      )}
      {authMode === "bearer" && (
        <Field label="Access token (kept in this tab only)">
          <input value={token} onChange={(e) => setToken(e.target.value)} className={inputCls} type="password" />
        </Field>
      )}
      {err && <div className="text-xs text-[var(--critical)]">{err}</div>}
      <button onClick={save} disabled={busy || !baseUrl} className="rounded-lg bg-brand py-2 font-semibold text-brand-ink disabled:opacity-50">
        {busy ? "Checking..." : authMode === "smart" ? "Continue to portal login" : "Connect"}
      </button>
    </div>
  );
}

function FhirConnectionCard({ conn }: { conn: Connection }) {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const smart = conn.authMode === "smart" ? loadSmartTokens(conn.id) : undefined;
  const bearer = conn.authMode === "bearer" ? sessionStorage.getItem(`hypo.bearer.${conn.id}`) ?? undefined : undefined;
  const token = smart?.access_token ?? bearer;
  const patientId = conn.patientId ?? smart?.patient;
  const needsLogin = conn.authMode === "smart" && !smart;

  const client = () => new FhirClient(conn.baseUrl, token);

  const relogin = async () => {
    const cfg = await client().smartConfiguration();
    if (!cfg?.authorization_endpoint) return setLog(["Server did not advertise SMART endpoints."]);
    window.location.href = await beginSmartLaunch(conn, cfg);
  };

  const findPatients = async () => {
    setBusy(true);
    setLog([]);
    try {
      setPatients(await client().searchPatients(search || "a"));
    } catch (e) {
      setLog([e instanceof Error ? e.message : String(e)]);
    } finally {
      setBusy(false);
    }
  };

  const sync = async (pid = patientId) => {
    if (!pid) return;
    setBusy(true);
    setLog(["Starting sync..."]);
    try {
      const summary = await client().pullEverything(pid, (m) => setLog((l) => [...l.slice(-8), m]));
      const imp = mapFhirToRecord(summary, conn.label);
      recordStore.set((r) => mergeFhirImport({ ...r, connections: r.connections.map((c) => (c.id === conn.id ? { ...c, patientId: pid } : c)) }, imp, conn));
      setLog((l) => [...l, `Done: ${Object.entries(imp.counts).map(([k, v]) => `${v} ${k}`).join(", ")}.`]);
      setPatients(null);
    } catch (e) {
      setLog((l) => [...l, `Failed: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    clearSmartTokens(conn.id);
    sessionStorage.removeItem(`hypo.bearer.${conn.id}`);
    recordStore.set((r) => removeConnectionData(r, conn.id));
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">🏥 {conn.label}</div>
          <div className="truncate text-[11px] text-ink-3">{conn.baseUrl}</div>
          <div className="mt-0.5 text-xs text-ink-2">
            {conn.lastSync ? `Synced ${new Date(conn.lastSync).toLocaleString()}` : "Not synced yet"}
            {conn.counts ? ` · ${Object.entries(conn.counts).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(", ")}` : ""}
          </div>
        </div>
        <button onClick={remove} className="text-xs text-ink-3 hover:text-[var(--critical)]">
          disconnect
        </button>
      </div>

      {needsLogin ? (
        <button onClick={relogin} className="mt-2 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-ink">
          Log in to portal
        </button>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {!patientId || patients ? (
            <div>
              <div className="flex gap-2">
                <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && findPatients()} className={inputCls} placeholder="Patient name to search (sandbox)" />
                <button onClick={findPatients} disabled={busy} className="shrink-0 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-surface-2 disabled:opacity-50">
                  Search
                </button>
              </div>
              {patients && (
                <ul className="mt-2 max-h-48 overflow-auto rounded-lg border border-border">
                  {patients.length === 0 && <li className="p-2 text-xs text-ink-3">No patients found.</li>}
                  {patients.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 border-b border-border/60 px-2 py-1.5 text-xs last:border-0">
                      <span>
                        <span className="font-medium">{patientDisplayName(p)}</span>
                        <span className="text-ink-3">
                          {" "}
                          · {p.gender ?? "?"} · {p.birthDate ?? "?"} · id {p.id}
                        </span>
                      </span>
                      <button onClick={() => sync(p.id)} disabled={busy} className="rounded bg-brand px-2 py-0.5 font-semibold text-brand-ink disabled:opacity-50">
                        Pull
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => sync()} disabled={busy} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:opacity-50">
                {busy ? "Syncing..." : "Sync now"}
              </button>
              <button onClick={() => bus.send({ text: "What's in my chart from the EHR you just pulled? Give me the plain-English summary: conditions, meds, anything flagged in labs, and what I should follow up on." })} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-2">
                Summarize my chart
              </button>
              {conn.authMode === "none" && (
                <button onClick={() => setPatients([])} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-2">
                  Change patient
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {log.length > 0 && (
        <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-[11px] text-ink-2">{log.join("\n")}</pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function NewDicomConnection({ onDone }: { onDone: () => void }) {
  const [preset, setPreset] = useState(0);
  const [baseUrl, setBaseUrl] = useState(DICOM_PRESETS[0].baseUrl);
  const [label, setLabel] = useState(DICOM_PRESETS[0].label);
  const [token, setToken] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const conn: Connection = { id: uid(), kind: "dicomweb", label: label || baseUrl, baseUrl: baseUrl.replace(/\/+$/, ""), authMode: token ? "bearer" : "none" };
      await new DicomWebClient(conn.baseUrl, token || undefined).studies({ limit: 1 });
      if (token) sessionStorage.setItem(`hypo.bearer.${conn.id}`, token);
      recordStore.set((r) => ({ ...r, connections: [...r.connections, conn] }));
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <Field label="Start from">
        <select
          value={preset}
          onChange={(e) => {
            const i = Number(e.target.value);
            setPreset(i);
            if (DICOM_PRESETS[i]) {
              setBaseUrl(DICOM_PRESETS[i].baseUrl);
              setLabel(DICOM_PRESETS[i].label);
            }
          }}
          className={inputCls}
        >
          {DICOM_PRESETS.map((p, i) => (
            <option key={p.baseUrl} value={i}>
              {p.label}
            </option>
          ))}
          <option value={-1}>Custom DICOMweb server...</option>
        </select>
      </Field>
      {preset >= 0 && <p className="text-xs text-ink-3">{DICOM_PRESETS[preset].note}</p>}
      <Field label="Name">
        <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
      </Field>
      <Field label="DICOMweb base URL">
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={inputCls} placeholder="https://pacs.example.org/dicom-web" />
      </Field>
      <Field label="Bearer token (optional)">
        <input value={token} onChange={(e) => setToken(e.target.value)} className={inputCls} type="password" />
      </Field>
      {err && <div className="text-xs text-[var(--critical)]">{err}</div>}
      <button onClick={save} disabled={busy || !baseUrl} className="rounded-lg bg-brand py-2 font-semibold text-brand-ink disabled:opacity-50">
        {busy ? "Checking..." : "Connect"}
      </button>
    </div>
  );
}

function DicomConnectionCard({ conn }: { conn: Connection }) {
  const r = useRecord();
  const [studies, setStudies] = useState<DicomStudy[] | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const token = sessionStorage.getItem(`hypo.bearer.${conn.id}`) ?? undefined;
  const client = useRef(new DicomWebClient(conn.baseUrl, token));
  const imported = new Set(r.labs.filter((l) => l.imaging).map((l) => l.imaging!.studyUid));

  const browse = async () => {
    setBusy(true);
    setErr(null);
    try {
      setStudies(await client.current.studies({ patientName: filter || undefined, limit: 60 }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const importStudy = (s: DicomStudy) => {
    const panel: LabPanel = {
      id: `dicom-${s.studyUid}`,
      date: s.date ?? new Date().toISOString().slice(0, 10),
      kind: "imaging",
      source: `${conn.label}: ${s.modalities?.join("/") ?? ""} ${s.description ?? "study"}`.trim(),
      source_system: "dicom",
      summary: `${s.modalities?.join("/") ?? "Imaging"} study${s.description ? `: ${s.description}` : ""}${s.patientName ? ` (${s.patientName})` : ""}. ${s.seriesCount ?? "?"} series, ${s.instanceCount ?? "?"} images. Radiology report not included in the DICOM transfer - ask the facility for the read.`,
      results: [],
      imaging: { studyUid: s.studyUid, modality: s.modalities?.join("/"), description: s.description, seriesCount: s.seriesCount, instanceCount: s.instanceCount, server: conn.baseUrl },
    };
    recordStore.set((r) => ({
      ...r,
      labs: [...r.labs.filter((l) => l.id !== panel.id), panel],
      connections: r.connections.map((c) => (c.id === conn.id ? { ...c, lastSync: new Date().toISOString(), counts: { studies: (c.counts?.studies ?? 0) + 1 } } : c)),
    }));
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">🩻 {conn.label}</div>
          <div className="truncate text-[11px] text-ink-3">{conn.baseUrl}</div>
        </div>
        <button
          onClick={() => {
            sessionStorage.removeItem(`hypo.bearer.${conn.id}`);
            recordStore.set((r) => ({ ...r, connections: r.connections.filter((c) => c.id !== conn.id) }));
          }}
          className="text-xs text-ink-3 hover:text-[var(--critical)]"
        >
          disconnect
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === "Enter" && browse()} className={inputCls} placeholder="Patient name filter (optional)" />
        <button onClick={browse} disabled={busy} className="shrink-0 rounded-lg bg-brand px-3 text-xs font-semibold text-brand-ink disabled:opacity-50">
          {busy ? "Loading..." : "Browse studies"}
        </button>
      </div>
      {err && <div className="mt-1 text-xs text-[var(--critical)]">{err}</div>}
      {studies && (
        <ul className="mt-2 max-h-72 overflow-auto rounded-lg border border-border">
          {studies.length === 0 && <li className="p-2 text-xs text-ink-3">No studies returned.</li>}
          {studies.map((s) => (
            <li key={s.studyUid} className="flex items-center justify-between gap-2 border-b border-border/60 px-2 py-1.5 text-xs last:border-0">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {s.modalities?.join("/") ?? "?"} · {s.description ?? "(no description)"}
                </div>
                <div className="truncate text-ink-3">
                  {s.date ?? "no date"} · {s.patientName ?? "anonymous"} · {s.seriesCount ?? "?"} series / {s.instanceCount ?? "?"} img
                </div>
              </div>
              <button onClick={() => importStudy(s)} className={`shrink-0 rounded px-2 py-0.5 font-semibold ${imported.has(s.studyUid) ? "border border-border text-ink-3" : "bg-brand text-brand-ink"}`}>
                {imported.has(s.studyUid) ? "Imported" : "Import"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-ink-3">Imported studies appear under Labs &amp; Imaging, where you can preview frames and ask about them.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ImportExport() {
  const r = useRecord();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  useEffect(() => {
    if (!confirmWipe) return;
    const t = setTimeout(() => setConfirmWipe(false), 4000);
    return () => clearTimeout(t);
  }, [confirmWipe]);

  const download = (name: string, data: string, type = "application/json") => {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importFile = async (f: File) => {
    setMsg(null);
    try {
      const text = await f.text();
      if (/\.(csv|tsv|txt)$/i.test(f.name) || f.type.includes("csv") || f.type.includes("tab-separated")) {
        const res = parseCsvVitals(text, f.name);
        if (!res.entries.length) {
          setMsg(`No readings found in ${f.name}. Recognized columns: ${Object.values(res.columns).join(", ") || "none"}. Need a date column plus e.g. systolic/diastolic, glucose, weight, SpO2, temp, sleep, steps.`);
          return;
        }
        recordStore.set((rec) => ({ ...rec, journal: [...rec.journal.filter((e) => !res.entries.some((n) => n.ts === e.ts && e.source === "import")), ...res.entries] }));
        setMsg(`Imported ${res.entries.length} readings from ${f.name} (${Object.entries(res.columns).map(([k, v]) => `${v}→${k}`).join(", ")})${res.skipped ? `; skipped ${res.skipped} rows` : ""}.`);
        return;
      }
      const json = JSON.parse(text);
      if (json?.resourceType === "Bundle") {
        const conn: Connection = { id: uid(), kind: "fhir", label: `Imported: ${f.name}`, baseUrl: "file://" + f.name, authMode: "none" };
        const imp = mapFhirToRecord(bundleToSummary(json), conn.label);
        recordStore.set((rec) => mergeFhirImport({ ...rec, connections: [...rec.connections, conn] }, imp, conn));
        setMsg(`Imported FHIR bundle: ${Object.entries(imp.counts).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(", ")}.`);
      } else if (json?.version === 1 && json.profile) {
        recordStore.set(() => migrateRecord(json));
        setMsg("Restored Hypochondriac record.");
      } else {
        setMsg("Unrecognized file. Expected a FHIR Bundle or a Hypochondriac export.");
      }
    } catch (e) {
      setMsg(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Import / export</h3>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json,.csv,.tsv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap gap-2">
        <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-2">
          📥 Import FHIR bundle, CSV readings, or backup
        </button>
        <button onClick={() => download(`hypochondriac-fhir-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(recordToFhirBundle(r), null, 2), "application/fhir+json")} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-2">
          📤 Export as FHIR bundle
        </button>
        <button onClick={() => download(`hypochondriac-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(r, null, 2))} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-2">
          💾 Backup
        </button>
        <button
          onClick={() => {
            if (!confirmWipe) return setConfirmWipe(true);
            recordStore.set(() => EMPTY_RECORD);
            setConfirmWipe(false);
            setMsg("Record erased from this browser.");
          }}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${confirmWipe ? "border-[var(--critical)] bg-[var(--critical)] text-white" : "border-border text-ink-3 hover:bg-surface-2"}`}
        >
          {confirmWipe ? "Click again to erase everything" : "🗑️ Erase record"}
        </button>
      </div>
      {msg && <div className="mt-2 text-xs text-ink-2">{msg}</div>}
      <p className="mt-2 text-[11px] text-ink-3">
        Everything lives in this browser&apos;s storage. Access tokens live only in this tab&apos;s session. Nothing is sent anywhere except to the AI model for the conversation and to the servers you connect.
      </p>
    </section>
  );
}
