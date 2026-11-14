# CLAUDE.md — GovPath AI

AI-powered, multilingual (en/hi) navigator for Indian government-service workflows.
Architecture: `docs/architecture.md`. Status, sources and next tasks: `PROGRESS.md` (keep it updated).

## Layout
- `frontend/`: React 19 + Vite + TS + Tailwind v4. Feature modules in `src/features/<name>/`
  (components, `api.ts` hooks with TanStack Query). Shared UI in `src/components/{ui,knowledge}/`.
  API types in `src/types/api.ts` mirror `backend/app/schemas`. Strings in
  `src/i18n/locales/{en,hi}.json`; add every key to **both** (enforced by `src/test/i18n.test.ts`).
  - **The backend planner is the single source of truth.** The planner page never orders,
    filters or decides readiness in JS. Every selection change re-calls `POST /api/workflows/plan`
    (TanStack Query keyed on the request; previous plan kept while recalculating). Reasons and
    blockers are rendered from the planner's structured codes and ids, localised with i18n.
  - Data names come from `name`/`name_hi` via `useLocalized()`. Official quotes, authority names,
    URLs and source notes stay in English (`lang="en"`).
  - Tests: Vitest + Testing Library with fixtures captured from the real API (`src/test/fixtures`).
  - Design system "Paper & Route" (tokens in `src/index.css`): `paper/card/rule` surfaces, `ink` text and
    dark panels, `jade-*` verified/official, `zest-*` (lime) only for "you are here"/next action, `crimson-*`
    blockers, `honey-*` caution, `lilac-*` AI only; life-event hues via `EVENT_TONE` (`lib/lifeEvents.ts`).
    Fonts: Fraunces / Tiro Devanagari Hindi (`font-display`), Manrope / Noto Sans Devanagari (UI); Hindi
    resets letter-spacing. Use `buttonClass()`, `PageHeader`, `Seal`, planner `StatusNode`; top-bar layout.
    No Zustand: state is React state plus the localStorage-backed `usePlannerState` (key `govpath.planner.v1`,
    schema `version` inside the value; never written on load; each action re-reads the stored copy, applies
    the change and writes back, keeping unknown fields; other tabs sync via the `storage` event, and a racing
    write re-applies this tab's missing change (`selectionSync.ts`; same item: later edit wins); pruning
    only against non-empty successful lists). The assistant sends `planRequestOf(saved)`. Route pages are
    lazy-loaded via `app/lazyPages.tsx` (tests import pages directly through `test/utils.tsx`).
- `backend/app/` (single FastAPI service):
  - `api/routes/`: thin HTTP handlers only (health, services, documents, workflows).
  - `schemas/`: Pydantic request/response models. Public IDs are **slugs**, never DB keys.
    The plan response includes `services`/`requirements`/`documents` display-name maps (en + hi).
  - `models/`: SQLAlchemy ORM (portable: VARCHAR+CHECK enums, JSONB variant), `migrations/` (Alembic).
  - `knowledge/`: verified facts. `repository.py` (read queries; never eager-load
    `SourceDocument.content_text` with evidence), `seed.py` (idempotent curated loader),
    `cache.py` (per-app TTL cache for read-only knowledge, `KNOWLEDGE_CACHE_SECONDS`, default 60).
  - `ingestion/`: official-source pipeline. Stages: `allowlist` → `fetcher` → `extract` →
    `verification` (assess) → `persistence`, orchestrated by `pipeline.py`.
  - `workflow/`: deterministic planner. `domain.py`, `graph.py`, `planner.py` and `errors.py` are
    **pure** (no DB/web/AI). `loader.py` builds a snapshot from the DB; `service.py` wires the two.
  - `llm/client.py`: the only Gemini entry point (`GeminiClient`): bounded retries with backoff,
    per-day `RESOURCE_EXHAUSTED` never retried, throttle + daily caps (`UsageGuard`), configured
    models only (never silently switch). Embeddings: one `Content` per text (plain multi-part
    input is aggregated into ONE vector by gemini-embedding-2).
  - `rag/`: `chunking.py` (pure) → `indexer.py` (incremental, keyed by source + content hash;
    re-embeds on model/dimension change) → `retriever.py` (pgvector cosine, threshold, per-source
    cap, links chunks to verified evidence) → `context.py` (read-only verified facts + planner
    summary) → `generator.py` (prompt, JSON schema, citation validation) → `assistant.py`.
- `backend/scripts/`: `seed.py`, `ingest.py`, `check_gemini.py` (run as `python -m scripts.<name>`).
- `data/knowledge/`: curated seed (`documents.json`, `sources.json` with evidence, `services/*.json`).
  `data/sources/allowlist.json`: ingestion domain allowlist + source URLs.

