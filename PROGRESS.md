# PROGRESS — GovPath AI

_Last updated: 2026-11-14_

## Architecture decisions
| Decision | Choice |
|----------|--------|
| Repo | Monorepo: `frontend/`, `backend/`, `docs/`, `data/` |
| Frontend | React 19, Vite 8, TypeScript, Tailwind CSS v4, React Router 7, TanStack Query 5, react-i18next |
| Backend | FastAPI, SQLAlchemy 2.1 async + psycopg 3, Alembic, pytest, ruff |
| Database | Supabase PostgreSQL 17 + pgvector 0.8.2 (hosted) |
| Ingestion | httpx + BeautifulSoup (`html.parser`) + PyMuPDF; allowlist + robots.txt |
| Planning | Pure Python, stdlib `graphlib`; no AI |
| LLM / embeddings | `gemini-3.6-flash` / `gemini-embedding-2` @ 768 dims (3.8-flash was unavailable in validation) |
| Scope | India; English and Hindi; 5 address-change services |
| Tests | In-memory SQLite (aiosqlite); HTTP mocked with `httpx.MockTransport`; never touches Supabase |

## Milestone 1 — foundation ✅
Git, monorepo, frontend dashboard shell, FastAPI health endpoints, Supabase connection, Alembic
`0001_enable_pgvector`, Gemini client wrapper (see `README.md`).

## Milestone 2 — knowledge base, ingestion, workflow engine ✅

### Database
- Migration **`0002_knowledge_base`** applied to Supabase (current head). Verified with
  `alembic check` (no drift) and a downgrade → upgrade round-trip before seeding.
- Tables: `government_services`, `document_types`, `service_requirements`, `requirement_options`,
  `service_outputs`, `service_prerequisites`, `source_documents`, `evidence`, `service_evidence`,
  `requirement_evidence`.

### Seed status (Supabase, 2026-11-14)
- `python -m scripts.seed` was run twice; the second run created nothing (idempotent).
- Totals: 5 services, 35 document types, 18 requirements (52 document options), 6 service outputs,
  0 prerequisites, 10 curated sources (+1 linked UIDAI Citizen Charter PDF, unverified, unused),
  77 evidence excerpts.
- Verification: 10/10 curated sources, 77/77 evidence and 18/18 requirements `verified`.
- After live ingestion, **77/77 excerpts were found verbatim** in the freshly fetched official text.

### Official sources used (all fetched 2026-11-14)
| Service | Sources |
|---------|---------|
| Aadhaar address update | uidai.gov.in/en/updating-data-on-aadhaar; UIDAI "List of Acceptable Documents for Enrolment and Update" PDF (List IV) |
| Voter ID (Form 8) | voters.eci.gov.in Form-8 guidelines PDF; Form 8 (English) PDF |
| Driving licence address change | parivahan.gov.in/en/node/246; CMVR Form 2 PDF |
| Vehicle RC address change | parivahan.gov.in/en/content/address-change; parivahan.gov.in/en/node/155; CMVR Form 33 PDF |
| Passport reissue (address) | passportindia.gov.in Application Form Instruction Booklet V3.0 PDF |

### Verified findings that shape the planner
- **No official source makes any of the five services a prerequisite of another.** The Form 8
  Aadhaar number is optional ("If the applicant does not have Aadhaar number…"), and for passport,
  Aadhaar only "will expedite processing". So `service_prerequisites` is empty.
- Real **acquisition routes** exist through accepted address proofs. An updated Aadhaar, an EPIC
  (or electoral-roll entry) at the new address, or a passport with the new address is accepted by
  some of the other services.
- A **driving licence is NOT accepted as Proof of Address for Aadhaar update** (UIDAI List IV, row 4,
  PoA column "not allowed"), and it isn't in the passport PoA list. It is never used as a route.

### Ingestion capabilities
- Allowlist file (`data/sources/allowlist.json`, 4 domains, 10 sources); HTTPS-only;
  subdomain-aware; redirects re-checked.
