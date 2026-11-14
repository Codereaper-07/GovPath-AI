"""GovPath evaluation runner (uses the real Gemini API; every response is cached on disk).

Stages (python -m evaluation.run <stage>):
  retrieval  embed all questions (batched) and record ranked retrieval for each case
  answers    run Baselines A/B/C and the proposed system on every case (cached)
  report     compute metrics from cached results (no API calls)

Systems
  A  LLM-only: question only (+ the five service ids so structured fields can be filled)
  B  Ordinary RAG: same retrieved official excerpts, generic RAG instructions
  C  RAG + structured knowledge: excerpts + verified service/document facts, GovPath
     grounding rules, but no deterministic planner
  P  Proposed GovPath: production Assistant (excerpts + facts + deterministic plan); the
     workflow decision is the planner's output, Gemini only explains it
"""

import asyncio
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import dispose_engine, get_sessionmaker
from app.llm.client import (
    GeminiClient,
    LLMQuotaExhaustedError,
    LLMRateLimitedError,
    LLMRequestError,
    LLMUnavailableError,
    UsageGuard,
)
from app.rag.assistant import Assistant, WorkflowInput, normalize_question
from app.rag.context import load_service_facts, relevant_services
from app.rag.embeddings import format_query
from app.rag.generator import SYSTEM_PROMPT, PromptSource, build_prompt, validate_draft
from app.rag.retriever import retrieve

ROOT = Path(__file__).resolve().parents[2]
DATASET = ROOT / "data" / "evaluation" / "scenarios.json"
OUT = ROOT / "data" / "evaluation" / "results"
CACHE = OUT / "gemini_cache.json"
SERVICE_IDS = [
    "aadhaar-address-update",
    "voter-id-address-change-form-8",
    "driving-licence-address-change",
    "vehicle-rc-address-change",
    "passport-reissue-change-of-address",
]
ServiceId = Literal[
    "aadhaar-address-update",
    "voter-id-address-change-form-8",
    "driving-licence-address-change",
    "vehicle-rc-address-change",
    "passport-reissue-change-of-address",
    "none",
]


class EvalDraft(BaseModel):
    """Baseline output: answer + the workflow decision the baseline itself makes."""

    answer: str = Field(max_length=8000)
    cited_source_ids: list[str] = Field(default_factory=list)
    evidence_status: Literal["sufficient", "partial", "insufficient", "conflicting"]
    first_action_type: Literal["start_service", "obtain_document", "none"]
    first_service: ServiceId
    claimed_dependencies: list[list[ServiceId]] = Field(default_factory=list)


FIELDS = (
    "\n\nAlso return first_action_type ('start_service' | 'obtain_document' | 'none') and "
    "first_service (a service id or 'none') for what the citizen should do first when the "
    "question asks what to do or in which order (otherwise 'none'/'none'), and "
    "claimed_dependencies: pairs [before, after] of service ids that you say must be done in "
    "that order (empty if none). Service ids: " + ", ".join(SERVICE_IDS) + "."
)
LLM_ONLY_SYSTEM = (
    "You are a helpful assistant for Indian government services, specialising in changing "
    "one's address (Aadhaar, voter ID / Form 8, driving licence, vehicle RC, passport). Answer "
    "the citizen's question accurately and practically in the requested language. If you are "
    "not sure, say so." + FIELDS
)
ORDINARY_RAG_SYSTEM = (
    "You answer citizens' questions about Indian government services using the provided "
    "source excerpts. Cite excerpts inline as [S1], [S2]. If the excerpts do not contain the "
    "answer, say you don't know. Answer in the requested language." + FIELDS
)
STRUCTURED_SYSTEM = SYSTEM_PROMPT + FIELDS


class CachingClient(GeminiClient):
    """Disk-cached generate_json: identical (model, system, prompt) is never sent twice."""

    def __init__(self, settings: Settings, cache: dict, **kw):
        super().__init__(settings, **kw)
        self.cache = cache
        self.last_entry: dict | None = None

    async def generate_json(self, *, system, prompt, schema, purpose="generation"):
        key = hashlib.sha256(
            f"{self.settings.gemini_model}\n{schema.__name__}\n{system}\n{prompt}".encode()
        ).hexdigest()
        if key not in self.cache:
            t = time.perf_counter()
            out = await super().generate_json(
                system=system, prompt=prompt, schema=schema, purpose=purpose
            )
            self.cache[key] = {
                "output": out.model_dump(),
                "latency_ms": round((time.perf_counter() - t) * 1000),
                "prompt": prompt,
            }
            CACHE.write_text(json.dumps(self.cache, ensure_ascii=False, indent=1))
        self.last_entry = self.cache[key]
        return schema.model_validate(self.cache[key]["output"])


