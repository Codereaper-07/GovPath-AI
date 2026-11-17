# GovPath AI — Production deployment checklist (prepared, not executed)

Nothing here has been run against production. Every step that writes to production (migrations,
seeding, ingestion, embedding, Auth settings) needs the owner's explicit go-ahead at the time.

## 0. Before you start
- [ ] Working tree reviewed and committed. The batch-1 knowledge expansion and the seed fix
      (`knowledge/seed.py`: a first fetch is not a content change) must be in the deployed code
      **before** the production seed/ingest in step 4.
- [ ] Local gate passes:
      `pytest`, `ruff check .`, `ruff format --check .`, `alembic check`, `npm test`, `npm run typecheck`,
      `npm run lint`, `npm run build`, `python -m scripts.seed --check`
      (expected `16 services, 65 document types, 18 sources, 168 evidence excerpts`).
- [ ] Take a Supabase backup or note the point-in-time-recovery window. The live database holds real user accounts.

## 1. Secrets and environment
Store everything in the host's secret store. Never put it in the repository, the build logs or the frontend bundle.

| Where | Variable | Value |
|---|---|---|
| Backend | `APP_ENV` | `production` |
| Backend | `DATABASE_URL` | Supabase **session pooler** URL (the `postgres` role) |
| Backend | `DB_SSLMODE` | `require` |
| Backend | `SUPABASE_URL` | `https://<project-ref>.supabase.co` (tokens are verified against its public JWKS) |
| Backend | `CORS_ORIGINS` | the exact production frontend origin(s), e.g. `https://govpath.example.in`. Never `*` |
| Backend | `CRON_SECRET` | a long random value (e.g. `openssl rand -hex 32`) |
| Backend | `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.6-flash`, `GEMINI_EMBEDDING_MODEL=gemini-embedding-2`, `EMBEDDING_DIM=768` | server-side only |
| Backend | `GEMINI_DAILY_GENERATION_LIMIT`, `GEMINI_DAILY_EMBEDDING_LIMIT`, `GEMINI_MIN_INTERVAL_SECONDS`, `GEMINI_MAX_RETRIES` | set to the plan's quota |
| Backend | `KNOWLEDGE_CACHE_SECONDS` | `60` (default) |
| Frontend (build time) | `VITE_API_BASE_URL` | the backend's public HTTPS URL, no trailing slash |
| Frontend (build time) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | public values only |

- [ ] **No service-role or secret key anywhere**, backend or frontend. The backend never needs one.
- [ ] `grep -r "service_role\|sb_secret" frontend/dist` finds nothing after the build.

## 2. Backend hosting (FastAPI)
- [ ] One web service running Python 3.12+: `pip install .`, then
      `uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers`.
- [ ] Run **one worker**. The Gemini usage caps are in memory per process, so several workers multiply the effective cap.
- [ ] HTTPS only, behind the host's TLS. Health check path `/api/health`.
- [ ] Outbound HTTPS is allowed to Supabase, Gemini and the allowlisted `*.gov.in` hosts (the last only for ingestion runs).

## 3. Frontend hosting (static)
- [ ] `npm ci && npm run build` with the `VITE_*` variables set; publish `frontend/dist`.
- [ ] SPA fallback: unknown paths serve `index.html` (`/planner`, `/vault`, `/services/<id>` …).
- [ ] Long cache for `/assets/*` (hashed names), no cache for `index.html`.

## 4. Supabase production configuration
**Auth** (dashboard → Authentication):
- [ ] Site URL = the frontend origin; redirect allow-list includes `<origin>/profile`.
- [ ] Email/password enabled, email confirmation on, minimum password length 8.
- [ ] Custom SMTP configured (the built-in sender is rate-limited).
- [ ] Live Auth test: sign-up → confirm → sign-in → refresh → sign-out (never done against live Auth yet).

**Database** (from `backend/`, with the production `.env`, after approval):
- [ ] `alembic current` reports `0009_document_expiry (head)`. Batch 1 needs **no new migration**
      (`alembic check` is clean, and goals/life events are JSON lists). If it isn't at head, `alembic upgrade head`.
- [ ] `python -m scripts.check_rls` (one transaction, always rolled back): every check passes
      (RLS on, `anon`/`authenticated` revoked, own-row reads only).
