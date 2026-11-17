# GovPath AI

A bilingual (English/हिन्दी) navigator for Indian government services. A citizen describes their
situation (for example "I got married in Delhi and want my new name on Aadhaar and my passport").
GovPath then tells them **which services they need, in which order, with which documents, and what
to do next**. Every requirement cites an official `*.gov.in` source.

GovPath AI is an informational guide. It does not submit applications, guarantee eligibility or
give legal advice.

**Key contribution.** GovPath combines verified structured knowledge, a deterministic dependency
planner and official-source retrieval. AI only reads the citizen's description and explains the
computed plan. It never decides requirements, dependencies or order.

## How it works
| Layer | What it does | AI involved? |
|---|---|---|
| **Verified knowledge base** (`data/knowledge`, `backend/app/knowledge`) | 16 services, 65 document types, 18 official sources, 168 verbatim evidence excerpts. Requirements are mandatory, optional or conditional. A requirement's documents are an "any one of" group; separate requirements are all needed. | No |
| **Official-source ingestion** (`backend/app/ingestion`) | Allowlisted HTTPS `*.gov.in` pages and PDFs only, robots.txt honoured. Text is hashed, and every curated excerpt is re-checked against the fetched text. A changed source becomes `needs_review`. Scraped never means verified. | No |
| **Deterministic planner** (`backend/app/workflow`, pure Python) | Discovery from goals/life events → targets → acquisition routes (e.g. marriage registration issues the certificate both name updates need) → `graphlib` topological stages (parallel groups) → blockers → next-best action with a structured reason. Jurisdiction-aware; re-plans on every document, progress or expiry change. | No |
| **RAG** (`backend/app/rag`) | Source text → chunks → `gemini-embedding-2` vectors (768 dims, pgvector HNSW cosine) → retrieval with a similarity threshold and per-source cap → chunks linked to verified evidence. | Embeddings only |
| **Situation reader** (`backend/app/llm/situation.py`) | Gemini turns free text into closed-vocabulary facts (goals, state, held/lacking documents, requested services). The citizen reviews and edits them before anything is planned or saved. | Yes, extraction only |
| **Grounded assistant** (`backend/app/rag/assistant.py`) | Gemini explains retrieved excerpts, verified facts and the planner's result. Citations are validated server-side, and unknown ids are dropped. With no evidence it abstains without calling the model. | Yes, explanation only |
| **Accounts** (`backend/app/account`, Supabase Auth) | My Plans (any number of saved plans), document vault with expiry, reported progress and activity history. The user id comes only from the verified token; RLS is on for every table. | No |

More detail: [docs/architecture.md](docs/architecture.md). Evaluation: [docs/evaluation.md](docs/evaluation.md).
Status and history: [PROGRESS.md](PROGRESS.md).

## Coverage (verified services)
| Life event | Services |
|---|---|
| Relocation & identity | Aadhaar address update · Aadhaar mobile number update · Voter ID address change (Form 8) · New voter registration (Form 6) · Driving licence address change / renewal / duplicate · Vehicle RC address change / duplicate RC · Passport reissue (change of address) · Fresh passport (adult, first passport) |
| Marriage & family | Marriage registration (Delhi, Hindu Marriage Act) · Aadhaar name update · Passport reissue (name change after marriage) |
| Birth & parenthood | Aadhaar enrolment for a child under 5 |
| Employment & career | Instant e-PAN · Fresh passport |

Starting-a-business has no verified services. Marriage registration covers Delhi only.
Parivahan pages describe the national process; state transport departments may differ.

## Stack
- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS v4, TanStack Query, react-i18next, `supabase-js` (auth only).
- **Backend:** Python 3.12+, FastAPI, SQLAlchemy 2 (async, psycopg 3), Alembic.
- **Database:** Supabase PostgreSQL + pgvector.
- **AI:** Google Gemini via `google-genai` (`gemini-3.6-flash`, `gemini-embedding-2`).
- **Not used:** LangChain, graph databases, Docker, microservices, autonomous agents.

## Setup
Prerequisites: Node.js 22+, Python 3.12+, a PostgreSQL database with pgvector (Supabase in
production), and a Gemini API key (free tier works) for the AI features.

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
cp .env.example .env            # DATABASE_URL, SUPABASE_URL, GEMINI_API_KEY ... (never commit .env)

