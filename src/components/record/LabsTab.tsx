"use client";

import { useMemo, useState } from "react";
import { recordStore, useRecord } from "@/lib/store";
import type { LabPanel, LabResult } from "@/lib/record";
import { findLabRef } from "@/lib/labs-reference";
import { Sparkline } from "../Sparkline";
import { bus } from "@/lib/bus";
import { fmtDay, Tag } from "./JournalTab";
import { DicomWebClient } from "@/lib/dicom";
import { uid, fmtNum } from "@/lib/record";

const FLAG_COLOR: Record<NonNullable<LabResult["flag"]>, string> = {
  normal: "var(--good)",
  low: "var(--warning)",
  high: "var(--warning)",
  abnormal: "var(--serious)",
  "critical-low": "var(--critical)",
  "critical-high": "var(--critical)",
};
const FLAG_ICON: Record<NonNullable<LabResult["flag"]>, string> = {
  normal: "✓",
  low: "↓",
  high: "↑",
  abnormal: "!",
  "critical-low": "↓↓",
  "critical-high": "↑↑",
};

export function LabsTab() {
  const r = useRecord();
  const [openId, setOpenId] = useState<string | null>(null);
  const panels = useMemo(() => [...r.labs].sort((a, b) => b.date.localeCompare(a.date)), [r.labs]);

  // Trend lines per analyte across panels.
  const trends = useMemo(() => {
    const m = new Map<string, { label: string; pts: { x: number; y: number; unit?: string; refLow?: number; refHigh?: number }[] }>();
    for (const p of r.labs) {
      for (const x of p.results) {
        if (typeof x.value !== "number") continue;
        const key = (findLabRef(x.name)?.aliases[0] ?? x.name).toLowerCase();
        const cur = m.get(key) ?? { label: x.name, pts: [] };
        cur.pts.push({ x: new Date(p.date).getTime(), y: x.value, unit: x.unit, refLow: x.refLow, refHigh: x.refHigh });
        m.set(key, cur);
      }
    }
    return [...m.entries()].filter(([, v]) => v.pts.length >= 2).sort((a, b) => b[1].pts.length - a[1].pts.length);
  }, [r.labs]);

  if (panels.length === 0)
    return (
      <div className="text-sm text-ink-3">
        <p>No lab or imaging results yet.</p>
        <ul className="mt-2 list-disc pl-5">
          <li>Snap a photo or upload the PDF of a lab report in the chat and I&apos;ll translate it and file it here.</li>
          <li>Paste the text of a radiology report.</li>
          <li>Connect your patient portal under <span className="font-semibold text-ink-2">Connections</span> to pull results automatically.</li>
        </ul>
      </div>
    );

  return (
    <div className="flex flex-col gap-4 text-sm">
      {trends.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Trends across reports</h3>
          <div className="grid grid-cols-1 gap-2">
            {trends.slice(0, 10).map(([name, { label, pts }]) => {
              const ref = findLabRef(name);
              const last = pts[pts.length - 1];
              return (
                <div key={name} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-[var(--chart-surface)] px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold" title={ref?.plain}>{label}</div>
                    <div className="text-[11px] text-ink-3">{pts.length} results · latest {fmtNum(last.y)} {last.unit ?? ref?.unit ?? ""}</div>
                  </div>
                  <Sparkline points={pts} width={150} height={44} refLow={last.refLow ?? ref?.low} refHigh={last.refHigh ?? ref?.high} showLast={false} />
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Reports</h3>
        {panels.map((p) => (
          <PanelCard key={p.id} p={p} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} />
        ))}
      </section>
    </div>
  );
}

function PanelCard({ p, open, onToggle }: { p: LabPanel; open: boolean; onToggle: () => void }) {
  const flagged = p.results.filter((x) => x.flag && x.flag !== "normal");
  const critical = p.results.filter((x) => x.flag?.startsWith("critical"));
  const [thumbs, setThumbs] = useState<string[] | null>(null);
  const [loadingThumbs, setLoadingThumbs] = useState(false);

  const explain = () => {
    const body = panelToText(p);
    bus.send({
      text: `Walk me through this ${p.kind === "imaging" ? "imaging report" : "lab panel"} from ${p.date}${p.source ? ` (${p.source})` : ""}. What matters, what doesn't, and what should I ask about?`,
      extra: `The person clicked "Explain" on a saved report. Here is the full saved content:\n${body}\nDo not call record_lab_panel again for this one - it is already saved.`,
    });
  };

  const askAboutImages = async () => {
    if (!p.imaging?.server) return;
    setLoadingThumbs(true);
    try {
      const c = new DicomWebClient(p.imaging.server);
      const series = await c.series(p.imaging.studyUid);
      const atts = [];
      for (const s of series.slice(0, 3)) {
        const inst = await c.instances(p.imaging.studyUid, s.seriesUid);
        if (!inst.length) continue;
        const mid = inst[Math.floor(inst.length / 2)];
        const img = await c.renderedBase64(p.imaging.studyUid, s.seriesUid, mid.sopUid);
        atts.push({ id: uid(), kind: "image" as const, name: `${s.modality ?? ""} ${s.description ?? "series"}.jpg`, mediaType: img.mediaType, data: `data:${img.mediaType};base64,${img.data}`, origin: "imaging" as const });
      }
      bus.send({
        text: `These are frames from my ${p.imaging.modality ?? ""} ${p.imaging.description ?? "imaging study"} (${p.date}). Can you describe what you see in plain language? I know the radiologist's read is what counts.`,
        attachments: atts,
        extra: "These images were pulled from the person's imaging facility over DICOMweb. Describe anatomy and anything visually notable in plain language, be explicit that a single rendered frame is not a diagnostic read, and point them to the radiology report / ordering clinician for the actual interpretation.",
      });
    } finally {
      setLoadingThumbs(false);
    }
  };

  const loadThumbs = async () => {
    if (!p.imaging?.server || thumbs) return;
    setLoadingThumbs(true);
    try {
      const c = new DicomWebClient(p.imaging.server);
      const series = await c.series(p.imaging.studyUid);
      const urls: string[] = [];
      for (const s of series.slice(0, 6)) {
        const inst = await c.instances(p.imaging.studyUid, s.seriesUid);
        if (inst.length) urls.push(c.renderedUrl(p.imaging.studyUid, s.seriesUid, inst[Math.floor(inst.length / 2)].sopUid, { viewport: "256,256" }));
      }
      setThumbs(urls);
    } catch {
      setThumbs([]);
    } finally {
      setLoadingThumbs(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface">
      <button
        onClick={() => {
          onToggle();
          if (!open && p.imaging) void loadThumbs();
        }}
        className="flex w-full items-start justify-between gap-2 p-3 text-left"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold">{p.kind === "imaging" ? "🩻" : "🧪"} {p.source ?? (p.kind === "imaging" ? "Imaging" : "Lab panel")}</span>
            {p.source_system === "fhir" && <Tag>from EHR</Tag>}
            {p.source_system === "dicom" && <Tag>from imaging</Tag>}
          </div>
          <div className="text-xs text-ink-3">
            {fmtDay(p.date)} · {p.results.length ? `${p.results.length} values` : p.imaging ? `${p.imaging.seriesCount ?? "?"} series` : "report"}
            {flagged.length ? ` · ${flagged.length} flagged` : ""}
          </div>
          {p.summary && !open && <div className="mt-1 line-clamp-2 text-xs text-ink-2">{p.summary}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {critical.length > 0 && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: "var(--critical)" }}>critical</span>}
          <span className="text-ink-3">{open ? "▴" : "▾"}</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-border p-3">
          {p.summary && <p className="mb-3 text-ink-2">{p.summary}</p>}
          {p.results.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-ink-3">
                  <th className="pb-1 font-medium">Test</th>
                  <th className="pb-1 text-right font-medium">Result</th>
                  <th className="pb-1 pl-2 font-medium">Range</th>
                  <th className="pb-1 pl-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {p.results.map((x, i) => {
                  const ref = findLabRef(x.name);
                  const flag = x.flag ?? inferFlag(x, ref?.low, ref?.high);
                  return (
                    <tr key={i} className="border-t border-border/60 align-top" title={x.explanation ?? ref?.plain}>
                      <td className="py-1.5 pr-2">
                        <div className="font-medium text-ink">{x.name}</div>
                        {(x.explanation ?? ref?.plain) && <div className="text-[11px] text-ink-3">{x.explanation ?? ref?.plain}</div>}
                      </td>
                      <td className="py-1.5 text-right font-semibold tabular-nums text-ink">
                        {fmtNum(x.value)} <span className="font-normal text-ink-3">{x.unit ?? ""}</span>
                      </td>
                      <td className="py-1.5 pl-2 tabular-nums text-ink-3">{x.refText ?? (x.refLow != null || x.refHigh != null ? `${x.refLow ?? ""}–${x.refHigh ?? ""}` : ref?.low != null || ref?.high != null ? `~${ref.low ?? ""}–${ref.high ?? ""}` : "")}</td>
                      <td className="py-1.5 pl-2">
                        {flag && (
                          <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: FLAG_COLOR[flag] }}>
                            {FLAG_ICON[flag]} {flag.replace("-", " ")}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {p.imaging && (
            <div className="mt-2">
              <div className="text-xs text-ink-2">
                {p.imaging.modality} {p.imaging.description} · {p.imaging.seriesCount ?? "?"} series, {p.imaging.instanceCount ?? "?"} images
              </div>
              {loadingThumbs && <div className="mt-1 text-xs text-ink-3">Loading images...</div>}
              {thumbs && thumbs.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {thumbs.map((u) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={u} src={u} alt="imaging series preview" className="h-20 w-20 rounded-lg border border-border bg-black object-contain" loading="lazy" />
                  ))}
                </div>
              )}
            </div>
          )}
          {p.rawText && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-ink-3">Report text</summary>
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-[11px] text-ink-2">{p.rawText}</pre>
            </details>
          )}
          {p.questionsForDoctor && p.questionsForDoctor.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-ink-3">Questions to ask</div>
              <ul className="mt-1 list-disc pl-5 text-xs text-ink-2">
                {p.questionsForDoctor.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={explain} className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-brand-ink">
              💬 Explain this
            </button>
            {p.imaging?.server && (
              <button onClick={askAboutImages} disabled={loadingThumbs} className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-surface-2 disabled:opacity-50">
                👁️ Ask about the images
              </button>
            )}
            <button
              onClick={() => recordStore.set((r) => ({ ...r, labs: r.labs.filter((x) => x.id !== p.id) }))}
              className="ml-auto rounded-lg px-2 py-1 text-xs text-ink-3 hover:text-[var(--critical)]"
            >
              delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function inferFlag(x: LabResult, low?: number, high?: number): LabResult["flag"] | undefined {
  if (typeof x.value !== "number") return undefined;
  const lo = x.refLow ?? low;
  const hi = x.refHigh ?? high;
  if (lo != null && x.value < lo) return "low";
  if (hi != null && x.value > hi) return "high";
  if (lo != null || hi != null) return "normal";
  return undefined;
}

export function panelToText(p: LabPanel): string {
  const lines = [`${p.kind.toUpperCase()} - ${p.date}${p.source ? ` - ${p.source}` : ""}`];
  if (p.summary) lines.push(`Summary: ${p.summary}`);
  for (const x of p.results) lines.push(`${x.name}: ${fmtNum(x.value)}${x.unit ? " " + x.unit : ""}${x.refText || x.refLow != null || x.refHigh != null ? ` (ref ${x.refText ?? `${x.refLow ?? ""}-${x.refHigh ?? ""}`})` : ""}${x.flag ? ` [${x.flag}]` : ""}`);
  if (p.rawText) lines.push(`Report text:\n${p.rawText.slice(0, 8000)}`);
  return lines.join("\n");
}
