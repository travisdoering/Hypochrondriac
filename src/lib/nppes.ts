/**
 * Thin client for the CMS NPPES NPI Registry public API (no key required).
 * https://npiregistry.cms.hhs.gov/api-page
 */

export interface Provider {
  npi: string;
  name: string;
  credential?: string;
  type: "individual" | "organization";
  specialty?: string;
  taxonomyCode?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  phone?: string;
  fax?: string;
  mapsUrl: string;
}

export interface ProviderQuery {
  specialty?: string;
  postal_code?: string;
  city?: string;
  state?: string;
  organization?: boolean;
  first_name?: string;
  last_name?: string;
  organization_name?: string;
  limit?: number;
}

/** Map friendly words to NPPES taxonomy descriptions where they differ. */
const SPECIALTY_ALIASES: Record<string, string> = {
  "primary care": "Family Medicine",
  pcp: "Family Medicine",
  "family doctor": "Family Medicine",
  "family practice": "Family Medicine",
  "general practitioner": "Family Medicine",
  internist: "Internal Medicine",
  "ob/gyn": "Obstetrics & Gynecology",
  obgyn: "Obstetrics & Gynecology",
  gynecologist: "Obstetrics & Gynecology",
  obstetrician: "Obstetrics & Gynecology",
  dermatologist: "Dermatology",
  cardiologist: "Cardiovascular Disease",
  cardiology: "Cardiovascular Disease",
  "heart doctor": "Cardiovascular Disease",
  gastroenterologist: "Gastroenterology",
  "gi doctor": "Gastroenterology",
  neurologist: "Neurology",
  psychiatrist: "Psychiatry",
  psychologist: "Psychologist",
  therapist: "Counselor",
  counselor: "Counselor",
  "mental health": "Counselor",
  "social worker": "Social Worker",
  pediatrician: "Pediatrics",
  orthopedist: "Orthopaedic Surgery",
  orthopedic: "Orthopaedic Surgery",
  orthopaedic: "Orthopaedic Surgery",
  "ent": "Otolaryngology",
  "ear nose throat": "Otolaryngology",
  urologist: "Urology",
  endocrinologist: "Endocrinology",
  rheumatologist: "Rheumatology",
  pulmonologist: "Pulmonary Disease",
  allergist: "Allergy & Immunology",
  "eye doctor": "Ophthalmology",
  ophthalmologist: "Ophthalmology",
  optometrist: "Optometrist",
  dentist: "Dentist",
  podiatrist: "Podiatrist",
  "physical therapist": "Physical Therapist",
  "physical therapy": "Physical Therapist",
  chiropractor: "Chiropractor",
  "urgent care": "Clinic/Center Urgent Care",
  "walk-in clinic": "Clinic/Center Urgent Care",
  lab: "Clinical Medical Laboratory",
  laboratory: "Clinical Medical Laboratory",
  "blood draw": "Clinical Medical Laboratory",
  pharmacy: "Pharmacy",
  imaging: "Radiology",
  radiology: "Radiology",
  "mri center": "Radiology",
  hospital: "General Acute Care Hospital",
  er: "General Acute Care Hospital",
  "emergency room": "General Acute Care Hospital",
  "community health center": "Federally Qualified Health Center (FQHC)",
  fqhc: "Federally Qualified Health Center (FQHC)",
  midwife: "Midwife",
  "nurse practitioner": "Nurse Practitioner",
  dietitian: "Dietitian, Registered",
  nutritionist: "Dietitian, Registered",
  "sleep": "Sleep Medicine",
  "pain": "Pain Medicine",
  oncologist: "Medical Oncology",
  oncology: "Medical Oncology",
  "hematologist": "Hematology & Oncology",
  nephrologist: "Nephrology",
  "kidney doctor": "Nephrology",
  "addiction": "Addiction Medicine",
};

const FACILITY_WORDS = /urgent care|clinic|laboratory|lab\b|pharmacy|hospital|imaging|radiology|center|fqhc|health center/i;

export function normalizeSpecialty(s: string): { taxonomy: string; organization: boolean } {
  const key = s.trim().toLowerCase();
  const mapped = SPECIALTY_ALIASES[key] ?? s.trim();
  return { taxonomy: mapped, organization: FACILITY_WORDS.test(mapped) };
}

interface NppesAddress {
  address_purpose?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  telephone_number?: string;
  fax_number?: string;
}
interface NppesResult {
  number: string;
  enumeration_type: "NPI-1" | "NPI-2";
  basic: {
    first_name?: string;
    last_name?: string;
    middle_name?: string;
    credential?: string;
    organization_name?: string;
    name_prefix?: string;
  };
  addresses?: NppesAddress[];
  taxonomies?: { code?: string; desc?: string; primary?: boolean }[];
}

