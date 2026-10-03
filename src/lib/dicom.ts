/**
 * DICOMweb (QIDO-RS + WADO-RS) client for imaging facilities / PACS.
 * Everything goes through /api/dicomweb to avoid CORS.
 */

type DicomJson = Record<string, { vr: string; Value?: unknown[]; BulkDataURI?: string }>;

export interface DicomStudy {
  studyUid: string;
  date?: string; // YYYY-MM-DD
  description?: string;
  modalities?: string[];
  patientName?: string;
  patientId?: string;
  accession?: string;
  seriesCount?: number;
  instanceCount?: number;
}
export interface DicomSeries {
  seriesUid: string;
  number?: number;
  description?: string;
  modality?: string;
  instanceCount?: number;
  bodyPart?: string;
}
export interface DicomInstance {
  sopUid: string;
  number?: number;
}

function tag(ds: DicomJson, t: string): unknown[] | undefined {
  return ds[t]?.Value;
}
function str(ds: DicomJson, t: string): string | undefined {
  const v = tag(ds, t)?.[0];
  if (v == null) return undefined;
  if (typeof v === "object" && v && "Alphabetic" in (v as Record<string, unknown>)) {
    return String((v as { Alphabetic?: string }).Alphabetic ?? "").replace(/\^/g, " ").trim();
  }
  return String(v);
}
function num(ds: DicomJson, t: string): number | undefined {
  const v = tag(ds, t)?.[0];
  return typeof v === "number" ? v : v != null && !Number.isNaN(Number(v)) ? Number(v) : undefined;
}
function fmtDate(d?: string): string | undefined {
  if (!d || d.length < 8) return d;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

export class DicomWebClient {
  constructor(
    public baseUrl: string,
    private token?: string,
  ) {}

  private url(path: string, params: Record<string, string> = {}, accept?: string) {
    const u = new URLSearchParams({ base: this.baseUrl, path });
    if (accept) u.set("accept", accept);
    for (const [k, v] of Object.entries(params)) u.set(k, v);
    return `/api/dicomweb?${u.toString()}`;
  }

  private async json(path: string, params: Record<string, string> = {}): Promise<DicomJson[]> {
    const res = await fetch(this.url(path, params), { headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined });
    if (res.status === 204) return [];
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    if (!text.trim()) return [];
    return JSON.parse(text) as DicomJson[];
  }

  async studies(opts: { patientName?: string; patientId?: string; limit?: number; offset?: number } = {}): Promise<DicomStudy[]> {
    const params: Record<string, string> = { limit: String(opts.limit ?? 50), offset: String(opts.offset ?? 0) };
    if (opts.patientName) params.PatientName = `*${opts.patientName}*`;
    if (opts.patientId) params.PatientID = opts.patientId;
    params.includefield = "00081030,00080061,00201206,00201208,00080050";
    const list = await this.json("studies", params);
    return list.map((ds) => ({
      studyUid: str(ds, "0020000D") ?? "",
      date: fmtDate(str(ds, "00080020")),
      description: str(ds, "00081030"),
      modalities: (tag(ds, "00080061") as string[] | undefined) ?? (str(ds, "00080060") ? [str(ds, "00080060")!] : undefined),
      patientName: str(ds, "00100010"),
      patientId: str(ds, "00100020"),
      accession: str(ds, "00080050"),
      seriesCount: num(ds, "00201206"),
      instanceCount: num(ds, "00201208"),
    })).filter((s) => s.studyUid);
  }

  async series(studyUid: string): Promise<DicomSeries[]> {
    const list = await this.json(`studies/${studyUid}/series`, { includefield: "0008103E,00201209,00180015" });
    return list
      .map((ds) => ({
        seriesUid: str(ds, "0020000E") ?? "",
        number: num(ds, "00200011"),
        description: str(ds, "0008103E"),
        modality: str(ds, "00080060"),
        instanceCount: num(ds, "00201209"),
        bodyPart: str(ds, "00180015"),
      }))
      .filter((s) => s.seriesUid)
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  }

  async instances(studyUid: string, seriesUid: string): Promise<DicomInstance[]> {
    const list = await this.json(`studies/${studyUid}/series/${seriesUid}/instances`, { includefield: "00200013" });
    return list
      .map((ds) => ({ sopUid: str(ds, "00080018") ?? "", number: num(ds, "00200013") }))
      .filter((i) => i.sopUid)
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  }

  /** URL (through the proxy) for a rendered JPEG of an instance frame. */
  renderedUrl(studyUid: string, seriesUid: string, sopUid: string, opts: { viewport?: string; quality?: number } = {}): string {
    const params: Record<string, string> = {};
    if (opts.viewport) params.viewport = opts.viewport;
    if (opts.quality) params.quality = String(opts.quality);
    return this.url(`studies/${studyUid}/series/${seriesUid}/instances/${sopUid}/rendered`, params, "image/jpeg");
  }

  /** Fetch a rendered frame as a base64 JPEG (for sending to the model). */
  async renderedBase64(studyUid: string, seriesUid: string, sopUid: string): Promise<{ data: string; mediaType: "image/jpeg" | "image/png" }> {
    const res = await fetch(this.renderedUrl(studyUid, seriesUid, sopUid, { viewport: "1024,1024" }), { headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined });
    if (!res.ok) throw new Error(`Rendered image failed: ${res.status}`);
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    const buf = new Uint8Array(await res.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { data: btoa(s), mediaType: ct.includes("png") ? "image/png" : "image/jpeg" };
  }
}

/** The bearer token (kept in this tab's sessionStorage) for the connection serving `server`, if any. */
export function dicomTokenFor(connections: { id: string; kind: string; baseUrl: string }[], server: string): string | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  const norm = (u: string) => u.replace(/\/+$/, "");
  const conn = connections.find((c) => c.kind === "dicomweb" && norm(c.baseUrl) === norm(server));
  if (!conn) return undefined;
  try {
    return sessionStorage.getItem(`hypo.bearer.${conn.id}`) ?? undefined;
  } catch {
    return undefined;
  }
}

export const DICOM_PRESETS: { label: string; baseUrl: string; note: string }[] = [
  {
    label: "Orthanc public demo (DICOMweb, open)",
    baseUrl: "https://demo.orthanc-server.com/dicom-web",
    note: "Anonymized sample studies (CT, MR, CR). Supports rendered images.",
  },
  {
    label: "Local Orthanc (default install)",
    baseUrl: "http://localhost:8042/dicom-web",
    note: "If you run Orthanc locally with the DICOMweb plugin.",
  },
];
