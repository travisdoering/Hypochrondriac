# Hypochondriac — for whatever ails you

A real-time conversational health companion. One continuous conversation, one shared health record, and the assistant wears whichever hat the moment needs:

- **Journal** — remembers how you've felt, what you took, what you measured; charts trends; notices patterns.
- **Coach** — turns intentions into small concrete habits with streaks and gentle check-ins.
- **Diagnostician** — takes a careful history, looks at photos or a live camera feed, says how urgent it is and who to see.
- **Therapist** — listens first, then offers one real skill at a time (CBT / ACT / DBT / motivational interviewing); crisis-aware.
- **Translator** — turns lab reports, imaging reports, pathology, and pre-test instructions into plain English and good questions.
- **Navigator** — finds the right kind of clinician nearby (live US NPI registry search), what to say when you book, what to bring.
- **Health Information Exchange** — pulls your chart from a patient portal over FHIR R4 / SMART on FHIR, browses studies from an imaging facility over DICOMweb, imports downloaded records or CSV device exports, exports a FHIR bundle.
- **Devices** — Bluetooth blood-pressure cuffs, glucose meters, pulse oximeters, thermometers, scales and heart-rate monitors (standard GATT health profiles) log straight into the journal.
- **Grounded lookups** — the model can pull the official FDA drug label (openFDA), NIH MedlinePlus patient education by ICD-10 / LOINC / RxNorm / CPT code, and search your *entire* record (every lab value, every entry) rather than guessing.
- **Family** — separate records and conversations for kids, parents, anyone you care for; the assistant knows who it's talking about.
- **Practical outputs** — printable visit-prep sheet with an SBAR note for the clinician, a wallet emergency card, and `.ics` calendar export for care-plan steps and habit reminders.

It is not a clinician and says so. Emergencies route to 911; mental-health crises route to 988.

## Run it

```bash
npm install
cp .env.example .env.local   # then put your ANTHROPIC_API_KEY in it
npm run dev
```

Open http://localhost:3000. Chrome or Edge gives you voice input; everything else works in any modern browser. The camera and microphone need `localhost` or HTTPS.

No `.env.local`? Paste your key into **Settings (⚙️)** in the app instead. It is stored only in that browser.

Want to click around without a key? `npm run dev:mock` runs the app against a local stand-in for the Anthropic API (canned replies that still exercise streaming, tool calls, the triage banner, the record and visit prep). It's for trying the UI, not for health advice.

## On your phone

1. Run `npm run dev:lan` on your computer (phone and computer on the same Wi-Fi).
2. In the app, tap **📱** in the header and scan the QR code with your phone.
3. Install it: iPhone Share → *Add to Home Screen*; Android ⋮ → *Install app*.

Phones only allow the camera and microphone on **https** pages. For voice and camera on the phone, run `npm run dev:phone` instead (Next creates a local certificate; accept the browser warning on the phone once), or deploy it (Vercel, Netlify, Codespaces port forwarding all give you https).

Each browser keeps its own record. Move it with **Connections → Backup** on one device and **Import** on the other.

## Working in the cloud