- [ ] **Knowledge base**, in this order:
  1. `python -m scripts.seed --check` (no writes)
  2. `python -m scripts.seed` (adds 6 services, 10 document types, 5 sources and 57 excerpts; updates the rest in place)
  3. Ingest **only the five new batch-1 sources**. Do not re-ingest the 14 existing sources: a page
     that changed since its last fetch would become `needs_review` and hide verified requirements of
     the live services. (The preflight found their production text identical to the local text, so
     they need no re-fetch.)
     ```bash
     U="--url https://voters.eci.gov.in/guidelines/Form-6_en.pdf --url https://voters.eci.gov.in/formspdf/Form_6_English.pdf --url https://parivahan.gov.in/en/content/renewal --url https://parivahan.gov.in/en/content/duplicate-licence --url https://parivahan.gov.in/en/content/duplicate-rc"
     python -m scripts.ingest --dry-run $U   # fetch + extract only; no database access
     python -m scripts.ingest $U
     ```
     Each of the five should be `new` with all excerpts found. Re-run any `failed` source on its own
     with `--url` (robots.txt 503s and connection resets were seen and were temporary).
  4. `python -m scripts.seed` again. Expected `verification status`: all 18 curated sources and 168
     excerpts `verified`, 56 requirements `verified` (one linked UIDAI PDF stays `unverified`; it is not curated).
     Investigate any `needs_review` before going live.
- [ ] Existing user data is untouched: the seed only writes knowledge tables, and plans are re-evaluated on their next account read or write.

## 5. RAG index readiness
- [ ] `python -m scripts.embed --dry-run` shows the pending chunks. It makes no Gemini calls and creates
      no embeddings, but it **does write to the database**: it first syncs chunk rows (creates missing
      chunks, removes stale ones) and commits, then counts. Treat it as a production write.
      Locally the full catalogue is 236 chunks (19 sources). The preflight expects production to show
      236 total (16 new from the five new sources) and about 37 pending: the 16 new plus 21 existing
      chunks that were never embedded (marriage registration and Instant e-PAN).
- [ ] `python -m scripts.embed` (batches of 16, so the ~37 pending chunks need about 3 Gemini requests).
      It saves progress after every batch and resumes after a rate limit.
- [ ] `GET /api/health/db` reports pgvector; a dry run reports `0 need embedding`.
- [ ] One assistant question with citations (counts against quota).

## 6. Scheduled document expiry
- [ ] Daily job just after 00:00 IST (18:35 UTC):
      `curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" https://<api>/api/internal/expire-documents`
      (or run `python -m scripts.expire_documents` on the host). The job is idempotent; expiry also catches up on every account read.
- [ ] First run: `python -m scripts.expire_documents --dry-run`.

## 7. Security checks
- [ ] `CORS_ORIGINS` is the production origin only; preflight from another origin is refused.
- [ ] `/api/me/*` without a token returns 401; with another user's plan or document id it returns 404.
- [ ] `/api/internal/expire-documents` without or with a wrong secret is refused.
- [ ] No `.env` in the repository or image; logs contain no keys, prompts or raw provider errors.
- [ ] Supabase: RLS check passes (step 4); the Data API exposes no knowledge-table writes.
- [ ] Gemini daily limits set below the plan quota.

## 8. Post-deployment smoke tests
- [ ] `GET /api/health` → 200; `GET /api/health/db` → database + pgvector OK.
- [ ] `GET /api/services` → 16 services; a service page shows evidence with source URL and date.
- [ ] Frontend loads in English and Hindi with no console errors; a 390 px phone width has no horizontal scroll.
- [ ] Sign up a test account, set profile state Delhi, create a plan for Aadhaar name update +
      passport name change. Expect marriage registration first, then both updates in parallel; next step = the affidavits.
- [ ] Add a vault document: the plan recalculates and History shows it. Delete the test data afterwards.
- [ ] One situation description (one Gemini request): review screen → proposal → do not save.
- [ ] One assistant question (one Gemini request) with citations.
- [ ] Expiry endpoint with the secret returns a summary (no due documents expected).

## Outstanding prerequisites (owner decisions or external access)
- Approval to seed, ingest and embed batch 1 on production, and a Gemini quota for about 3 embedding requests (~37 pending chunks in batches of 16).
- Hosting accounts for the backend and frontend, and the production domain (sets `CORS_ORIGINS` and the Auth Site URL).
- Supabase Auth SMTP and URL settings; a live Auth test.
- A scheduler for the daily expiry call.
