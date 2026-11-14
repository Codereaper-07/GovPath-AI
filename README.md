# GovPath AI

A bilingual (English/हिन्दी) navigator for Indian government services. It tells a citizen
**what to do, in which order, with which documents** to update their address across Aadhaar,
Voter ID (Form 8), driving licence, vehicle RC and passport, and it explains everything with
citations to official sources.

GovPath AI is an informational guide. It does not submit applications, guarantee eligibility or
give legal advice.

**Key contribution.** GovPath AI combines official-source-grounded retrieval, structured
government-service knowledge, deterministic dependency reasoning and personalised workflow
planning to help citizens navigate government procedures.

## What makes it different
| Layer | What it does | AI involved? |
|---|---|---|
| **Verified knowledge base** | Requirements curated from official `*.gov.in` sources. Every requirement carries a verbatim excerpt, source URL and verification date. Mandatory, optional and conditional requirements are kept apart, with "any one of" alternative groups. | No |
| **Deterministic workflow planner** | Dependency graph and `graphlib` topological order, parallel groups, blockers, acquisition routes (e.g. "update Aadhaar first to get an address proof the DL office accepts"), and the next-best action with a structured reason. It never invents dependencies. | No |
| **Official-source RAG** | Ingested official pages and PDFs → chunks → `gemini-embedding-2` vectors in pgvector → cosine retrieval with a tuned threshold. | Embeddings only |
| **Grounded assistant** | Gemini (`gemini-3.6-flash`, configurable) *explains* retrieved excerpts, verified facts and the planner's result. Citations are validated server-side, and answers are labelled AI-generated. With no evidence it abstains instead of guessing. | Yes, explanation only |

Evaluation against LLM-only, ordinary-RAG and RAG + knowledge baselines: [docs/evaluation.md](docs/evaluation.md).
Architecture: [docs/architecture.md](docs/architecture.md). Status: [PROGRESS.md](PROGRESS.md).

## Stack
- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS v4, TanStack Query, react-i18next.
- **Backend:** Python 3.12+, FastAPI, SQLAlchemy 2 (async, psycopg 3), Alembic.
- **Database:** Supabase PostgreSQL 17 + pgvector (HNSW cosine).
- **Ingestion:** httpx, BeautifulSoup, PyMuPDF.
- **AI:** Google Gemini via the official `google-genai` SDK.
- **Not used:** LangChain, Docker, microservices.

## Setup
Prerequisites: Node.js 22+, Python 3.12+, a Supabase project, a Gemini API key (free tier works).

```bash
# Backend
cd backend
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
cp .env.example .env            # set DATABASE_URL and GEMINI_API_KEY (never commit .env)

# Frontend
cd ../frontend
npm install
cp .env.example .env.local      # optional; defaults to http://localhost:8000
```

### Environment variables (`backend/.env`)
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase Postgres URL (session pooler). Special characters in the password are encoded automatically. |
| `GEMINI_API_KEY` | Gemini key. The assistant returns 503 without it; everything else still works. |
| `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`, `EMBEDDING_DIM` | `gemini-3.6-flash`, `gemini-embedding-2`, `768` (must match the vector column). |
| `GEMINI_DAILY_GENERATION_LIMIT`, `GEMINI_DAILY_EMBEDDING_LIMIT`, `GEMINI_MIN_INTERVAL_SECONDS`, `GEMINI_MAX_RETRIES` | Free-tier protection (per API process). |
| `RAG_TOP_K`, `RAG_MIN_SIMILARITY` | Retrieval (5, 0.66: tuned on the evaluation set). |
| `KNOWLEDGE_CACHE_SECONDS`, `ASSISTANT_CACHE_SECONDS` | Read-cache and answer-cache lifetimes. |
| `CORS_ORIGINS` | Allowed browser origins (default `http://localhost:5173`). |

## Build the data (from `backend/`)
```bash
.venv/bin/alembic upgrade head                 # schema: pgvector, knowledge base, Hindi names, chunks
.venv/bin/python -m scripts.seed               # curated verified knowledge (idempotent)
.venv/bin/python -m scripts.ingest             # fetch allowlisted official sources (robots.txt-aware)
.venv/bin/python -m scripts.seed               # re-check every evidence excerpt against fetched text
.venv/bin/python -m scripts.embed --dry-run    # how many chunks and requests; no API calls
.venv/bin/python -m scripts.embed              # embed new/changed chunks only (uses Gemini quota)
.venv/bin/python -m scripts.check_gemini       # optional manual smoke test (2 API calls)
```
`scripts.embed` saves progress after each batch. If it stops on a rate limit, run it again and it
continues where it stopped.

## Run
```bash
cd backend  && .venv/bin/uvicorn app.main:app --port 8000     # API + docs at http://localhost:8000/docs
cd frontend && npm run dev                                     # app at http://localhost:5173
```

## Use
1. **Services**: browse the five services and open one to see mandatory, optional and
   conditional documents, accepted alternatives, and the official quotes behind each requirement.
2. **Workflow planner**: tick the services you need and the documents you have, then
   "Generate my plan". You get the next step, blockers, parallel groups and dependencies. Ticking a
   document or marking a step done recalculates the plan immediately.
3. **Documents**: which services accept or issue each document.
4. **Assistant**: ask in English or Hindi. Answers cite `[S#]` official excerpts and `[K#]`
   verified facts, and can use your saved plan. Unsupported questions get an explicit "not enough
   evidence".
5. Switch language with the selector in the top bar.

## API
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health`, `/api/health/db` | Liveness; DB + pgvector status |
| GET | `/api/services`, `/api/services/{id}` | Verified services, requirements, evidence |
| GET | `/api/documents` | Document types with issuing/accepting services |
| POST | `/api/workflows/plan` | Deterministic plan `{target_service_ids, owned_document_ids, completed_service_ids}` |
| POST | `/api/assistant/query` | Grounded AI explanation `{question, language?, workflow?}` |

Errors: `422` validation / `unknown_ids`, `409` dependency cycle, `429` `quota_exhausted` /
`rate_limited`, `503` `assistant_not_configured` / `index_not_built` / `model_unavailable`,
`502` `model_error`. Responses never include keys, prompts or raw provider errors.

## Limitations
- **Coverage:** five address-change services, a subset of accepted documents, and no fees,
  processing times, inter-state vehicle re-registration or state-specific rules. RC "proof of new
  address" is not enumerated by Parivahan, so GovPath says so instead of guessing.
- **Not authoritative:** an informational guide only. No application submission and no
  eligibility decisions.
- **Evaluation:** the planner and retrieval are fully evaluated. The answer evaluation covers 19/26
  cases, and the LLM-only / RAG baselines are still pending because of the Gemini free-tier quota
  (see [docs/evaluation.md](docs/evaluation.md)).
- **Usage caps:** daily caps and throttling are per API process and in memory.

## Tests
```bash
cd backend  && .venv/bin/pytest && .venv/bin/ruff check . && .venv/bin/alembic check
cd frontend && npm test && npm run typecheck && npm run lint && npm run build
```
Tests use in-memory SQLite and faked Gemini calls. They cannot reach Supabase or the real Gemini
API.

Evaluation (real API, cached): `.venv/bin/python -m evaluation.run retrieval|answers|report`,
using the dataset in `data/evaluation/scenarios.json`.