- robots.txt honoured; politeness delay; timeouts; 15 MB cap; retry without compression for
  broken gzip (needed for uidai.gov.in).
- HTML: boilerplate removal, title, headings, links, PDF links, `lang`/description metadata.
  PDF: text, title, page count, per-page character counts (for future page-cited chunking).
- Dedupe by normalised-text hash (markup-only changes ignored), change detection with previous
  hash, duplicate pointer across URLs, failure capture without creating rows.
- Verification stage: changed verified sources become `needs_review`, and evidence excerpts are
  re-checked against the new text.
- Live run: 11 sources `new`, then 11 `unchanged` on the re-run.

### Planner behaviour
OR groups; optional/conditional never block; owned and completed-service outputs satisfy
requirements; verified prerequisites; acquisition routes with cycle avoidance; blockers with
propagation; parallel stages; deterministic next-best-action with a structured reason;
evidence references; replanning by resubmitting owned/completed ids. See `CLAUDE.md` for the rules.

### API
- `GET /api/services`: service summaries.
- `GET /api/services/{service_id}`: detail with requirements, OR-group options, outputs,
  prerequisites, and evidence (404 if unknown, 422 if the id is invalid).
- `GET /api/documents`: document types with issuing and accepting services.
- `POST /api/workflows/plan`: `{target_service_ids, owned_document_ids?, completed_service_ids?}`.
  Returns 422 `unknown_ids` / `empty_selection` / validation errors, 409 `dependency_cycle`,
  and 503 if the DB is not configured.
- Smoke-tested live against Supabase (all endpoints, a 3-service plan, and the error path).

### Test results
`pytest`: **122 passed** (planner 33, ingestion 36, knowledge/seed 12, dataset planner 10, API 9,
layer boundaries 7, config 9, health 3, embeddings 3). `ruff check` and `ruff format --check` are
clean. `alembic check`: no drift.

### Known limitations
- Only a subset of UIDAI's ~30 accepted PoA documents is modelled. Head-of-Family and
  family-member-declaration routes are not modelled.
- UIDAI's PoA allowed/not-allowed marks are images. They were checked visually from the rendered
  PDF (noted on each evidence row); the automated check only confirms the row text exists.
- DL: the Form 2 annexure combines "Proof of Address and Age"; only clearly address-bearing items
  are modelled. State-specific documents and fees are not modelled.
- RC: Parivahan does not list which address proofs are accepted, so this is a generic document,
  and the planner reports it as a blocker if it isn't held.
- Passport: booklet V3.0 has no stated publication date. Passport Seva `psp` pages are rendered
  with JavaScript and could not be ingested. Category-specific annexures are not modelled.
- Voter: Form 8's "Any Other" document is not modelled. Enrolment (Form 6) is out of scope, so a
  missing EPIC is a blocker.
- Document validity conditions (e.g. "not older than 3 months") are shown as option notes; the
  planner trusts the user's claim that they hold a valid document.
- Hindi translations of service/document names are not stored yet.

## Milestone 3 — frontend services, planner, Hindi ✅
- **Services:** catalogue cards (authority, jurisdiction, verification, official link). The detail
  page groups mandatory, optional and "only in some cases" documents, shows OR-group alternatives
  with notes and verbatim evidence plus source links, and styles unverified items distinctly.
- **Planner:** pick services and owned documents, then generate. Results show the next action
  (with "How to apply" and "Mark as done"), a single blocker panel, and a vertical timeline by
  parallel group. Each step states its own dependencies; independent steps are labelled as such.
  Missing documents can be ticked inline. Every change (documents, services, completed steps)
  re-calls the backend planner. Selections persist in localStorage, and stale ids are dropped.
- **Documents page:** each document with the services that accept or issue it.
- **Hindi:** migration **`0003_hindi_names`** (applied to Supabase) adds `name_hi` to services,
  requirements and document types, and `description_hi` to services. All 5 services, 18
  requirements and 35 documents are seeded in Hindi, and all UI strings exist in en and hi.
