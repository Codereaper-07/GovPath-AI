# Scenario C — Supported request with missing documents (live Gemini)

**Result: PASS**, with one UI wording issue (see Discrepancies). The extraction, planner, evidence and data integrity were all correct.

| | |
|---|---|
| Date/time | 2026-11-15, run started 16:06:46 IST |
| Exact input | "I got married in Delhi and want to update my name on Aadhaar and my passport. I already have my Aadhaar card and passport, but I don't have a marriage certificate yet." (submitted once) |
| Model | gemini-3.6-flash (configured; no fallback) |
| Gemini requests | **1** generation request (1 `POST /api/me/situation/interpret` in the backend log), 0 embeddings |
| Provider response | HTTP 200, about 7.3 s from click to the result on screen; no provider errors, no diagnostic failure lines |
| Retries | Disabled for this run only (`GEMINI_MAX_RETRIES=0` on the local backend process; `.env` unchanged) |
| Account | Dedicated test account, profile Delhi; 0 documents, plans, progress and activity before and after |

## Live Gemini extraction (raw response, captured)
- goals: `update-name-after-marriage`
- life_events: `marriage-family` (nothing extra)
- state: `Delhi`. The text names Delhi, so it is kept as the description's; the UI shows "From your description."
- requested_service_ids: `aadhaar-name-update`, `passport-reissue-name-change-marriage`
- held_document_ids: `aadhaar_number` ("Aadhaar number (existing Aadhaar)") and `passport_existing` ("Old passport (original)")
- lacking_document_ids: `marriage_certificate`
- unknowns: none; dropped ids: none; no passport topic question (the request was understood)

## Deterministic planner output (same as the no-AI baseline computed beforehand)
- Stage 1: **Marriage registration (Delhi, Hindu Marriage Act)**, added by the planner because it issues the marriage certificate the two targets need.
- Stage 2 (parallel): **Aadhaar name update** and **Passport reissue for change of name after marriage**, each depending on marriage registration.
- The held Aadhaar and passport satisfy marriage registration's "any one of" groups (identity, date-of-birth and residence proof), so no PAN step is added.
- Blockers (mandatory documents no curated service issues): separate affidavits of husband and wife; attested passport-size and ceremonial photographs.
- Next action: "Get a missing document: Get Separate affidavits of husband and wife (prescribed format) first. Marriage registration … cannot proceed without it. This also unblocks: Aadhaar name update…, Passport reissue…"
- Marked "This plan is calculated by fixed rules from verified official requirements, not by AI."
- The marriage certificate is shown under "You do not have" and is never treated as held. No services or requirements outside the curated knowledge base appear.

## Evidence and explainability
- "Every requirement (13) and dependency (2) cites an official source."
- Per step, "Official sources" holds 15, 7 and 5 entries: verbatim excerpts, the source document title and "verified 14 Nov 2026".
- Conditional requirements are labelled ("Only if a party is divorced or widowed.", "Only if the marriage was solemnised at a religious place.", "Only if a party is a foreign national.") and do not block.
- AI output is labelled "AI-generated"; the plan is labelled as rule-based. No unsupported claims are presented as official facts.

## Hindi and mobile (same page and response, no new request)
- Hindi: understood facts, held/missing documents, next action, blockers and plan order are in Hindi. English remains only in verbatim official excerpts, authority names and conditional notes (stored in English by design) and the brand.
- No horizontal overflow at 390 px in English or Hindi. No console errors or failed requests.

## Data integrity
- The proposal was reviewed, not accepted. My Plans: "You have no plans yet." The account still has 0 documents, plans, progress and activity.

## Discrepancies
1. **(Medium, UI wording, not AI or planner)** The blocker box heading says "You need one of these documents. No service in GovPath issues them, so obtain any one yourself." It sits above two separate required documents (affidavits AND photographs), so it reads as if either one is enough. The planner correctly reports two separate blockers. Suggested fix: per-blocker wording such as "Obtain this yourself" or "any one of" only when a requirement has alternatives.

## Screenshots (genuine headless-Chrome captures of the running app, unedited)
- `01-situation-input.png`: the submitted request
- `02-ai-extracted-situation.png`: AI-extracted goal, services, life event, location (from the description), held and missing documents
- `03-workflow-order.png`: proposed services (goals plus "Needed first")
- `04-missing-documents-next-action.png`: next action, blockers, plan stage 1
- `05-official-evidence.png`: official source excerpts for the marriage registration step
- `06-hindi-view.png`: the proposal in Hindi
- `07-final-no-plan-saved.png`: My Plans after the test: no plans
