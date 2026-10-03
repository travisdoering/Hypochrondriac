/**
 * MedlinePlus Connect (NIH / National Library of Medicine) - authoritative,
 * plain-language patient education by code. Public, no key.
 * https://medlineplus.gov/medlineplus-connect/web-service/
 *
 * Supported code systems: ICD-10-CM (diagnoses), SNOMED CT, RxNorm / NDC
 * (medications), LOINC (lab tests), CPT (procedures).
 */

export type EduCodeSystem = "icd10cm" | "snomed" | "rxnorm" | "ndc" | "loinc" | "cpt";

const OIDS: Record<EduCodeSystem, string> = {
  icd10cm: "2.16.840.1.113883.6.90",
  snomed: "2.16.840.1.113883.6.96",
  rxnorm: "2.16.840.1.113883.6.88",
  ndc: "2.16.840.1.113883.6.69",
  loinc: "2.16.840.1.113883.6.1",
  cpt: "2.16.840.1.113883.6.12",
};

export interface EduEntry {
  title: string;
  url: string;
  summary: string;
}

export interface EduResult {
  codeSystem: EduCodeSystem;
  code: string;
  entries: EduEntry[];
}

interface MlpFeed {
  feed?: {
    entry?: { title?: { _value?: string }; link?: { href?: string }[]; summary?: { _value?: string } }[];
  };
}

export async function patientEducation(codeSystem: EduCodeSystem, code: string, displayName?: string): Promise<EduResult> {
  const params = new URLSearchParams({
    "mainSearchCriteria.v.cs": OIDS[codeSystem],
    "mainSearchCriteria.v.c": code.trim(),
    "knowledgeResponseType": "application/json",
    "informationRecipient.languageCode.c": "en",
  });
  if (displayName) params.set("mainSearchCriteria.v.dn", displayName);
  const res = await fetch(`https://connect.medlineplus.gov/service?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`MedlinePlus Connect returned ${res.status}`);
  const data = (await res.json()) as MlpFeed;
  const entries: EduEntry[] = (data.feed?.entry ?? []).slice(0, 4).map((e) => ({
    title: e.title?._value ?? "MedlinePlus",
    url: e.link?.[0]?.href ?? "https://medlineplus.gov/",
    summary: stripHtml(e.summary?._value ?? "").slice(0, 1500),
  }));
  return { codeSystem, code, entries };
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function eduToText(r: EduResult): string {
  if (!r.entries.length) return `MedlinePlus has no page for ${r.codeSystem} ${r.code}. Try a parent code or a different code system.`;
  return r.entries.map((e) => `${e.title}\n${e.url}\n${e.summary}`).join("\n\n---\n\n");
}