- **Backend changes (no planner logic touched):**
  - Hindi fields and plan display-name maps.
  - `requirement_count` on the service summary.
  - Fixed slow responses (9–16 s, down to about 1–2 s cold and a few ms cached). Evidence
    eager-loading was dragging every source's full extracted text; it now loads only the needed
    source columns, uses `joinedload` for many-to-one relations, and adds a per-app TTL cache.
- **Verification:**
  - Backend `pytest` 124 passed, ruff clean, `alembic check` no drift.
  - Frontend Vitest 16 passed, `tsc -b` clean, oxlint clean, `vite build` ok.
  - Headless-Chrome screenshots checked: services, detail, parallel plan, blocked plan, Hindi, 390 px mobile.

### Known limitations (frontend)
- Requirement notes and conditions, source notes and authority names are shown in English;
  only names and descriptions have stored Hindi.
- The planner trusts the user's ticks (it cannot check document age or validity).
- After re-seeding, the API serves cached knowledge for up to `KNOWLEDGE_CACHE_SECONDS` (60 s).
- When nothing is held, the backend can chain several blocked acquisition steps. This is correct
  per the rules, but the plan becomes long.

## Milestone 4 — RAG, retrieval, AI assistant ✅
- **Models (checked against the Gemini docs, no API calls made):**
  - `gemini-3.8-flash`: Stable, free tier, structured output, thinking levels low/medium/high
    (`minimal` unsupported). Using `low`; thinking tokens count toward `max_output_tokens`
    (2048).
  - `gemini-embedding-2`: Stable, free tier, 128–3072 dims (default 3072, 768 recommended and
    auto-normalised). The pgvector column is `vector(768)`.
  - Fixed a latent bug: a list of strings is aggregated into **one** embedding; each text is now
    its own `Content`.
- **Database:** migration **`0004_source_chunks`** applied (HNSW cosine index), `alembic check` clean.
  `scripts.embed --dry-run` created **199 chunks** from 11 stored sources (re-run: 0 new).
  **No embeddings were generated** (to protect the quota). The pgvector query path was verified
  on Supabase with a probe vector in a rolled-back transaction.
- **Pipeline:** page-aware, heading-aware chunks with overlap, content-hash keys, and language.
  Embedding is incremental (skips current, re-embeds on content/model/dimension change), batched
  (16), committed per batch, and stops on quota exhaustion.
- **Assistant:** `POST /api/assistant/query`. Retrieval (top-5, min similarity 0.5, max 2 chunks
  per source, verified sources only) plus verified structured facts plus the read-only planner
  summary, then a grounded Gemini JSON answer with server-validated citations and an AI label.
  No Gemini call when nothing relevant is found, and question-embedding and answer caches are in
  place.
- **Frontend:** Assistant page with question input, examples, "use my saved plan", AI-labelled
  answers, clickable `[S#]` citations, expandable exact excerpts, evidence-status badge, and
  friendly errors (quota, rate limit, index not built, network, validation), in English and Hindi.
- **Tests:** backend pytest **177 passed** (all Gemini calls faked; `genai.Client` blocked in
  tests), ruff clean. Frontend Vitest **26 passed**, `tsc -b`, oxlint and `vite build` clean.

### Known limitations
- Daily caps and throttling are per API process, in memory (they reset on restart; the provider's
  quota still applies).
- Free-tier RPM/RPD numbers are not published in the docs, so the defaults are conservative and
  configurable.
- Retrieval quality and answer quality with the real models have not been measured yet (no live
  calls were allowed).

## Milestone 5 — validation & completion (2026-11-14)
- **Vector index:** built with real embeddings, 199/199 chunks at 768 dims, no duplicates. The
  run was incremental and resumed after a per-minute rate limit.
- **Generation model:** now `gemini-3.6-flash`. `gemini-3.8-flash` returned 503/504 on every
  request. The smoke test passes (3.3 s).
- **Retrieval evaluation (26 cases):**
  - P@5 0.548 (0.87 of the achievable ceiling), evidence R@5 0.749, MRR 0.924, success 1.0;
    EN and HI comparable.
  - `RAG_MIN_SIMILARITY` tuned 0.5 → 0.66 from the score distribution.
