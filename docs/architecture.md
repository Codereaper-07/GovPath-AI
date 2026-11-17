# GovPath AI — Architecture

## Goal
Help citizens in India complete government-service workflows in English and Hindi: 16 verified
services across relocation & identity, marriage & family, birth & parenthood and employment.

## Components
| Part | Tech |
|------|------|
| `frontend/` | React 19, Vite, TypeScript, Tailwind CSS v4, React Router, TanStack Query, react-i18next |
| `backend/` | Python 3.12+, FastAPI, SQLAlchemy 2 (async, psycopg 3), Alembic |
| Database | Supabase-hosted PostgreSQL 17 + pgvector |
| Ingestion | httpx, BeautifulSoup, PyMuPDF |
| LLM / embeddings | Gemini `gemini-3.6-flash` (configurable) / `gemini-embedding-2` (768 dims) via `google-genai` |

One backend service. No LangChain, no graph DB, no Docker, no microservices.

## Layers
```
  official *.gov.in sources
            │  ingestion/ (allowlist → fetch → extract → assess → persist)
            ▼
  source_documents + evidence ◄──── knowledge/seed.py ◄── data/knowledge/*.json (curated)
            │                                              (verified requirements + evidence)
            ▼
  knowledge/ (repository: verified facts)
            │ workflow/loader.py: verified-only snapshot
            ▼
  workflow/ discovery + planner (pure, graphlib) ──► api/routes ──► frontend
            ▲                                            ▲
  account/ (vault, progress, saved plans; re-plans)      │
  rag/ (chunks → pgvector retrieval) + llm/ (Gemini): read the citizen's text into reviewed
  facts, and explain an already-computed plan with validated citations
```
- **ingestion/** collects evidence. It never marks anything verified; changed sources become
  `needs_review`.
- **knowledge/** holds structured facts: services, requirements (OR groups), outputs, verified
  prerequisites, evidence.
- **workflow/** is deterministic planning. `domain.py`, `graph.py`, `planner.py` and `errors.py`
  have no DB, web or AI imports.
- **rag/** and **llm/** never create or change plan steps, requirements or dependencies.
- Import rules are enforced by `backend/tests/test_layer_boundaries.py`.

## Data model
```
GovernmentService ─┬─< ServiceRequirement ─< RequirementOption >─ DocumentType
                   │        (mandatory | optional | conditional; options = OR group)
                   ├─< ServiceOutput >─ DocumentType          (documents the service issues)
                   ├─< ServicePrerequisite >─ GovernmentService (verified only; evidence required)
                   └─<> Evidence (service_evidence)
ServiceRequirement ─<> Evidence (requirement_evidence); option/output/prerequisite → Evidence
SourceDocument ─< Evidence      (verbatim excerpt, locator, verification status, found-in-source)
```

## Planner
1. Validate ids, then treat completed services' outputs as owned.
2. Include targets and their verified-prerequisite closure.
3. For each mandatory requirement not satisfied by an owned document: if another known service
   issues one of its options, add that service as an **acquisition** step (no cycles; prefer
   services already in the plan). Otherwise report a **blocker**.
4. Run a topological sort (`graphlib`) to get parallel stages. Step status is ready, waiting or
   blocked, and blocked dependencies propagate.
5. Next action: the ready step that unblocks the most downstream work, or the root blocker that
   frees the most steps. The reason is a structured code plus a deterministic message.

The response contains only verified facts and rule-based reasoning (`generated_by:
"deterministic-planner"`). The assistant's AI explanation is returned separately and labelled.
Two route rules: a producer that needs an existing record the citizen lacks is never used, and
a document that only the same record's update could provide is asked about, not presumed missing.

## Database connectivity
- `DATABASE_URL` accepts a plain Supabase `postgresql://` URL. It is rewritten to
  `postgresql+psycopg://`, and the credentials are percent-encoded.
- TLS via `DB_SSLMODE=require`. Prepared statements are disabled, so the Supabase pooler works.
- The API starts without a database; DB-backed endpoints return 503 until it's configured.