## Data model (key decisions)
- `GovernmentService` 1–N `ServiceRequirement` 1–N `RequirementOption` → `DocumentType`.
  **The options of a requirement form an OR group**: any one satisfies it. One option = a single doc.
- `requirement_type`: `mandatory` (blocks), `optional` (never blocks), `conditional` (applies only
  in a stated `condition`, e.g. hypothecated vehicle; the planner treats it as non-blocking).
- `ServiceOutput`: a document a service issues/updates (e.g. Form 8 → replacement EPIC). Used only
  to build *acquisition routes*.
- `ServicePrerequisite`: a verified "B before A" rule; evidence is **NOT NULL**. Currently zero
  rows, because no official source states one between the five services.
- `SourceDocument` (url unique, content_text, content_hash, previous hash, retrieved/changed/
  verified timestamps, verification_status, duplicate_of, parent) 1–N `Evidence` (stable `key`,
  verbatim excerpt, locator, verification_status, excerpt_found_in_source).
- Evidence links: `service_evidence`, `requirement_evidence`, `requirement_options.evidence_id`,
  `service_outputs.evidence_id`, `service_prerequisites.evidence_id`.
- Verification status: `unverified` | `verified` | `needs_review` | `rejected`.
- Life events: `government_services.life_events` is a JSON list of `LifeEvent` values (seed
  requires ≥1). `goals` (migration `0006`) is a JSON list of `CitizenGoal` values used only by
  discovery (curated classification, not a government fact; seed requires ≥1). A category with no verified services is shown as such, never padded.
- Hindi: nullable `name_hi` on services, requirements and document types, plus `description_hi`
  on services (migration `0003`). No generic translation system.

## Ingestion behaviour
- Only HTTPS URLs on allowlisted `*.gov.in` domains (or subdomains); redirects are re-checked.
- robots.txt is honoured (4xx = allow, 5xx/unreachable = disallow), with a 1 s per-host delay,
  a 15 MB cap, timeouts, and a retry without compression for broken gzip.
- Linked PDFs are followed only when `follow_pdfs` is set, up to `max_linked_pdfs`, allowlisted,
  and not already a configured source.