cd ../frontend
npm install
cp .env.example .env.local      # VITE_API_BASE_URL, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
```

### Environment variables
| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `DB_SSLMODE` | Postgres URL (Supabase session pooler) and TLS mode (`require`; `disable` for a local database). |
| `SUPABASE_URL` | Project URL. Access tokens are verified against its public JWKS, so no secret key is needed. |
| `CORS_ORIGINS` | Allowed browser origins (comma-separated). |
| `CRON_SECRET` | Enables `POST /api/internal/expire-documents` (header `X-Cron-Secret`). Empty disables it. |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`, `EMBEDDING_DIM` | AI features. Without a key the AI endpoints return 503 and everything else works. `EMBEDDING_DIM` must stay 768. |
| `GEMINI_DAILY_*_LIMIT`, `GEMINI_MIN_INTERVAL_SECONDS`, `GEMINI_MAX_RETRIES` | Free-tier protection (per API process). |
| `RAG_TOP_K`, `RAG_MIN_SIMILARITY` | Retrieval (5, 0.66: tuned on the evaluation set). |
| `RATE_LIMIT_ENABLED`, `RATE_LIMIT_AI_PER_MINUTE`, `RATE_LIMIT_AI_PER_DAY`, `RATE_LIMIT_TRUSTED_PROXY_HOPS` | Per-client-IP limits on the two public AI endpoints (defaults: on, 5/minute, 30/day, 0 trusted proxies). Exceeding them returns `429 rate_limited` with `Retry-After`, before any Gemini call. |
| `KNOWLEDGE_CACHE_SECONDS`, `ASSISTANT_CACHE_SECONDS` | Read-cache and answer-cache lifetimes. |
| Frontend `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Public values only. Never put a service-role key in the frontend. Without the Supabase values the app runs without accounts. |

## Build the data (from `backend/`)
```bash
.venv/bin/alembic upgrade head                 # schema (pgvector, knowledge base, accounts, RLS)
.venv/bin/python -m scripts.seed --check       # validate the curated files; no database writes
.venv/bin/python -m scripts.seed               # load verified knowledge (idempotent)
.venv/bin/python -m scripts.ingest             # fetch allowlisted official sources (robots.txt-aware)
.venv/bin/python -m scripts.seed               # re-check every evidence excerpt against the fetched text
.venv/bin/python -m scripts.embed --dry-run    # chunk the text; report what needs embedding (no API calls)
.venv/bin/python -m scripts.embed              # embed new/changed chunks only (uses Gemini quota)
```
All four commands are idempotent. A second run creates nothing, and `embed` skips chunks that
already have a current embedding. `scripts.ingest` reports every failed source and never creates
rows for one. Run it again later; robots.txt or network errors are often temporary.

## Run
```bash
cd backend  && .venv/bin/uvicorn app.main:app --port 8000     # API; docs at http://localhost:8000/docs
cd frontend && npm run dev                                     # app at http://localhost:5173
```

## Demonstration flow (about 8 minutes)
1. **Describe a situation** (Assistant page, signed in, profile state Delhi): "I got married in Delhi and want
   to update my name on Aadhaar and my passport. I already have my Aadhaar card and passport, but I don't have a
   marriage certificate yet."
2. **AI interpretation, reviewed:** GovPath shows the extracted goal, state (labelled "from your description"),
   requested services, and held/missing documents. Edit any field, then continue. Without AI, the same form can be filled manually.
3. **Proposed workflow:** the planner adds Marriage registration (Delhi), because it issues the marriage
   certificate both name updates need. Stage 1 is marriage registration; stage 2 has the two name updates in parallel.
   The next action is the separate affidavits, a document no service issues. Accept and save it to My Plans.
4. **Dependency-aware journey:** open the plan. The timeline shows each requirement as satisfied, missing or
   "any one of". The issues panel lists each blocker. Mark marriage registration as started and the plan recalculates.
5. **Official evidence:** expand any requirement to see the verbatim excerpt, source URL and verification date.
   Services → a service shows the same evidence.
6. **Vault and progress:** add the marriage certificate (with an expiry date) in the vault. Every active plan
   recalculates, and the name updates become ready. History shows the recalculation.
7. **Clarification and safety:** "I need to renew my passport" gets a question about which case applies,
   not a guessed service. "Something else" says GovPath does not cover it, and nothing is saved.
8. **English/हिन्दी:** switch language in the top bar. The services, requirements, reasons and blockers are
   all localised, and official quotes stay in English. Check a phone width (390 px).

Steps 1–2 and 7 use live Gemini (one generation request each). Everything else is deterministic.

## API (main endpoints)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health`, `/api/health/db` | Liveness; DB + pgvector status |
| GET | `/api/services`, `/api/services/{id}`, `/api/documents` | Verified knowledge with evidence |
| POST | `/api/workflows/discover`, `/api/workflows/propose`, `/api/workflows/plan` | Deterministic discovery, proposal and plan |
| POST | `/api/situation/interpret`, `/api/me/situation/interpret` | AI fact extraction (reviewed before use) |
| POST | `/api/assistant/query` | Grounded explanation with validated citations |
| GET/POST/PATCH/DELETE | `/api/me/profile`, `/documents`, `/progress`, `/plans`, `/proposal`, `/dashboard`, `/activity` | Signed-in account (token `sub` only) |
| POST | `/api/internal/expire-documents` | Daily expiry run (`X-Cron-Secret`) |

Errors: `401` missing/invalid token, `404` another user's id, `422` validation / `unknown_ids`, `409` dependency
cycle, `429` quota, `503` AI not configured / index not built / model unavailable, `502` model error.

## Tests
```bash
cd backend  && .venv/bin/pytest && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/alembic check
cd frontend && npm test && npm run typecheck && npm run lint && npm run build
```
Tests use in-memory SQLite and fake Gemini clients. They cannot reach Supabase or the real
Gemini API.

## Known limitations
- **Coverage:** 16 services. There are no fees, processing times, Tatkaal, minors (except child Aadhaar),
  police verification, inter-state vehicle re-registration or other state-specific rules. Accepted
  documents are the listed subset.
- **Documents you haven't ticked count as missing.** The plan says so ("Tick one if you have it").
  Only the Aadhaar-registered mobile and existing records needed by discovery are asked about explicitly.
- **AI:** the situation reader was validated live on three scenarios (see `evidence/live-ai-validation/`).
  The answer evaluation covers 19/26 cases; the LLM-only and RAG baselines are pending (free-tier quota).
  Usage caps are per process and in memory.
- **Rate limits are in memory:** the per-IP limits on `/api/situation/interpret` and
  `/api/assistant/query` reset when the API process restarts and are not shared between
  instances or workers (run one instance with one worker).
- **Not authoritative:** an informational guide. It does not submit applications, decide eligibility or
  integrate with department status systems.
