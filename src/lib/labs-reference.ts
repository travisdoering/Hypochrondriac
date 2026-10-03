/**
 * Plain-English reference for common lab tests. Used to annotate extracted
 * results in the UI and as grounding in the interpretation prompt. Reference
 * ranges vary by lab, age, sex and method - the lab's own printed range always
 * wins over these defaults.
 */

export interface LabRef {
  aliases: string[];
  unit: string;
  low?: number;
  high?: number;
  plain: string; // one-line plain-English meaning
  highMeans?: string;
  lowMeans?: string;
  panel: string;
}

export const LAB_REFERENCE: Record<string, LabRef> = {
  // CBC
  wbc: {
    aliases: ["wbc", "white blood cell", "white blood cells", "leukocytes"],
    unit: "K/uL",
    low: 4.0,
    high: 11.0,
    plain: "White blood cells fight infection.",
    highMeans: "often infection, inflammation, stress, or steroids",
    lowMeans: "can follow viral illness, some medications, or marrow issues",
    panel: "CBC",
  },
  rbc: { aliases: ["rbc", "red blood cell", "red blood cells", "erythrocytes"], unit: "M/uL", low: 4.0, high: 5.9, plain: "Red blood cells carry oxygen.", panel: "CBC" },
  hemoglobin: {
    aliases: ["hemoglobin", "hgb", "hb"],
    unit: "g/dL",
    low: 12.0,
    high: 17.5,
    plain: "The oxygen-carrying protein in red blood cells; low means anemia.",
    lowMeans: "anemia - iron deficiency, blood loss, B12/folate deficiency, chronic disease",
    highMeans: "dehydration, smoking, lung disease, or rarely a marrow condition",
    panel: "CBC",
  },
  hematocrit: { aliases: ["hematocrit", "hct"], unit: "%", low: 36, high: 51, plain: "Percent of blood that is red cells; tracks with hemoglobin.", panel: "CBC" },
  mcv: {
    aliases: ["mcv", "mean corpuscular volume"],
    unit: "fL",
    low: 80,
    high: 100,
    plain: "Average red cell size - helps sort out the cause of anemia.",
    lowMeans: "small cells: iron deficiency or thalassemia trait",
    highMeans: "large cells: B12/folate deficiency, alcohol, thyroid, some meds",
    panel: "CBC",
  },
  platelets: {
    aliases: ["platelets", "plt", "platelet count"],
    unit: "K/uL",
    low: 150,
    high: 400,
    plain: "Platelets help blood clot.",
    lowMeans: "bruising/bleeding risk; viral illness, meds, liver or immune causes",
    highMeans: "often reactive to inflammation, iron deficiency, or infection",
    panel: "CBC",
  },
  // CMP
  glucose: {
    aliases: ["glucose", "blood sugar", "fasting glucose"],
    unit: "mg/dL",
    low: 70,
    high: 99,
    plain: "Blood sugar. Fasting 100-125 is prediabetes; 126+ twice suggests diabetes.",
    panel: "CMP",
  },
  bun: { aliases: ["bun", "blood urea nitrogen", "urea nitrogen"], unit: "mg/dL", low: 7, high: 20, plain: "A kidney filtration marker; also rises with dehydration or high protein intake.", panel: "CMP" },
  creatinine: {
    aliases: ["creatinine", "creat"],
    unit: "mg/dL",
    low: 0.6,
    high: 1.3,
    plain: "The main kidney function marker. Higher means the kidneys are filtering less.",
    highMeans: "reduced kidney filtration, dehydration, or heavy muscle mass",
    panel: "CMP",
  },
  egfr: {
    aliases: ["egfr", "gfr", "estimated gfr", "glomerular filtration rate"],
    unit: "mL/min/1.73m2",
    low: 60,
    plain: "Estimated kidney filtering capacity. 90+ is normal; under 60 for 3+ months is chronic kidney disease.",
    panel: "CMP",
  },
  sodium: { aliases: ["sodium", "na"], unit: "mmol/L", low: 135, high: 145, plain: "Salt/water balance; shifts with hydration, kidneys, and some medications.", panel: "CMP" },
  potassium: {
    aliases: ["potassium", "k"],
    unit: "mmol/L",
    low: 3.5,
    high: 5.1,
    plain: "Critical for heart rhythm. Both high and low can be dangerous when extreme.",
    panel: "CMP",
  },
  chloride: { aliases: ["chloride", "cl"], unit: "mmol/L", low: 98, high: 107, plain: "An electrolyte that tracks with sodium and acid-base balance.", panel: "CMP" },
  co2: { aliases: ["co2", "bicarbonate", "hco3", "carbon dioxide"], unit: "mmol/L", low: 22, high: 29, plain: "Reflects acid-base balance.", panel: "CMP" },
  calcium: { aliases: ["calcium", "ca"], unit: "mg/dL", low: 8.5, high: 10.5, plain: "Bone, nerve and muscle mineral; regulated by parathyroid and vitamin D.", panel: "CMP" },
  albumin: { aliases: ["albumin"], unit: "g/dL", low: 3.5, high: 5.0, plain: "A liver-made protein; low with poor nutrition, liver disease, or inflammation.", panel: "CMP" },
  total_protein: { aliases: ["total protein", "protein, total"], unit: "g/dL", low: 6.0, high: 8.3, plain: "Albumin plus globulins.", panel: "CMP" },
  bilirubin: { aliases: ["bilirubin", "total bilirubin", "bilirubin, total"], unit: "mg/dL", low: 0.1, high: 1.2, plain: "A breakdown product of red cells cleared by the liver; high causes jaundice.", panel: "CMP" },
  alp: { aliases: ["alp", "alkaline phosphatase", "alk phos"], unit: "U/L", low: 40, high: 130, plain: "An enzyme from liver, bile ducts and bone.", panel: "CMP" },
  alt: {
    aliases: ["alt", "sgpt", "alanine aminotransferase"],
    unit: "U/L",
    low: 7,
    high: 45,
    plain: "A liver enzyme; the most liver-specific one.",
    highMeans: "liver irritation - fatty liver, alcohol, medications, viral hepatitis",
    panel: "CMP",
  },
  ast: { aliases: ["ast", "sgot", "aspartate aminotransferase"], unit: "U/L", low: 8, high: 40, plain: "A liver (and muscle) enzyme.", panel: "CMP" },
  // Lipids
  total_cholesterol: { aliases: ["total cholesterol", "cholesterol, total", "cholesterol"], unit: "mg/dL", high: 200, plain: "All cholesterol combined. Under 200 is desirable.", panel: "Lipids" },
  ldl: {
    aliases: ["ldl", "ldl cholesterol", "ldl-c", "ldl calc", "ldl cholesterol calc"],
    unit: "mg/dL",
    high: 100,
    plain: "\"Bad\" cholesterol. Under 100 optimal; the goal depends on your overall heart risk.",
    panel: "Lipids",
  },
  hdl: { aliases: ["hdl", "hdl cholesterol", "hdl-c"], unit: "mg/dL", low: 40, plain: "\"Good\" cholesterol; higher is generally better (40+ men, 50+ women).", panel: "Lipids" },
  triglycerides: { aliases: ["triglycerides", "trig", "tg"], unit: "mg/dL", high: 150, plain: "Blood fats that rise with sugar, alcohol, and insulin resistance.", panel: "Lipids" },
  // Diabetes
  a1c: {
    aliases: ["a1c", "hba1c", "hemoglobin a1c", "glycated hemoglobin", "hgb a1c"],
    unit: "%",
    high: 5.6,
    plain: "Average blood sugar over ~3 months. 5.7-6.4 prediabetes; 6.5+ diabetes.",
    panel: "Diabetes",
  },
  // Thyroid
  tsh: {
    aliases: ["tsh", "thyroid stimulating hormone", "thyrotropin"],
    unit: "mIU/L",
    low: 0.4,
    high: 4.5,
    plain: "The pituitary's thyroid signal. HIGH TSH usually means an UNDERactive thyroid; LOW TSH an OVERactive one.",
    panel: "Thyroid",
  },
  free_t4: { aliases: ["free t4", "ft4", "t4, free", "thyroxine, free"], unit: "ng/dL", low: 0.8, high: 1.8, plain: "The active thyroid hormone level.", panel: "Thyroid" },
  // Iron / vitamins
  ferritin: {
    aliases: ["ferritin"],
    unit: "ng/mL",
    low: 30,
    high: 300,
    plain: "Iron stores. Low = iron deficiency (even before anemia). Also rises with inflammation.",
    panel: "Iron",
  },
  iron: { aliases: ["iron", "serum iron"], unit: "ug/dL", low: 60, high: 170, plain: "Iron circulating in blood right now (varies hour to hour).", panel: "Iron" },
  vitamin_d: { aliases: ["vitamin d", "25-oh vitamin d", "25-hydroxy vitamin d", "vit d"], unit: "ng/mL", low: 30, high: 100, plain: "Vitamin D stores; under 20 is deficient, 20-29 insufficient.", panel: "Vitamins" },
  b12: { aliases: ["b12", "vitamin b12", "cobalamin"], unit: "pg/mL", low: 200, high: 900, plain: "Needed for nerves and red cells; low causes fatigue, numbness, and large-cell anemia.", panel: "Vitamins" },
  folate: { aliases: ["folate", "folic acid"], unit: "ng/mL", low: 3, plain: "A B-vitamin for cell division and red cells.", panel: "Vitamins" },
  // Inflammation
  crp: { aliases: ["crp", "c-reactive protein", "hs-crp"], unit: "mg/L", high: 3, plain: "A general inflammation marker.", panel: "Inflammation" },
  esr: { aliases: ["esr", "sed rate", "erythrocyte sedimentation rate"], unit: "mm/hr", high: 20, plain: "A slow, nonspecific inflammation marker.", panel: "Inflammation" },
  // Urine
  urine_protein: { aliases: ["urine protein", "protein, urine", "proteinuria"], unit: "", plain: "Protein in urine can signal kidney stress.", panel: "Urinalysis" },
  // Cardiac
  troponin: { aliases: ["troponin", "troponin i", "troponin t", "hs-troponin"], unit: "ng/L", high: 14, plain: "Heart muscle injury marker - any elevation is taken seriously in the ER.", panel: "Cardiac" },
  bnp: { aliases: ["bnp", "nt-probnp", "pro-bnp"], unit: "pg/mL", high: 100, plain: "Rises when the heart is under strain (heart failure).", panel: "Cardiac" },
  // Other
  uric_acid: { aliases: ["uric acid", "urate"], unit: "mg/dL", low: 3.5, high: 7.2, plain: "High levels can cause gout and kidney stones.", panel: "Other" },
  magnesium: { aliases: ["magnesium", "mg"], unit: "mg/dL", low: 1.7, high: 2.2, plain: "An electrolyte for muscles, nerves and heart rhythm.", panel: "Other" },
  psa: { aliases: ["psa", "prostate specific antigen"], unit: "ng/mL", high: 4.0, plain: "Prostate marker; rises with enlargement, infection, or cancer - trend matters.", panel: "Other" },
};

export function findLabRef(name: string): LabRef | undefined {
  const n = name.toLowerCase().replace(/[^a-z0-9 ,.-]/g, "").trim();
  for (const ref of Object.values(LAB_REFERENCE)) {
    if (ref.aliases.some((a) => n === a || n.startsWith(a + " ") || n.startsWith(a + ","))) return ref;
  }
  for (const ref of Object.values(LAB_REFERENCE)) {
    if (ref.aliases.some((a) => a.length > 3 && n.includes(a))) return ref;
  }
  return undefined;
}

export function referenceCheatSheet(): string {
  return Object.values(LAB_REFERENCE)
    .map(
      (r) =>
        `${r.aliases[0]} (${r.panel}): typical ${r.low ?? ""}${r.low != null || r.high != null ? "-" : ""}${r.high ?? ""} ${r.unit}. ${r.plain}`,
    )
    .join("\n");
}