- **Planner:** validated independently. All 5 workflow expectations match, plus replanning when a
  document is reported missing, stability under input order, and no invented edges.
- **Answer evaluation:** proposed system 19/26 cases.
  - Schema 19/19, 0 invalid citations, 0 unsupported fees/durations, citation precision 0.836.
  - Out-of-scope abstention with no generation call. Median latency 5.4 s.
  - Manual review of the 3 automatic failures: 2 correct (strict labels / image-only evidence),
    1 caused by an overstated curated note, now fixed.
- **Baselines A/B/C: not run.** The free-tier quota stopped generation after 18 evaluation calls.
  They resume from cache with `python -m evaluation.run answers P,C,B,A`.
- **Fixes:**
  - requirement notes included in the facts, plus mandatory/optional/alternative rules;
  - covered-services list in every prompt;
  - relocation questions get all service facts;
  - citation marker normalisation (backend + frontend);
  - whole-word keyword matching (car≠card, कार≠सरकार);
  - corrected passport passbook note;
  - embed CLI daily cap;
  - site-wide informational disclaimer.
- **Tests:** backend 193 passed, ruff clean, `alembic check` clean. Frontend 27 passed,
  typecheck, lint and build clean. End-to-end in the real app: all pages, planner replanning, and
  live EN/HI assistant answers with working citations; 0 console errors.

## Milestone 6 — multi-life-event expansion & frontend (2026-11-14)
- **Life events:** migration **`0005_life_events`** adds `government_services.life_events`
  (JSON, default `[]`). There are five categories: relocation-identity, marriage-family,
  birth-parenthood, employment-career, starting-business.
- **5 new verified services (10 total)**, all requirements verified with exact quotes:

  | Service | Life event | Official source |
  |---|---|---|
  | Marriage registration (Delhi, Hindu Marriage Act) | marriage-family | revenue.delhi.gov.in page + guidelines PDF |
  | Aadhaar name update | marriage-family, relocation-identity | UIDAI List IV, rows 11 and 18 (PoI marks checked visually) |
  | Passport reissue for name change after marriage | marriage-family | Passport booklet Table 2 E.1, docs 14/56 |
  | Aadhaar enrolment for a child under 5 | birth-parenthood | UIDAI List I (marks checked visually) |
  | Instant e-PAN | employment-career | incometax.gov.in user manual |

  - Distribution: relocation & identity 6, marriage & family 3, birth & parenthood 1,
    employment & career 1, **starting a business 0** (no machine-readable official source
    verified: Udyam pages need JavaScript).
  - Data: 55 document types (+20), 38 requirements, 111 evidence excerpts. **All 111 were found
    verbatim in live fetched text**; 38/38 requirements verified; the seed is idempotent.
  - Real cross-event route: marriage registration issues a marriage certificate, which the
    Aadhaar and passport name changes accept. No prerequisite edges were invented.
- **Gaps recorded (not filled with assumptions):**
  - birth registration: the CRS FAQ is disallowed by robots.txt, so a missing birth certificate
    is shown as a blocker;
  - EPFO: FAQ PDFs return 404;
  - GST / Udyam: not verified;
  - marriage registration: Delhi only, Special Marriage Act route not modelled.
- **RAG:** the 3 new sources were ingested and chunked (21 new chunks) but **not embedded**, to
  save quota (`python -m scripts.embed`, about 2 requests). The assistant uses the new services'
  verified facts; keywords were added for the new services.
- **Frontend:**
  - dashboard: hero, life-event cards with live counts, how-it-works, saved-plan progress, trust
    note;
  - services catalogue: search (EN/HI), life-event filter chips (in the URL), tags, honest empty
    states;
  - planner: picker grouped by life event; life-event tags on service detail; nav icons;
  - new assistant examples; all new strings in English and Hindi.