def load(path: Path, default):
    return json.loads(path.read_text()) if path.exists() else default


async def stage_retrieval(
    session: AsyncSession, settings: Settings, cases: list[dict], client: GeminiClient
):
    vectors = load(OUT / "query_vectors.json", {})
    missing = [c for c in cases if c["id"] not in vectors]
    for i in range(0, len(missing), 16):
        batch = missing[i : i + 16]
        vecs = await client.embed(
            [format_query(normalize_question(c["question"])) for c in batch],
            purpose="query_embedding",
        )
        vectors.update({c["id"]: v for c, v in zip(batch, vecs, strict=True)})
        (OUT / "query_vectors.json").write_text(json.dumps(vectors))
    print(f"query vectors: {len(vectors)} ({len(missing)} newly embedded)")
    results = {}
    for c in cases:
        # Wide, unthresholded ranking (per-source cap as in production) for metrics + sweeps.
        r = await retrieve(
            session,
            vectors[c["id"]],
            model=settings.gemini_embedding_model,
            dim=settings.embedding_dim,
            top_k=20,
            min_similarity=-1.0,
            max_per_source=settings.rag_max_chunks_per_source,
            verified_only=settings.rag_verified_sources_only,
        )
        results[c["id"]] = [
            {
                "chunk_id": ch.chunk_id,
                "source_url": ch.source_url,
                "similarity": ch.similarity,
                "evidence_ids": list(ch.evidence_ids),
                "page": ch.page_start,
                "excerpt": ch.content[:160],
            }
            for ch in r.chunks
        ]
    (OUT / "retrieval.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
    print(f"retrieval recorded for {len(results)} cases")


async def run_system(
    system: str,
    case: dict,
    session,
    settings,
    client: CachingClient,
    facts_all,
    assistant: Assistant,
):
    q, lang = normalize_question(case["question"]), case["language"]
    if system == "P":
        wf = case.get("workflow")
        t = time.perf_counter()
        out = await assistant.answer(
            session,
            q,
            language=lang,
            workflow=WorkflowInput(
                wf["target_service_ids"], wf["owned_document_ids"], wf["completed_service_ids"]
            )
            if wf
            else None,
        )
        entry = client.last_entry if out.used_ai else None
        plan = out.plan
        return {
            "answer": out.answer,
            "evidence_status": out.evidence_status,
            "used_ai": out.used_ai,
            "citations": [
                {
                    "id": c.id,
                    "source_url": c.source_url,
                    "evidence_ids": list(c.evidence_ids),
                    "kind": c.kind,
                }
                for c in out.citations
            ],
            "first_action": (
                {"type": plan.next_action.type.value, "service_id": plan.next_action.service_id}
                if plan
                else None
            ),
            "claimed_dependencies": (
                [[d.service_id, s.service_id] for s in plan.steps for d in s.depends_on]
                if plan
                else None
            ),
            "evidence_text": entry["prompt"] if entry else "",
            "latency_ms": entry["latency_ms"] if entry else round((time.perf_counter() - t) * 1000),
        }
    vector = load(OUT / "query_vectors.json", {})[case["id"]]
    excerpts, facts = [], []
    if system in ("B", "C"):
        r = await retrieve(
            session,
            vector,
            model=settings.gemini_embedding_model,
            dim=settings.embedding_dim,
            top_k=settings.rag_top_k,
            min_similarity=settings.rag_min_similarity,
            max_per_source=settings.rag_max_chunks_per_source,
            verified_only=settings.rag_verified_sources_only,
        )
        excerpts = [
            PromptSource(f"S{i}", ch.content, ch.source_title, ch.source_url, ch.page_start)
            for i, ch in enumerate(r.chunks, 1)
        ]
        cite_meta = {
            f"S{i}": {"source_url": ch.source_url, "evidence_ids": list(ch.evidence_ids)}
            for i, ch in enumerate(r.chunks, 1)
        }
        if system == "C":
            ev = {e for ch in r.chunks for e in ch.evidence_ids}
            for svc in relevant_services(q, facts_all, evidence_ids=ev, workflow_service_ids=[]):
                for line in svc.lines_hi if lang == "hi" else svc.lines:
                    fid = f"K{len(facts) + 1}"
                    facts.append(PromptSource(fid, line.text))
                    if line.evidence:
                        cite_meta[fid] = {
                            "source_url": line.evidence.source_url,
                            "evidence_ids": [line.evidence.key],
                        }
    if system == "A":
        prompt = f"LANGUAGE: {'Hindi (हिन्दी)' if lang == 'hi' else 'English'}\n\n<question>\n{q}\n</question>"
        sysprompt, cite_meta = LLM_ONLY_SYSTEM, {}
    else:
        prompt = build_prompt(
            question=q, language=lang, facts=facts, excerpts=excerpts, plan_summary=None
        )
        sysprompt = ORDINARY_RAG_SYSTEM if system == "B" else STRUCTURED_SYSTEM
    draft = await client.generate_json(system=sysprompt, prompt=prompt, schema=EvalDraft)
    entry = client.last_entry
    from app.rag.generator import AnswerDraft

    text, cited, status = validate_draft(
        AnswerDraft(
            answer=draft.answer,
            cited_source_ids=draft.cited_source_ids,
            evidence_status=draft.evidence_status,
        ),
        set(cite_meta),
    )
    invalid = [i for i in draft.cited_source_ids if i not in cite_meta]
    return {
        "answer": text,
        "evidence_status": status,
        "used_ai": True,
        "citations": [{"id": i, **cite_meta[i]} for i in cited],
        "invalid_citation_ids": invalid,
        "first_action": {
            "type": draft.first_action_type,
            "service_id": None if draft.first_service == "none" else draft.first_service,
        },
        "claimed_dependencies": [
            p for p in draft.claimed_dependencies if len(p) == 2 and "none" not in p
        ],
        "evidence_text": prompt,
        "latency_ms": entry["latency_ms"],
    }


async def stage_answers(session, settings, cases, systems: list[str], client: CachingClient):
    answers = load(OUT / "answers.json", {})
    facts_all = await load_service_facts(session)
    assistant = Assistant(settings, client)
    vectors = load(OUT / "query_vectors.json", {})
    for c in cases:  # reuse the batched query embeddings: no extra embedding calls
        key = f"{settings.gemini_embedding_model}:{settings.embedding_dim}:{normalize_question(c['question']).casefold()}"
        assistant.query_vectors._values[key] = (time.monotonic() + 1e9, vectors[c["id"]])
    for system in systems:
        for c in cases:
            if c["id"] in answers.get(system, {}):
                continue
            for attempt in range(3):
                try:
                    res = await run_system(
                        system, c, session, settings, client, facts_all, assistant
                    )
                    break
                except LLMRequestError:
                    # Invalid/unparseable model output is a measured failure, not a crash.
                    res = {
                        "answer": "",
                        "evidence_status": "insufficient",
                        "used_ai": True,
                        "schema_error": True,
                        "citations": [],
                        "first_action": None,
                        "claimed_dependencies": None,
                        "evidence_text": "",
                        "latency_ms": None,
                    }
                    break
                except (LLMRateLimitedError, LLMUnavailableError) as exc:
                    wait = 65 * (attempt + 1)
                    print(
                        f"  {system}/{c['id']}: {type(exc).__name__}; waiting {wait}s", flush=True
                    )
                    await asyncio.sleep(wait)
            else:
                print(f"  {system}/{c['id']}: giving up for now (re-run later)", flush=True)
                continue
            answers.setdefault(system, {})[c["id"]] = res
            (OUT / "answers.json").write_text(json.dumps(answers, ensure_ascii=False, indent=1))
            print(
                f"  {system}/{c['id']}: {'SCHEMA ERROR' if res.get('schema_error') else res['evidence_status']} ({res['latency_ms']} ms)",
                flush=True,
            )


async def main() -> int:
    stage = sys.argv[1] if len(sys.argv) > 1 else "report"
    systems = sys.argv[2].split(",") if len(sys.argv) > 2 else ["P", "C", "B", "A"]
    OUT.mkdir(parents=True, exist_ok=True)
    cases = json.loads(DATASET.read_text())["cases"]
    if stage == "report":
        from evaluation.report import build_report

        build_report(cases)
        return 0
    settings = get_settings()
    guard = UsageGuard(
        min_interval=max(settings.gemini_min_interval_seconds, 7.0),  # <=~8 RPM
        daily_limits={"generation": 150, "query_embedding": 10},
    )
    client = CachingClient(settings, load(CACHE, {}), guard=guard)
    try:
        async with get_sessionmaker()() as session:
            if stage == "retrieval":
                await stage_retrieval(session, settings, cases, client)
            elif stage == "answers":
                await stage_answers(session, settings, cases, systems, client)
    except LLMQuotaExhaustedError:
        print("STOPPED: Gemini quota exhausted. Cached results are kept; re-run later.")
        return 2
    finally:
        await dispose_engine()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
