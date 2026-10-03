import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * Tools the model uses to write into the person's health record and to look
 * things up. All but `find_providers` are "record mutations": the server
 * forwards the validated input to the browser (which owns the record) and
 * returns a simple acknowledgement to the model.
 */

export const TriageLevelSchema = z.enum([
  "emergency",
  "urgent",
  "soon",
  "self-care",
  "routine",
]);

export const VitalsSchema = z
  .object({
    systolic: z.number().optional(),
    diastolic: z.number().optional(),
    heartRate: z.number().optional(),
    tempC: z.number().optional(),
    spo2: z.number().optional(),
    weightKg: z.number().optional(),
    glucoseMgDl: z.number().optional(),
    sleepHours: z.number().optional(),
    steps: z.number().optional(),
  })
  .strict();

export const SetTriageSchema = z
  .object({
    level: TriageLevelSchema,
    reason: z.string(),
    red_flags: z.array(z.string()).default([]),
    next_step: z.string(),
  })
  .strict();

export const LogJournalSchema = z
  .object({
    mood: z.number().min(1).max(10).optional(),
    energy: z.number().min(1).max(10).optional(),
    pain: z.number().min(0).max(10).optional(),
    anxiety: z.number().min(0).max(10).optional(),
    symptoms: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    notes: z.string(),
    vitals: VitalsSchema.optional(),
  })
  .strict();