export async function searchProviders(q: ProviderQuery): Promise<{ providers: Provider[]; query: Record<string, string> }> {
  const params = new URLSearchParams({ version: "2.1" });
  let organization = q.organization ?? false;
  if (q.specialty) {
    const n = normalizeSpecialty(q.specialty);
    // NPPES supports a trailing wildcard on taxonomy_description.
    params.set("taxonomy_description", n.taxonomy.length >= 3 ? `${n.taxonomy}*` : n.taxonomy);
    organization = organization || n.organization;
  }
  if (q.postal_code) params.set("postal_code", q.postal_code.replace(/\D/g, "").slice(0, 5) + "*");
  if (q.city) params.set("city", q.city);
  if (q.state) params.set("state", q.state.toUpperCase().slice(0, 2));
  if (q.first_name) params.set("first_name", q.first_name);
  if (q.last_name) params.set("last_name", q.last_name);
  if (q.organization_name) params.set("organization_name", q.organization_name);
  params.set("enumeration_type", organization ? "NPI-2" : "NPI-1");
  const want = Math.min(Math.max(q.limit ?? 10, 1), 50);
  // NPPES matches the ZIP against mailing OR practice address; over-fetch and
  // rank practice-location matches first so "near 94110" doesn't return a
  // clinician whose billing office happens to be there.
  params.set("limit", String(Math.min(want * 4, 200)));

  const url = `https://npiregistry.cms.hhs.gov/api/?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`NPI registry returned ${res.status}`);
  const data = (await res.json()) as { results?: NppesResult[]; Errors?: { description: string }[] };
  if (data.Errors?.length) throw new Error(data.Errors.map((e) => e.description).join("; "));

  const zip = q.postal_code?.replace(/\D/g, "").slice(0, 5);
  const city = q.city?.toLowerCase();
  const mapped: Provider[] = (data.results ?? []).map((r) => {
    const loc = r.addresses?.find((a) => a.address_purpose === "LOCATION") ?? r.addresses?.[0];
    const tax = r.taxonomies?.find((t) => t.primary) ?? r.taxonomies?.[0];
    const name =
      r.enumeration_type === "NPI-2"
        ? r.basic.organization_name ?? "Organization"
        : [r.basic.name_prefix, r.basic.first_name, r.basic.middle_name, r.basic.last_name]
            .filter(Boolean)
            .map((s) => titleCase(s!))
            .join(" ");
    const address = [loc?.address_1, loc?.address_2].filter(Boolean).map((s) => titleCase(s!)).join(", ");
    const cityState = [loc?.city ? titleCase(loc.city) : undefined, loc?.state].filter(Boolean).join(", ");
    const mapsQ = encodeURIComponent(`${name} ${address} ${cityState} ${loc?.postal_code?.slice(0, 5) ?? ""}`);
    return {
      npi: r.number,
      name,
      credential: r.basic.credential?.replace(/\./g, ""),
      type: r.enumeration_type === "NPI-2" ? "organization" : "individual",
      specialty: tax?.desc,
      taxonomyCode: tax?.code,
      address,
      city: loc?.city ? titleCase(loc.city) : undefined,
      state: loc?.state,
      postalCode: loc?.postal_code?.slice(0, 5),
      phone: formatPhone(loc?.telephone_number),
      fax: formatPhone(loc?.fax_number),
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${mapsQ}`,
    };
  });

  const rank = (p: Provider) => {
    let score = 0;
    if (zip) score += p.postalCode === zip ? 0 : p.postalCode?.slice(0, 3) === zip.slice(0, 3) ? 1 : 3;
    if (city) score += p.city?.toLowerCase() === city ? 0 : 2;
    if (!p.phone) score += 0.5;
    return score;
  };
  const providers = mapped.sort((a, b) => rank(a) - rank(b)).slice(0, want);
  return { providers, query: Object.fromEntries(params.entries()) };
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Md|Do|Pa|Np|Rn|Dds|Dmd|Od|Dpm|Phd|Psyd|Lcsw|Lpc|Lmft|Pt|Dpt|Dc|Apn|Aprn|Cnm|Rd|Facc|Facs)\b/g, (m) =>
      m.toUpperCase(),
    )
    .replace(/\b(Ii|Iii|Iv|Llc|Pc|Pllc|Inc)\b/g, (m) => m.toUpperCase());
}

function formatPhone(p?: string): string | undefined {
  if (!p) return undefined;
  const d = p.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return p;
}

export function providersToText(providers: Provider[]): string {
  if (!providers.length) return "No matching providers found in the NPI registry for that search. Try a broader specialty, a nearby ZIP code, or city + state.";
  return providers
    .map(
      (p, i) =>
        `${i + 1}. ${p.name}${p.credential ? `, ${p.credential}` : ""} - ${p.specialty ?? "unknown specialty"}\n   ${p.address ?? ""}${p.city ? `, ${p.city}` : ""}${p.state ? `, ${p.state}` : ""} ${p.postalCode ?? ""}\n   ${p.phone ? `Phone ${p.phone}` : "No phone listed"} | NPI ${p.npi}`,
    )
    .join("\n");
}