- **Tests:** backend 202 passed (new `test_life_events.py`); frontend 34 passed (new
  `lifeEvents.test.tsx`); typecheck, lint, build and `alembic check` clean. Real-app check: no
  console errors, no failed requests, no horizontal overflow at 390 px.
- **Gemini calls this milestone: 0.** No model, billing or provider change.

## Milestone 7 — frontend redesign (2026-11-14)
- **Design system:** tokens (navy primary, saffron next-action accent, warm-neutral surfaces),
  editorial serif headings with Devanagari fallbacks, `buttonClass`, `PageHeader`, logo mark,
  focus rings, reduced-motion support.
- **Shell:** refined sidebar with active indicator, language switcher and sources note; mobile
  drawer; skip link.
- **Dashboard:** hero with a "describe your situation" hand-off to the assistant (pre-filled, never
  auto-sent), live life-event counts, saved-plan progress plus live next action (deterministic
  planner), how-it-works and trust sections.
- **Services and detail:** card hierarchy; typed requirement groups with colour-coded edges and
  alternative grids; sticky actions/side panel; refined evidence quotes.
- **Planner:** progress panel, saffron next-action card, numbered journey timeline, and grouped
  acquisition reasons (display only; planner logic unchanged).
- **Assistant:** chronological conversation, welcome state with example cards, docked composer,
  retry on error.
- **Checks:** frontend-only changes (no backend, API or migration changes). Vitest 37 passed (3
  new); typecheck, lint and build clean. Real-app screenshots in EN/HI and at 390 px: no overflow,
  0 console errors, 0 failed requests, 0 Gemini calls.

## Milestone 8 — premium UI pass (2026-11-14)
- **Foundation:** route-level code splitting (`app/lazyPages.tsx` + `Suspense`; main JS 510 → 279 kB),
  workflow status tokens (`done/ready/waiting/blocked`), `blueprint` navy grid surface.
- **Dashboard:** navy hero with the situation input first, life-event quick links and live
  coverage stats from the API; saved-plan strip (live next action + progress) or a start prompt;
  4-step process; life-event list; trust section.
- **Planner:** explanatory panel and status legend before generation; status icons on steps and
  "Completing this unlocks: …" from the plan's `unblocks` (backend data only).
- **Services/detail:** search + life-event filter panel with counts and a context banner;
  at-a-glance requirement counts on the detail page.
- **Documents:** search, category index, accepted-by/issued-by service links.
- **Assistant:** evidence-first opening state (S/K/AI legend) and saved-plan suggestions.
- **Checks:** frontend only. Vitest 43 passed (6 new); typecheck, lint, build clean. Real-app
  journey (select → generate → untick/re-tick → mark done → reload) verified; EN/HI, 390 px:
  no overflow, 0 console errors, 0 failed requests, 0 Gemini calls.

## Milestone 9 — visual identity "Paper & Route" (2026-11-14)
- Replaced the navy/white/saffron look: warm paper, green-black ink, jade (verified), lime (next
  action only), crimson (blockers), lilac (AI); Fraunces + Manrope, Tiro/Noto for Hindi; top-bar
  navigation with an ink footer; transit-route motif (logo, dashboard, planner).
- Dashboard: editorial hero + situation input, route-drawn "how it works" panel with live stats,
  boarding-pass saved plan (live next action, stop strip), life-event bento with live service names.
- Services: life-event index rail, catalogue grouped by primary event, ledger rows. Detail: tinted
  hero, numbered / "if" / open markers instead of badges, "or" alternatives, ink "you receive".
- Planner: route map (completed segment, numbered stops, parallel groups, "You are here"), stop
  overview strip, ink next-action panel, crimson blockers. All data from the backend plan.
- Documents: relationship rows (issued-by / accepted-by lanes, usage meter). Assistant: centred
  composer that docks once a conversation starts, AI/fact/excerpt colour separation, skeleton loading.
- Checks: Vitest 45 passed (2 new); typecheck, lint, build clean. Real app EN/HI, 1440/390 px: no
  overflow, 0 console errors, 0 failed requests, 0 Gemini calls; journeys re-verified.