export const UpdateProfileSchema = z
  .object({
    name: z.string().optional(),
    age: z.number().optional(),
    sex: z.enum(["female", "male", "intersex", "prefer-not"]).optional(),
    heightCm: z.number().optional(),
    weightKg: z.number().optional(),
    pregnant: z.boolean().optional(),
    conditions_add: z.array(z.string()).default([]),
    conditions_remove: z.array(z.string()).default([]),
    medications_add: z.array(z.string()).default([]),
    medications_remove: z.array(z.string()).default([]),
    allergies_add: z.array(z.string()).default([]),
    allergies_remove: z.array(z.string()).default([]),
    city: z.string().optional(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
  })
  .strict();

export const AddGoalSchema = z
  .object({
    title: z.string(),
    why: z.string().optional(),
    cadence: z.enum(["daily", "weekly", "once"]),
  })
  .strict();

export const CompleteGoalSchema = z.object({ title: z.string() }).strict();

export const AddCarePlanSchema = z
  .object({
    title: z.string(),
    urgency: TriageLevelSchema,
    specialty: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();

export const LabResultSchema = z
  .object({
    name: z.string(),
    value: z.union([z.number(), z.string()]),
    unit: z.string().optional(),
    refLow: z.number().optional(),
    refHigh: z.number().optional(),
    refText: z.string().optional(),
    flag: z
      .enum(["low", "high", "critical-low", "critical-high", "abnormal", "normal"])
      .optional(),
    explanation: z.string().optional(),
  })
  .strict();

export const RecordLabPanelSchema = z
  .object({
    date: z.string().describe("ISO date YYYY-MM-DD of collection or report; today if unknown"),
    kind: z.enum(["labs", "imaging", "other"]),
    source: z.string().optional(),
    summary: z.string(),
    results: z.array(LabResultSchema),
    questionsForDoctor: z.array(z.string()).default([]),
  })
  .strict();

export const FindProvidersSchema = z
  .object({
    specialty: z
      .string()
      .describe(
        "Taxonomy/specialty words as used by the US NPI registry, e.g. 'Dermatology', 'Family Medicine', 'Internal Medicine', 'Psychiatry', 'Clinical Psychologist', 'Urgent Care', 'Clinical Laboratory', 'Pharmacy', 'Orthopaedic Surgery', 'Obstetrics & Gynecology', 'Pediatrics', 'Cardiovascular Disease', 'Gastroenterology', 'Neurology', 'Physical Therapist', 'Optometrist', 'Dentist'",
      ),
    postal_code: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional().describe("Two-letter US state code"),
    organization: z.boolean().default(false).describe("true to search facilities (urgent care, labs, pharmacies, clinics) instead of individual clinicians"),
    limit: z.number().min(1).max(20).default(8),
  })
  .strict();

export const DrugInfoSchema = z
  .object({
    name: z.string().describe("Generic or brand name of a US drug product, e.g. 'ibuprofen', 'Eliquis', 'metformin'"),
  })
  .strict();

export const PatientEducationSchema = z
  .object({
    codeSystem: z.enum(["icd10cm", "snomed", "rxnorm", "ndc", "loinc", "cpt"]),
    code: z.string().describe("The code, e.g. ICD-10-CM 'E11.9' for type 2 diabetes, LOINC '4548-4' for hemoglobin A1c, RxNorm '6809' for metformin"),
    displayName: z.string().optional().describe("Human name for the code; improves matching"),
  })
  .strict();

export const SearchRecordSchema = z
  .object({
    query: z.string().describe("Keywords: an analyte ('potassium'), a symptom ('headache'), a report type ('chest x-ray'), a medication, etc."),
    scope: z.enum(["labs", "journal", "imaging", "plan", "all"]).default("all"),
    from: z.string().optional().describe("YYYY-MM-DD lower bound"),
    to: z.string().optional().describe("YYYY-MM-DD upper bound"),
    limit: z.number().min(1).max(100).default(25),
  })
  .strict();
export type SearchRecordInput = z.infer<typeof SearchRecordSchema>;

export type DrugInfoInput = z.infer<typeof DrugInfoSchema>;
export type PatientEducationInput = z.infer<typeof PatientEducationSchema>;
export type SetTriageInput = z.infer<typeof SetTriageSchema>;
export type LogJournalInput = z.infer<typeof LogJournalSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
export type AddGoalInput = z.infer<typeof AddGoalSchema>;
export type CompleteGoalInput = z.infer<typeof CompleteGoalSchema>;
export type AddCarePlanInput = z.infer<typeof AddCarePlanSchema>;
export type RecordLabPanelInput = z.infer<typeof RecordLabPanelSchema>;
export type FindProvidersInput = z.infer<typeof FindProvidersSchema>;

export const TOOL_SCHEMAS = {
  set_triage: SetTriageSchema,
  log_journal_entry: LogJournalSchema,
  update_profile: UpdateProfileSchema,
  add_goal: AddGoalSchema,
  complete_goal: CompleteGoalSchema,
  add_care_plan_item: AddCarePlanSchema,
  record_lab_panel: RecordLabPanelSchema,
  find_providers: FindProvidersSchema,
  drug_info: DrugInfoSchema,
  patient_education: PatientEducationSchema,
  search_record: SearchRecordSchema,
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

function jsonSchema(schema: z.ZodType): Anthropic.Tool["input_schema"] {
  const js = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  delete js.$schema;
  return js as Anthropic.Tool["input_schema"];
}

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "set_triage",
    description:
      "Set the urgency level shown to the person. Call whenever symptoms, injuries, concerning lab/imaging findings, or safety concerns are discussed; call again if the level changes.",
    input_schema: jsonSchema(SetTriageSchema),
  },
  {
    name: "log_journal_entry",
    description:
      "Append an entry to the person's health journal: how they feel, symptoms, mood/energy/pain/anxiety scores, vitals, and a short note in their words.",
    input_schema: jsonSchema(LogJournalSchema),
  },
  {
    name: "update_profile",
    description:
      "Add or correct profile facts: age, sex, pregnancy, height/weight, conditions, medications, allergies, location. Only use the *_remove fields when explicitly asked.",
    input_schema: jsonSchema(UpdateProfileSchema),
  },
  {
    name: "add_goal",
    description: "Create a concrete health goal/habit for the person to track.",
    input_schema: jsonSchema(AddGoalSchema),
  },
  {
    name: "complete_goal",
    description: "Mark a goal as completed for today (daily/weekly) or done (once). Match by title.",
    input_schema: jsonSchema(CompleteGoalSchema),
  },
  {
    name: "add_care_plan_item",
    description:
      "Add a recommended next step to the person's care plan, e.g. 'See a dermatologist about the changing mole' with urgency and specialty.",
    input_schema: jsonSchema(AddCarePlanSchema),
  },
  {
    name: "record_lab_panel",
    description:
      "Save a set of lab results or an imaging/pathology report that the person shared, with every extracted value, unit, reference range, flag, and plain-English explanation.",
    input_schema: jsonSchema(RecordLabPanelSchema),
  },
  {
    name: "find_providers",
    description:
      "Search the US National Provider Identifier (NPPES) registry for clinicians or facilities by specialty and location. Returns name, credentials, specialty, address, phone.",
    input_schema: jsonSchema(FindProvidersSchema),
  },
  {
    name: "search_record",
    description:
      "Search the person's FULL health record (every lab value, every journal entry, every report, the care plan) beyond the summary in the system prompt. Use it whenever they ask about history ('what was my potassium last year', 'how often have I logged headaches', 'what did the MRI report say') or when a trend matters for your judgment.",
    input_schema: jsonSchema(SearchRecordSchema),
  },
  {
    name: "drug_info",
    description:
      "Fetch the official FDA label for a medication (openFDA): indications, label dosing, boxed warning, warnings, interactions, contraindications, pregnancy, 'stop use and ask a doctor'. Use when the person asks about a medicine they take or are considering, about side effects, or whether two things interact. Ground your answer in it and cite it.",
    input_schema: jsonSchema(DrugInfoSchema),
  },
  {
    name: "patient_education",
    description:
      "Fetch authoritative plain-language patient education from MedlinePlus (NIH) for a diagnosis (ICD-10-CM/SNOMED), medication (RxNorm), lab test (LOINC), or procedure (CPT). Use when the person has or suspects a condition, is scheduled for a test or procedure, or asks 'what is X'. Share the link so they can read more.",
    input_schema: jsonSchema(PatientEducationSchema),
  },
];
