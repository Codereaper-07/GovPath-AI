# GovPath AI — Evaluation (2026-11-14)

Reproduce from `backend/`:
- `python -m evaluation.run retrieval` (2 embedding requests)
- `python -m evaluation.run answers` (needs Gemini generation)
- `python -m evaluation.run report` (no API calls)

Raw data: `data/evaluation/results/` (`retrieval.json`, `answers.json`, `summary.json`, `summary.md`).

## 1. Methodology
- **Dataset:** `data/evaluation/scenarios.json`, 26 hand-written citizen scenarios. Expected
  answers come **only** from the verified knowledge base (`data/knowledge`, official sources
  checked on 2026-11-14). Nothing was added to make the system pass.
- **Composition:**

  | Slice | Cases |
  |---|---|
  | English | 20 |
  | Hindi | 6 |
  | EN↔HI equivalent pairs | 5 |
  | Workflow / multi-service (planner) | 5 (incl. inter-state relocation, blocked, independent) |
  | Alternatives (OR groups) | 7 |
  | Mandatory | 4 |
  | Conditional | 2 |
  | Procedure | 4 |
  | Dependency ("is Aadhaar a prerequisite?") | 1 |
  | Conflicting rules across services | 1 |
  | Should partially answer | 4 |
  | Should abstain (no evidence / out of scope) | 3 |

- **Labels per case:** relevant official source URLs, relevant evidence keys, key terms an answer
  must mention, the expected behaviour (answer / partial / abstain) and, for workflow cases, the
  expected next action and dependency edges.
- **Retrieval relevance:** a chunk is relevant if it comes from a labelled source. Evidence
  recall counts labelled evidence excerpts that appear inside the top-5 chunks.
- **Ceiling:** production retrieval caps results at 2 chunks per source, and many questions have
  only 1–2 relevant sources. Perfect P@5 is therefore often < 1, so we also report P@5 divided by
  the best achievable value.
- **Answer scoring is automatic, rule-based and conservative:**
  - mention coverage of required terms;
  - whether a money amount or duration appears that is absent from the supplied evidence
    ("unsupported specifics");
  - abstention correctness;
  - citation precision (cited source in the labelled set);
  - next-action and dependency correctness against the hand-derived expectations.
- **No LLM judge was used.** The automatic checks are proxies and were complemented by manual
  reading of failures.

## 2. Index and model checks (real API)
- **Embedding:** `gemini-embedding-2` @ 768 dims. **199/199 chunks embedded**, 11 sources, 1
  model, all vectors 768-d and unit-normalised, 0 duplicate chunks.
- **Request cost:** 20 embedding requests plus bounded retries. The first run stopped cleanly on a
  per-minute rate limit after 96 chunks (progress saved); the resumed run embedded only the
  remaining 103. A re-run reports 0 pending.
- **Generation:**
  - `gemini-3.8-flash` returned **504 DEADLINE_EXCEEDED / 503 UNAVAILABLE** on every call
    (smoke test, a bounded probe, and a single controlled assistant request, 28.7 s → 504).
  - A single controlled request with `gemini-3.6-flash` succeeded in 6.0 s, with valid
    production-schema JSON, 1,517 prompt and 622 output tokens, and all citations valid.
  - `gemini-3.6-flash` (Stable, free tier, structured output, thinking `low`) is now the
    configured model. Its smoke test passed in 3.3 s. No automatic fallback exists.
- **Free-tier quota:** after **16** evaluation generations the API returned 429 with a per-day
  quota id. The runner stopped without retrying. Generation worked again about 20 minutes later
  (two live end-to-end questions succeeded), and one controlled resume made 2 more generations
  before the next quota stop. Generation was then halted for this session.

## 3. Retrieval (real embeddings, production settings: k = 5, max 2 chunks/source)
| Slice | Cases | P@5 | P@5 ceiling | P@5 / ceiling | Evidence R@5 | Source R@5 | MRR | Success (≥1 relevant in top 5) |
|---|---|---|---|---|---|---|---|---|
| All | 23 | 0.548 | 0.643 | **0.87** | **0.749** | 0.935 | **0.924** | **1.00** |
| English | 18 | 0.533 | 0.622 | 0.875 | 0.767 | 0.944 | 0.931 | 1.00 |
| Hindi | 5 | 0.600 | 0.720 | 0.85 | 0.686 | 0.900 | 0.900 | 1.00 |

**Threshold tuning.** `gemini-embedding-2` cosine scores are compressed:
- all chunks scored between 0.62 and 0.84;
- relevant chunks were ≥ 0.666, but irrelevant ones reached 0.78;
- every answerable question's best chunk was ≥ 0.708, while the out-of-scope PAN question's best
  was 0.651.

| Min similarity | P@5 | Evidence R@5 | MRR | Success | Abstain cases still retrieving |
|---|---|---|---|---|---|
| 0.50 (old default) … 0.65 | 0.548 | 0.749 | 0.924 | 1.00 | 3/3 |
| **0.66 (new default)** | 0.548 | 0.749 | 0.924 | 1.00 | 2/3 |
| 0.70 | 0.513 | 0.684 | 0.891 | 0.913 | 1/3 |
| 0.72 | 0.417 | 0.605 | 0.870 | 0.870 | 1/3 |

