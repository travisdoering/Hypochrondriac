/**
 * openFDA drug label lookup (public, no key required for light use).
 * https://open.fda.gov/apis/drug/label/
 * Returns the sections a patient actually needs: what it's for, how it's
 * taken, boxed warning, key warnings, interactions, pregnancy, and the
 * "stop use and ask a doctor" list for OTC products.
 */

export interface DrugInfo {
  query: string;
  brandNames: string[];
  genericNames: string[];
  route?: string[];
  productType?: string[];
  indications?: string;
  dosage?: string;
  boxedWarning?: string;
  warnings?: string;
  interactions?: string;
  contraindications?: string;
  pregnancy?: string;
  stopUse?: string;
  adverseReactions?: string;
  doNotUse?: string;
  askDoctor?: string;
  askPharmacist?: string;
  whenUsing?: string;
  activeIngredient?: string;
  sourceUrl: string;
}

interface OpenFdaLabel {
  openfda?: { brand_name?: string[]; generic_name?: string[]; route?: string[]; product_type?: string[] };
  indications_and_usage?: string[];
  dosage_and_administration?: string[];
  boxed_warning?: string[];
  warnings?: string[];
  warnings_and_cautions?: string[];
  drug_interactions?: string[];
  contraindications?: string[];
  pregnancy?: string[];
  pregnancy_or_breast_feeding?: string[];
  stop_use?: string[];
  adverse_reactions?: string[];
  purpose?: string[];
  do_not_use?: string[];
  ask_doctor?: string[];
  ask_doctor_or_pharmacist?: string[];
  when_using?: string[];
  active_ingredient?: string[];
}

function clip(s?: string[], max = 1200): string | undefined {
  if (!s?.length) return undefined;
  const t = s.join("\n").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "..." : t;
}

export async function lookupDrug(name: string): Promise<DrugInfo | null> {
  const q = name.trim().replace(/[^\w\s-]/g, "");
  if (!q) return null;
  const search = encodeURIComponent(`openfda.generic_name:"${q}"+openfda.brand_name:"${q}"+openfda.substance_name:"${q}"`);
  const url = `https://api.fda.gov/drug/label.json?search=${search}&limit=5`;
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`openFDA returned ${res.status}`);
  const data = (await res.json()) as { results?: OpenFdaLabel[] };
  const results = data.results ?? [];
  if (!results.length) return null;
  // Prefer a label that has indications and the richest content.
  const best = [...results].sort((a, b) => score(b) - score(a))[0];
  return {
    query: name,
    brandNames: uniq(results.flatMap((r) => r.openfda?.brand_name ?? [])).slice(0, 6),
    genericNames: uniq(results.flatMap((r) => r.openfda?.generic_name ?? [])).slice(0, 4),
    route: uniq(best.openfda?.route ?? []),
    productType: uniq(best.openfda?.product_type ?? []),
    indications: clip(best.indications_and_usage ?? best.purpose),
    dosage: clip(best.dosage_and_administration, 900),
    boxedWarning: clip(best.boxed_warning, 900),
    warnings: clip(best.warnings_and_cautions ?? best.warnings, 1200),
    interactions: clip(best.drug_interactions, 1000),
    contraindications: clip(best.contraindications, 600),
    pregnancy: clip(best.pregnancy ?? best.pregnancy_or_breast_feeding, 500),
    stopUse: clip(best.stop_use, 500),
    adverseReactions: clip(best.adverse_reactions, 700),
    doNotUse: clip(best.do_not_use, 500),
    askDoctor: clip(best.ask_doctor, 600),
    askPharmacist: clip(best.ask_doctor_or_pharmacist, 400),
    whenUsing: clip(best.when_using, 400),
    activeIngredient: clip(best.active_ingredient, 200),
    sourceUrl: `https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(q)}`,
  };
}

function score(r: OpenFdaLabel): number {
  return (
    (r.indications_and_usage ? 3 : 0) +
    (r.warnings || r.warnings_and_cautions ? 2 : 0) +
    (r.drug_interactions ? 2 : 0) +
    (r.dosage_and_administration ? 1 : 0) +
    (r.boxed_warning ? 1 : 0)
  );
}

function uniq(a: string[]): string[] {
  const seen = new Set<string>();
  return a.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function drugInfoToText(d: DrugInfo | null, name: string): string {
  if (!d) return `No FDA label found for "${name}". It may be a supplement, a non-US product, or spelled differently. Answer from general knowledge and say so.`;
  const lines = [
    `FDA LABEL for ${d.genericNames.join(", ") || d.query}${d.brandNames.length ? ` (brands: ${d.brandNames.join(", ")})` : ""}${d.route?.length ? ` - ${d.route.join("/")}` : ""}${d.productType?.length ? ` - ${d.productType.join("/")}` : ""}`,
  ];
  if (d.boxedWarning) lines.push(`BOXED WARNING: ${d.boxedWarning}`);
  if (d.indications) lines.push(`INDICATIONS: ${d.indications}`);
  if (d.dosage) lines.push(`DOSAGE (label text; do not individualize prescription doses): ${d.dosage}`);
  if (d.contraindications) lines.push(`CONTRAINDICATIONS: ${d.contraindications}`);
  if (d.warnings) lines.push(`WARNINGS: ${d.warnings}`);
  if (d.interactions) lines.push(`INTERACTIONS: ${d.interactions}`);
  if (d.activeIngredient) lines.push(`ACTIVE INGREDIENT: ${d.activeIngredient}`);
  if (d.doNotUse) lines.push(`DO NOT USE: ${d.doNotUse}`);
  if (d.askDoctor) lines.push(`ASK A DOCTOR BEFORE USE IF: ${d.askDoctor}`);
  if (d.askPharmacist) lines.push(`ASK A DOCTOR OR PHARMACIST BEFORE USE IF: ${d.askPharmacist}`);
  if (d.whenUsing) lines.push(`WHEN USING THIS PRODUCT: ${d.whenUsing}`);
  if (d.stopUse) lines.push(`STOP USE AND ASK A DOCTOR IF: ${d.stopUse}`);
  if (d.pregnancy) lines.push(`PREGNANCY/BREASTFEEDING: ${d.pregnancy}`);
  if (d.adverseReactions) lines.push(`ADVERSE REACTIONS: ${d.adverseReactions}`);
  lines.push(`Source: openFDA drug label; full label at ${d.sourceUrl}`);
  return lines.join("\n\n");
}
