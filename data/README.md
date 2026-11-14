# Data

## `knowledge/`: curated, verified knowledge (loaded by `python -m scripts.seed`)
- `documents.json`: document types (slug, name, category, description).
- `sources.json`: official sources, each with `verified_on` and verbatim `evidence` excerpts
  (stable `key`, `excerpt`, optional `locator` and `note`).
- `services/*.json`: one file per service. It lists requirements (`mandatory` | `optional` |
  `conditional`), each requirement's `options` (an **OR group**: any one document satisfies it),
  the documents the service issues (`outputs`), and verified `prerequisites`.

## `sources/allowlist.json`: ingestion configuration
Allowed domains (official `*.gov.in` only) and the exact URLs `python -m scripts.ingest` fetches.

## Rules
1. **Official government sources only.** Every requirement cites evidence: a verbatim excerpt
   from a source with URL and verification date. Excerpts are machine-checked against the
   ingested text.
2. Distinguish `mandatory`, `optional` and `conditional`; alternatives are options of one requirement.
3. A prerequisite between services is recorded **only** when an official source states it, and it
   must cite evidence. A document being *accepted as proof* is not a prerequisite. That
   relationship is captured by `outputs` + requirement options and planned as an acquisition route.
4. If something cannot be verified, leave it out (or don't cite it) and record the limitation in
   the service's `verification_notes` and in `PROGRESS.md`.
5. When an official source changes, ingestion marks it `needs_review`. Re-check the facts, then
   update `verified_on` so the seed re-verifies it.