The old 0.5 threshold filtered nothing. 0.66 is the lowest value that removes clearly off-topic
retrieval: PAN now abstains **without a Gemini call** (verified in the running app). Ranking
metrics are unchanged. Higher values cost recall.

The on-topic but unanswerable questions (passport fee, Aadhaar processing time) still retrieve
related chunks (0.70–0.75). No threshold separates them; the model must say the evidence lacks the
answer. (An earlier draft claimed a precision gain at 0.68; that came from a P@k-denominator bug,
since fixed and unit-tested.)

**Failure analysis:**
- **Situational workflow questions rank weakly:**
  - `wf-aadhaar-dl-en`: evidence recall 0.0, RR 0.5. Long "I moved…, I have…" questions rank
    generic DL/UIDAI chunks above the specific address-proof rows.
  - `dl-poa-en`: RR 0.25. The Form 2 annexure chunk listing DL address proofs ranks below the DL
    FAQ and generic UIDAI table chunks.
  - This is the gap that GovPath's verified structured facts (`K#`) and the deterministic planner
    fill: the answer does not depend on the right chunk ranking first.
- **Table rows without their marks:** for `aadhaar-dl-as-poa-en`, the decisive information (the
  PoA column "not allowed" mark for driving licence) is an image in the UIDAI PDF. Retrieval finds
  the row, but the text cannot show the mark. Only the curated fact list (where DL is absent from
  accepted PoA) supports the right answer.
- **Hindi:** retrieval is on par with English (P@5/ceiling 0.85 vs 0.875, success 1.0). Hindi
  similarity scores run about 0.01–0.03 lower, which is another reason for the conservative
  threshold.

## 4. Deterministic planner (independent of Gemini)
- **Expected outcomes:** all 5 workflow scenarios match their hand-derived next action and
  dependency edges (`test_evaluation_workflow_expectations_hold`):
  - Aadhaar before DL when only a utility bill is held (EN and HI);
  - three services fully independent with a registered rent agreement;
  - inter-state DL + RC → obtain a document first (blocked);
  - RC with no address proof → blocker.
- **Other properties, covered by 47 planner tests on synthetic and real data:**
  - topological order and parallel groups;
  - OR groups, optional and conditional requirements never blocking;
  - acquisition routes, with cycle-avoiding route choice;
  - unknown ids (422) and prerequisite cycles (409);
  - replanning after a document is obtained or reported missing (`test_replan_after_document_reported_missing`);
  - stability under repetition and input order;
  - no dependency invented between satisfied services.
- **Layering:** `knowledge/`, `ingestion/` and `workflow/` import no `rag/` or `llm/` code, and the
  planner core imports no DB or web modules (AST-checked in tests).
