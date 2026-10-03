# Hypochondriac - notes for Claude Code

Next.js 16 (App Router, Turbopack) + React 19 + Tailwind v4 + `@anthropic-ai/sdk`. TypeScript strict. No database: the health record lives in the browser (`localStorage`), tokens in `sessionStorage`.

## Commands

```bash
npm run dev          # http://localhost:3000 (the .claude/launch.json preview uses port 3111)
npm run typecheck    # tsc --noEmit
npm test             # tsx --test tests/*.test.ts
npm run build        # next build
```

## Product rules (from the owner)

- **No modes.** One freeform conversation; the model decides when to act as journal / coach / diagnostician / therapist / report translator / care navigator. Do not add a mode picker or templated reply formats.
- **Recommendations are conversational**, not an "assessment / plan" template.
- **It is also a personal HIE**: FHIR R4 + SMART on FHIR (PKCE) for EHR portals, DICOMweb for imaging, FHIR bundle import/export, CSV device import, Bluetooth devices.
- Safety first: keyword red flags (`src/lib/redflags.ts`) show emergency guidance instantly; the model confirms with `set_triage`. No prescribing, no dose changes, no definitive reads of lesions or radiology images.

## Architecture map

- `src/lib/prompts.ts` - single persona system prompt (stable, cached) + volatile record summary. Edit the persona here.
- `src/lib/tools.ts` - zod schemas + JSON-schema tool defs. Add a tool: schema -> `TOOL_SCHEMAS` -> `TOOLS` -> handle in `src/app/api/chat/route.ts` (server-executed) or `applyTool` in `src/lib/chat-client.ts` (record mutation) -> chip label in `src/components/Chat.tsx`.
- `src/app/api/chat/route.ts` - streaming manual tool loop, NDJSON events `{t:"text"|"tool"|"stop"|"done"|"error"}`. Honors `x-anthropic-key`, `x-hypo-model`, `x-hypo-effort` headers (BYO key from Settings).
- `src/lib/record.ts` - `HealthRecord` types, `summarizeRecordForModel`. `src/lib/record-search.ts` - full-record search used by the `search_record` tool (client sends the whole record with each request).
- `src/lib/store.ts` - tiny `useSyncExternalStore` stores: `recordStore`, `chatStore`, `prefsStore`; family profiles via `switchPerson` / `addPerson` (stores are re-keyed per person).
- `src/lib/fhir.ts`, `src/lib/dicom.ts` - clients + mapping; proxied through `src/app/api/fhir` and `src/app/api/dicomweb`.
- `src/components/record/*` - the side panel tabs. `src/lib/bus.ts` lets panels drop a message into the chat.

## Conventions

- Keep user-facing copy warm and plain; the app talks like a smart friend, not a form.
- Any new chart uses the CSS tokens in `globals.css` (`--series-*`, status colors) and the `Sparkline` component style: thin marks, hover tooltip, text in ink tokens.
- Never store API keys or tokens server-side. Never log request bodies.
- Public sandboxes used for testing: SMART Health IT FHIR (`https://launch.smarthealthit.org/v/r4/fhir`), Orthanc DICOMweb demo (`https://demo.orthanc-server.com/dicom-web`), NPPES, openFDA, MedlinePlus Connect.