## Milestone 10 — process-level workflow engine (2026-11-14)
- **Model:** `goals` on services (migration `0006`, applied; seeded). Process states, user-reported vs
  official completion, document states, in-progress steps, progress/document summaries, notices,
  clarifications. Dependency edges now carry acceptance evidence as well as producer evidence.
- **Engine:** jurisdiction-aware repair (Delhi-only marriage registration is never used for another
  state; unknown state asks). Follow-up next action. Documents never complete a service.
- **Discovery:** deterministic goal → service mapping with jurisdiction and existing-record checks and
  structured questions. **AI situation reader** implemented and tested with fakes only (quota exhausted).
- **Frontend:** "Your situation" (goals, state, AI reader with review, suggestions, questions), per-step
  progress control, document condition, completion condition, alternatives, separate document
  readiness, out-of-state blocker text, "reported by you" everywhere completion is shown.
- **Checks:** backend 238 passed (36 new), frontend 55 passed (10 new); ruff, alembic check, typecheck,
  lint, build clean. Real-app journey (discovery → repair in Delhi → Maharashtra block → submitted →
  completed → expired passport → reload → dashboard), EN/HI, 390 px: 0 errors, 0 AI calls.

### Persistence & consistency fixes (2026-11-14, after audit)
- Assistant now plans with the same progress, document states and state as the planner (frontend,
  `WorkflowInput`, route); plan summary adds state/progress/unusable/notice lines only when present.
- A document marked expired/invalid/unsure is never satisfied by a completed service's output.
- `usePlannerState`: versioned value (v2, v1 loads unchanged), no write on load, unknown fields kept,
  stale-tab writes merge onto the latest stored copy, `storage` event sync, no pruning on empty/failed
  lists, goals pruned against the vocabulary, "I don't have it" clears the condition.
- Removed/re-added service keeps reported progress; out-of-plan progress is shown with a clear action.
- Post-fix browser audit (real app, isolated headless Chrome, Gemini replaced by an offline fake):
  found and fixed (1) near-simultaneous edits in two tabs could drop one tab's change (Chrome's
  per-tab storage cache) → `selectionSync.ts` re-applies the missing change, same item: later edit
  wins; (2) reviewed AI "you do not have X" left X held → now un-held. Checks: backend 243 passed,
  frontend 73 passed; ruff, alembic check, typecheck, lint, build clean.

## Milestone 11 — situation → workflow journey (2026-11-14)
- Assistant page is the entry point: describe → AI facts (reviewed, editable; manual path without AI)
  → `POST /api/workflows/propose` (deterministic discovery + existing planner) → review (outcomes with
  reasons, planner-added prerequisites, order/parallel/blockers, alternatives, evidence, coverage note)
  → add/remove services and regenerate → explicit accept (merge or replace) → planner.
- Extraction adds document conditions. No migration. No new services or data.
- Checks: backend 259 passed, frontend 88 passed; ruff, typecheck, lint, build clean. Real-browser E2E
  (Gemini replaced by an offline fake): 17/17. Independent review by a second Claude model (Sonnet);
  its 3 confirmed defects fixed with regression tests.
- Pending: live Gemini validation of the situation reader (quota exhausted).

## Remaining work
- [ ] Validate the AI situation reader (`/api/situation/interpret`) against live Gemini when quota allows.
- [ ] Verified service prerequisites: none found in official sources yet (engine supports them).
- [ ] Persist workflows server-side (currently localStorage); departmental status integration (read-only).
- [ ] Complete the answer evaluation and the A/B/C baselines when Gemini quota allows (≤ 85 requests).
- [ ] Narrow relocation detection (generic "new address" phrases over-include services).
- [ ] Starting-a-business services (Udyam, GST) and birth registration: find machine-readable official sources.
- [ ] Embed the 21 new chunks (`python -m scripts.embed`, ~2 requests) when quota allows.
- [ ] Persist usage counters across API restarts.

## Later
- [ ] Scheduled re-ingestion and a review queue for `needs_review` items