- **Gemini's role:** it receives the plan only as text and its output never feeds back into it. The
  assistant response echoes the planner's next action separately (`workflow.generated_by =
  "deterministic-planner"`).

## 5. Answer quality and baseline comparison

### What each system includes
| System | Official excerpts (RAG) | Verified structured facts | Deterministic planner | Prompt |
|---|---|---|---|---|
| A · LLM-only | – | – | – | generic helpful-assistant prompt (+ the 5 service ids for structured fields) |
| B · Ordinary RAG | ✓ same retrieval | – | – | generic "answer from excerpts, cite [S#]" |
| C · RAG + structured knowledge | ✓ | ✓ | – | GovPath grounding rules |
| **GovPath (proposed)** | ✓ | ✓ | ✓ (plan computed in Python; Gemini only explains it) | GovPath grounding rules + plan |

### Completion status (honest)
| System | Cases run | Missing |
|---|---|---|
| GovPath (proposed) | **19 / 26** | 5 workflow + 2 should-abstain cases (all need generation) |
| C · RAG + structured knowledge | 0 / 26 | all (blocked by free-tier quota) |
| B · Ordinary RAG | 0 / 26 | all |
| A · LLM-only | 0 / 26 | all |

**The baseline comparison was not performed.** No baseline numbers are reported or estimated. The
runner caches every response, so `python -m evaluation.run answers P,C,B,A` resumes exactly
where it stopped once quota is available (at most 85 more generation requests).

### Proposed system: automatic metrics (19 cases: 15 EN, 4 HI)
| Metric | Result |
|---|---|
| Schema validity | 19/19 (0 parse/schema errors) |
| Answers with ≥1 validated citation (answer cases) | 100% |
| Invalid citation ids reaching the user | 0 (validated server-side) |
| Citation precision (cited source in the labelled set) | 0.836 (EN 0.795, HI 0.979) |
| Required-term coverage | 0.941 (EN 0.962, HI 0.875) |
| Answers stating an unsupported fee/duration | **0** |
| Expected-behaviour accuracy (automatic) | 0.842 (16/19); EN 0.80 (12/15), HI 1.0 (4/4) |
| Abstention (out-of-scope PAN) | 1/1, with no generation call |
| Invented service dependencies | 0 |
| EN↔HI pairs (4 completed) | same evidence status 4/4; cited-source Jaccard 0.75 |
| Latency per generation | median 5.4 s, mean 5.5 s, max 9.4 s |

The workflow next-action and dependency metrics for the *answers* need the pending workflow cases.
The planner itself is validated deterministically in §4 (5/5 expectations).

### Manual review of the three automatic "failures" (all expected "partial")
1. **`aadhaar-dl-as-poa-en`:** the conclusion is correct ("a driving licence is not accepted as PoA
   for Aadhaar"). But it cites PDF text chunks for "marked as not allowed", and that mark is an
   image the text cannot show. The fact is right; the citation for that specific claim is weak.
2. **`passport-bank-statement-en`:** it said the source "explicitly specifies that a bank statement
   is not accepted". **This was a knowledge-base defect, not a model invention:** a curated option
   note said "(not a bank statement)", which is stronger than the official booklet (it lists only
   a photo passbook). The note was corrected to "the official list does not mention bank
   statements" and re-seeded. The cached answer predates the fix.
3. **`bill-age-conflict-en`:** correct and well-grounded (UIDAI ≤ 3 months vs Form 8 "at least 1
   year"; passport sets no age limit). The "partial" label was too strict.

Other manual observations:
- the voter answers omitted the Electoral Registration Officer (lower term coverage, not wrong);
- one DL answer added "in your state" to "if applicable";
- no answer turned an alternative document into a mandatory one or invented a service dependency.

### Fixes driven by this evaluation
- **Requirement notes in the facts:** notes such as "RC: documents not listed by Parivahan" are now
  part of the facts given to the model, with explicit rules for mandatory, optional, conditional
  and "any one of" documents. This addresses the earlier answer that implied Aadhaar or passport
  was required for RC/DL.
- **No false "not covered":** every prompt lists all covered services, and relocation questions get
  facts for every service, so missing retrieval is not reported as missing coverage.
- **Citation markers:** combined, ranged, lowercase and unclosed markers are normalised server-side
  (unknown ids removed), and the frontend renders combined markers safely.
- **Keyword matching:** now whole-word in Latin and Devanagari script. "car" matched "card" and
  "कार" matched "सरकार", which would have sent the out-of-scope PAN question to Gemini.

## 6. End-to-end (running app, real Supabase + real embeddings)
- **Pages:** the dashboard shows API, database and pgvector all "Connected", and the services
  catalogue shows 5 cards.
- **Service detail:** shows the requirement groups, and the official quote expands.
- **Documents:** the catalogue shows 6 category sections.
- **Planner:** selecting Aadhaar + DL with an Aadhaar number, existing DL and electricity bill gives
  Aadhaar ready, DL waiting, and next "Start: Aadhaar address update". "Mark as done" → DL ready and
  a Completed section.
- **Hindi:** the UI renders in Hindi, and the 390 px layout has no horizontal overflow.
- **Assistant:** the out-of-scope question returns "Not enough evidence" through the live vector
  index (1 query embedding, 0 generation calls). Errors (quota, rate limit, index not built,
  network, validation) are covered by frontend tests. Final run with `gemini-3.6-flash`: an
  English DL question and a Hindi passport question were both answered and grounded. All
  citation links resolve, no raw combined markers remain, and the excerpts expand. There were 0
  browser console errors, 0 failed HTTP responses and 0 server tracebacks.

## 7. Limitations
- **Coverage:** 5 services, a subset of the accepted documents, no fees, no processing times, no
  inter-state vehicle re-registration rules, and no state-specific variations. RC "proof of new
  address" is unspecified by Parivahan.
- **Source format:** some decisive facts sit in images (UIDAI allowed/not-allowed marks) and were
  verified visually, not by text extraction.
- **Dataset:** labels were written by the developer from the same curated knowledge base the system
  uses. This measures retrieval, grounding and logic, not completeness of the knowledge base
  itself. The dataset is small (26), so differences of one or two cases are not significant.
- **Automatic scoring:** proxies such as term coverage and unsupported numbers cannot catch every
  wrong claim; manual review is required for conclusions.
- **Incomplete:** the baselines and 7 proposed-system cases are not run (free-tier quota). Hindi
  answer results are from 4 cases only, so no language-parity claim is made for answers.
- **Over-broad relocation detection:** generic phrases such as "new address" also flag
  service-specific questions, so those prompts carry facts for all five services (larger
  prompts; answers stayed on-topic in review).

## 8. Future improvements
- **Better ranking for situational questions:** query rewriting or splitting per service, or
  hybrid lexical + vector retrieval, so long questions find the specific address-proof rows.
- **Structured extraction of table marks** in PDFs.
- **Larger dataset** with labels from a second annotator.
- **Persistent usage counters,** and a scheduled re-ingestion with a review queue for
  `needs_review` evidence.