- Content hash = SHA-256 of normalised text, so markup-only changes are not changes.
- Outcomes: `new`, `unchanged`, `changed`, `duplicate` (same text as another URL: a pointer is
  stored, not the text), `failed` (never creates a row; recorded on an existing row's `last_error`).
- **Scraped ≠ verified.** New sources are `unverified`. A changed source that was verified
  becomes `needs_review`, and its evidence is re-checked; excerpts that are no longer found become
  `needs_review`.

## Seed rules
- Validates all references before writing; upserts by slug/key/url; removes requirements and
  options that were dropped from the files. Re-running creates nothing.
- A source is verified as of `verified_on`, unless ingestion saw a change after that date.
- A requirement is `verified` only if it has evidence and **all** its evidence is verified.

## Workflow semantics (planner)
- Input: target ids, owned document ids, completed ids, `progress` (started/submitted/completed),
  `document_states` (available/expired/invalid/unsure; only available satisfies) and the citizen's `state`.
- Documents never complete a process. Completion is an explicit, **user-reported** action
  (`CompletionSource.USER_REPORTED`; `official` is reserved, never produced). Completion condition =
  the service's verified outputs. Started/submitted steps are `in_progress`; next action `follow_up`
  only when nothing can be started and no document is missing.
- Jurisdiction: a service with `state` set is used (target or repair) only in that state; unknown state
  gives a `state_required` clarification; another state gives `missing_document_route_outside_jurisdiction`.
- An owned option satisfies its requirement. Outputs of completed services count as owned, unless the
  citizen marked that document expired/invalid/unsure (the mark wins). Reported progress is kept when a
  service leaves the plan; the planner then emits a `progress_outside_plan` notice (UI can clear it).
- Edges come only from (1) verified prerequisites or (2) acquisition routes: a missing *mandatory*
  document issued by another known service. Route choice: prefer a service already in the plan,
  then fewest unmet mandatory requirements, then slug. Routes that would form a cycle are skipped.
  If no route exists, the requirement is a **blocker**.
- `graphlib.TopologicalSorter` gives stages (parallel groups). Steps are ready, waiting or blocked;
  a blocked dependency propagates `dependency_blocked`.
- Next action: among ready steps, pick the one with the most transitive dependents, then role
  (prerequisite > acquisition > target), then slug. If nothing is ready, pick the root blocker
  that frees the most steps. The reason is a structured code plus a deterministic template message.
- Errors: `UnknownIdsError` (422), `EmptySelectionError` (422), `DependencyCycleError` (409).
- Only `verified` requirements, prerequisites and outputs reach the planner (`loader.py` filters).
- Discovery (`workflow/discovery.py`, pure): goals (else life events) → candidates; excluded when out of
  verified jurisdiction or when a required existing record (no producer) is declared lacking;
  `needs_clarification` when state/record is unknown. API: `/api/workflows/discover`, `/vocabulary`.
- `llm/situation.py` (+ `POST /api/situation/interpret`): AI extracts facts only (goals, life events, state,
  held/lacking documents and their conditions), closed vocabularies, validated; reviewed before use.
  Not yet validated against live Gemini.
- Proposal (`workflow/proposal.py`, pure; `POST /api/workflows/propose`): reviewed context → `discover` →
  existing `plan`. Supporting services come only from the planner; `target_service_ids` = the citizen's
  edited list. Statuses: ready / needs_clarification / no_supported_services / no_services_selected. A
  proposal is never saved: the UI (`features/journey/SituationJourney.tsx`, assistant page) saves only
  on explicit accept (`acceptProposal`: reviewed facts replace saved facts; merge unions services/goals;
  progress/completions kept).

## Assistant rules (Milestone 4)
- Gemini only **explains**. Dependencies, ordering, blockers and next action come from the
  deterministic planner; the API echoes the planner's output separately (`workflow`).
- Citations are server-side: the model may only cite the ids it was given (`S#` retrieved
  excerpts, `K#` verified facts). Unknown ids are dropped, and uncited "sufficient" answers become
  "partial". Excerpts shown are exact stored official text.
- Retrieved text is untrusted: delimited in `<source>` tags and escaped.
- Citation markers are normalised server-side (`generator.normalize_citations`): combined
  (`[K1, S3]`), lowercase, ranged and unclosed markers become single `[ID]` markers; unknown ids
  are removed. The frontend renders only ids present in the response's citation list.
- Coverage: every prompt lists all covered services (`SERVICES COVERED`), and relocation
  questions get verified facts for all services, so missing retrieval is never presented as
  "not covered". Requirement notes (e.g. "documents not listed by Parivahan") are part of the
  facts; the model must not turn an alternative or example into a requirement.
- Generation model: `gemini-3.6-flash` (configured; `gemini-3.8-flash` was unavailable during
  validation). Never switch models automatically.
- No Gemini call when there is nothing to ground in, and repeated questions are cached (answer key
  = hash of model + exact prompt). Embeddings are only created by `python -m scripts.embed`.
- **Never call the real Gemini API in tests or during development.** `tests/conftest.py`
  blocks `genai.Client`; use `tests/rag_fakes.py`.

## Evaluation
- Dataset: `data/evaluation/scenarios.json` (hand-labelled from the verified knowledge base).
  Runner: `backend/evaluation/` (`python -m evaluation.run retrieval|answers|report`). It uses the
  real Gemini API but caches every response in `data/evaluation/results/`; `report` makes no
  API calls. Re-tune `RAG_MIN_SIMILARITY` only from the sweep in the report.

## Non-negotiable rules
1. **Separation.** `knowledge/`, `ingestion/` and `workflow/` must never import `rag/`, `llm/` or
   `google.genai`; the planner core must not import DB/web modules (enforced by
   `tests/test_layer_boundaries.py`). AI output (future) goes in a separate, labelled field.
2. **Verified facts only from official government sources**, each with source URL, verification
   date and a verbatim excerpt. Never invent cross-service dependencies, and never treat "accepted
   as proof" as "mandatory prerequisite".
3. If something can't be verified, leave it out or mark it unverified, and document it in
   `PROGRESS.md`.
4. **No** LangChain, Neo4j, Docker, microservices, autonomous agents, or LLM-based dependency inference.
5. Tests must never touch Supabase: they use in-memory SQLite and `build_engine` is patched to raise.
6. Never print or commit `.env` values. Don't claim external integrations work until tested.
7. Two-day timeline: prefer simple, working code. The UI uses a timeline, not a graph view.

## Commands (from `backend/`, venv at `.venv`)
- Tests/lint: `.venv/bin/pytest`, `.venv/bin/ruff check . && .venv/bin/ruff format .`
- DB: `.venv/bin/alembic upgrade head`, `.venv/bin/alembic check`,
  `.venv/bin/alembic revision --autogenerate -m "..."`
- Embeddings (manual, uses quota): `.venv/bin/python -m scripts.embed --dry-run` then `... scripts.embed`;
  real-API smoke test (manual only): `.venv/bin/python -m scripts.check_gemini`
- Data: `.venv/bin/python -m scripts.seed [--check]`,
  `.venv/bin/python -m scripts.ingest [--dry-run] [--url URL] [--no-follow-pdfs]`
- Run: `.venv/bin/uvicorn app.main:app --reload`
- Frontend (from `frontend/`): `npm run dev`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`