- **Claude Code on the web:** open [claude.ai/code](https://claude.ai/code), pick this repository, and give it a task.
- **GitHub Codespaces:** *Code → Codespaces → Create codespace*. The dev container installs everything; run `npm run dev` and open the forwarded port (it's https, so camera and mic work on your phone too). Add `ANTHROPIC_API_KEY` as a Codespaces secret to skip pasting it into Settings.
- **Deploy:** import the repo in Vercel. Leave `ANTHROPIC_API_KEY` unset on a public deployment so visitors must bring their own key; set it only if the deployment is password-protected.

## How it's built

| Layer | What |
|---|---|
| `src/app/api/chat` | Streaming chat with Claude (`claude-opus-5`, adaptive thinking). A manual tool loop validates every tool call with zod and streams NDJSON events to the browser. Record mutations are applied client-side; `find_providers` runs server-side against the NPPES registry. |
| `src/lib/prompts.ts` | The single persona prompt (stable, prompt-cached) and the volatile record summary appended per request. |
| `src/lib/tools.ts` | Tool contract: `set_triage`, `log_journal_entry`, `update_profile`, `add_goal`, `complete_goal`, `add_care_plan_item`, `record_lab_panel`, `find_providers`, `search_record`, `drug_info`, `patient_education`. |
| `src/lib/record-search.ts` | Server-side search over the full record JSON (sent with each request, never stored) so the model has real recall. |
| `src/lib/openfda.ts`, `src/lib/medlineplus.ts` | openFDA drug-label and MedlinePlus Connect clients. |
| `src/lib/bluetooth.ts` | Web Bluetooth readers + IEEE-11073 SFLOAT/FLOAT parsers for the standard health profiles. |
| `src/lib/csv.ts`, `src/lib/ics.ts` | Forgiving CSV vitals import; iCalendar export. |
| `src/lib/redflags.ts` | Instant client-side red-flag detection (stroke, heart attack, anaphylaxis, suicidal crisis, poisoning...) that shows emergency guidance before the model answers. |
| `src/lib/record.ts` | The shared health record (profile, journal, labs/imaging, goals, care plan, session notes, connections) and its model-facing summary. Stored in `localStorage`; nothing server-side. |
| `src/lib/fhir.ts` | FHIR R4 client (open / bearer / SMART PKCE), resource → record mapping, record → FHIR Bundle export, bundle import. |
| `src/lib/dicom.ts` | DICOMweb QIDO-RS / WADO-RS client: studies, series, instances, rendered frames (which can be sent to the model). |
| `src/app/api/fhir`, `src/app/api/dicomweb` | CORS-free pass-through proxies. https only (plus `http://localhost` in dev), private network addresses and cross-site browser requests rejected (`src/lib/proxy-guard.ts`). Tokens are forwarded, never stored. |
| `src/app/api/visit-summary` | Structured outputs (zod) for the one-page visit prep sheet and for end-of-conversation session notes. |
| `src/components/*` | Chat, Composer (voice, camera, drag-drop, paste), CameraPanel (snap / live frames), TriageBanner, record panel tabs. |

### Voice

Speech-to-text uses the Web Speech API (Chrome/Edge/Safari). "Hands-free conversation" listens → sends on a pause → reads the reply aloud → listens again. "Read replies aloud" uses `speechSynthesis`.

### Camera

Snap attaches a still. Live mode attaches the current frame to every message and "What do you see?" sends one immediately. Frames are downscaled to ≤1280px JPEG before upload.

### Connections

- **FHIR** presets: SMART Health IT sandbox (open, synthetic patients), HAPI public test server, Epic and Oracle Health patient sandboxes (SMART; need a registered public client ID with redirect `{origin}/smart/callback`).
- **DICOMweb** presets: Orthanc public demo (open), local Orthanc.
- Import a FHIR Bundle JSON (patient-portal "download my record") or a Hypochondriac backup. Export the whole record as a FHIR R4 Bundle.

## Tests

```bash
npm test
```

`tests/*.test.ts` (run with `tsx --test`) cover:

- the chat API route end to end against a mock Anthropic server (`scripts/mock-anthropic.mjs`): streaming, the tool loop, invalid tool input, server-side record search, model/effort/key headers, auth errors, structured visit summaries;
- how tool results change the record, how conversation history and attachments are sent (request budget, unsupported image types);
- family profiles never overwriting each other's saved record, FHIR sources staying isolated per connection;
- red-flag detection, CSV import, Bluetooth packet and timestamp parsing, record search, number formatting, the proxy guard.

## Environment

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | required for the conversation |
| `HYPO_MODEL` | override model id (default `claude-opus-5`) |
| `HYPO_EFFORT` | `low` / `medium` (default) / `high` / `xhigh` / `max` |
| `NEXT_PUBLIC_MAX_REQUEST_MB` | attachment budget per message. Defaults to 24 MB, or 4 MB on `*.vercel.app` / `*.netlify.app` where request bodies are capped. |

## Safety posture

- Keyword red flags trigger an emergency banner instantly; the model then confirms or lowers the level with `set_triage`.
- The prompt forbids prescribing, dose changes, stopping prescribed medication, and definitive reads of skin lesions or radiology images.
- Lower thresholds for pregnancy, infants, older adults, immunocompromised people, and anticoagulated people are baked into the prompt and the profile is always in context.
- The whole record lives in the browser. Access tokens live in `sessionStorage` only.

This is a companion, not a medical device. Nothing here is a substitute for a clinician.
