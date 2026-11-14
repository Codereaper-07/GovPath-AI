"""Evidence-grounded assistant: retrieve → assemble verified context → Gemini explains.

Quota protection: no Gemini call when there is nothing to ground an answer in; query
embeddings and answers are cached (the answer key is a hash of the exact prompt, so it changes
whenever the evidence, plan or question changes). The deterministic planner's output is only
passed in as text to explain; Gemini's answer never alters it.
"""

import hashlib
import re
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.knowledge.cache import TTLCache
from app.llm.client import GeminiClient, LLMNotConfiguredError
from app.rag.chunking import detect_language
from app.rag.context import EvidenceRef, load_service_facts, relevant_services, summarize_plan
from app.rag.embeddings import format_query
from app.rag.generator import (
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    AnswerDraft,
    PromptSource,
    build_prompt,
    validate_draft,
)
from app.rag.indexer import indexed_chunk_count
from app.rag.retriever import RetrievalResult, RetrievedChunk, retrieve
from app.workflow.domain import PlanResult
from app.workflow.service import plan_workflow

INSUFFICIENT_MESSAGE = {
    "en": "I could not find enough information in GovPath's official sources to answer this "
    "reliably. Please check the official website of the department concerned.",
    "hi": "GovPath के आधिकारिक स्रोतों में इस प्रश्न का भरोसेमंद उत्तर देने के लिए पर्याप्त जानकारी "
    "नहीं मिली। कृपया संबंधित विभाग की आधिकारिक वेबसाइट देखें।",
}


class AssistantNotReadyError(RuntimeError):
    """No embedded chunks exist yet (run `python -m scripts.embed`)."""


@dataclass(frozen=True)
class Citation:
    id: str
    kind: str  # official_excerpt | verified_fact
    excerpt: str  # exact text from the official source
    source_url: str
    source_title: str | None
    source_authority: str | None
    source_verified: bool
    page_start: int | None = None
    page_end: int | None = None
    section: str | None = None
    locator: str | None = None
    similarity: float | None = None
    evidence_ids: tuple[str, ...] = ()


@dataclass
class AssistantAnswer:
    answer: str
    language: str
    evidence_status: str
    citations: list[Citation]
    retrieval_confidence: str
    best_similarity: float | None
    model: str | None
    used_ai: bool
    cached: bool = False
    plan: PlanResult | None = None
    plan_names: dict = field(default_factory=dict)


@dataclass(frozen=True)
class WorkflowInput:
    target_service_ids: list[str]
    owned_document_ids: list[str]
    completed_service_ids: list[str]


def normalize_question(q: str) -> str:
    return re.sub(r"\s+", " ", q).strip()


class Assistant:
    def __init__(self, settings: Settings, llm: GeminiClient):
        self.settings = settings
        self.llm = llm
        self.answers = TTLCache(settings.assistant_cache_seconds)
        self.query_vectors = TTLCache(settings.assistant_cache_seconds)

    async def answer(
        self,
        session: AsyncSession,
        question: str,
        *,
        language: str | None = None,
        workflow: WorkflowInput | None = None,
        knowledge_cache: TTLCache | None = None,
    ) -> AssistantAnswer:
        s = self.settings
        q = normalize_question(question)
        lang = language or detect_language(q)
        if not self.llm.configured:
            raise LLMNotConfiguredError("GEMINI_API_KEY is not configured")
        if await indexed_chunk_count(session, s) == 0:
            raise AssistantNotReadyError("no embedded source chunks")

        # 1. Deterministic plan (read-only), when the user shares their workflow.
        plan, names = None, {}
        if workflow and workflow.target_service_ids:
            plan, names = await plan_workflow(
                session,
                workflow.target_service_ids,
                workflow.owned_document_ids,
                workflow.completed_service_ids,
                cache=knowledge_cache,
            )

        # 2. Retrieval (one cached query embedding).
        model, dim = s.gemini_embedding_model, s.embedding_dim

        async def embed_query() -> list[float]:
            [vec] = await self.llm.embed([format_query(q)], purpose="query_embedding")
            return vec

        vector = await self.query_vectors.get_or_load(f"{model}:{dim}:{q.casefold()}", embed_query)
        result: RetrievalResult = await retrieve(
            session,
            vector,
            model=model,
            dim=dim,
            top_k=s.rag_top_k,
            min_similarity=s.rag_min_similarity,
            high_confidence=s.rag_high_confidence_similarity,
            max_per_source=s.rag_max_chunks_per_source,
            verified_only=s.rag_verified_sources_only,
        )

        # 3. Verified structured facts for the services in question.
        async def facts_loader():
            return await load_service_facts(session)

        all_facts = await (
            knowledge_cache.get_or_load("rag:service_facts", facts_loader)
            if knowledge_cache
            else facts_loader()
        )
        evidence_ids = {e for c in result.chunks for e in c.evidence_ids}
        services = relevant_services(
            q,
            all_facts,
            evidence_ids=evidence_ids,
            workflow_service_ids=[st.service_id for st in plan.steps] if plan else [],
        )

        # 4. Assemble sources within the context budget.
        citations: dict[str, Citation] = {}
        facts: list[PromptSource] = []
        for svc in services:
            for line in svc.lines_hi if lang == "hi" else svc.lines:
                fid = f"K{len(facts) + 1}"
                facts.append(PromptSource(fid, line.text))
                if line.evidence:
                    citations[fid] = _fact_citation(fid, line.evidence)
        excerpts: list[PromptSource] = []
        budget = s.rag_max_context_chars
        for i, c in enumerate(result.chunks, start=1):
            if budget - len(c.content) < 0 and excerpts:
                break
            budget -= len(c.content)
            sid = f"S{i}"
            excerpts.append(
                PromptSource(sid, c.content, c.source_title, c.source_url, c.page_start)
            )
            citations[sid] = _chunk_citation(sid, c)

        if not excerpts and not facts and plan is None:
            return AssistantAnswer(
                answer=INSUFFICIENT_MESSAGE.get(lang, INSUFFICIENT_MESSAGE["en"]),
                language=lang,
                evidence_status="insufficient",
                citations=[],
                retrieval_confidence=result.confidence,
                best_similarity=result.best_similarity,
                model=None,
                used_ai=False,
            )

        # 5. Generate (cached by exact prompt).
        prompt = build_prompt(
            question=q,
            language=lang,
            facts=facts,
            excerpts=excerpts,
            plan_summary=summarize_plan(plan, names) if plan else None,
            catalogue=[
                f"{f.name_hi} ({f.name})" if lang == "hi" and f.name_hi else f.name
                for f in all_facts
            ],
        )
        key = hashlib.sha256(f"{PROMPT_VERSION}\n{s.gemini_model}\n{prompt}".encode()).hexdigest()
        cache_key = f"answer:{key}"
        cached = self.answers.has(cache_key)

        async def generate() -> AnswerDraft:
            return await self.llm.generate_json(
                system=SYSTEM_PROMPT, prompt=prompt, schema=AnswerDraft, purpose="generation"
            )

        draft = await self.answers.get_or_load(cache_key, generate)
        known = {p.id for p in [*facts, *excerpts]}
        text, cited, status = validate_draft(draft, known)
        ordered = [citations[i] for i in cited if i in citations]
        return AssistantAnswer(
            answer=text,
            language=lang,
            evidence_status=status,
            citations=ordered,
            retrieval_confidence=result.confidence,
            best_similarity=result.best_similarity,
            model=s.gemini_model,
            used_ai=True,
            cached=cached,
            plan=plan,
            plan_names=names,
        )


def _chunk_citation(cid: str, c: RetrievedChunk) -> Citation:
    return Citation(
        id=cid,
        kind="official_excerpt",
        excerpt=c.content,
        source_url=c.source_url,
        source_title=c.source_title,
        source_authority=c.source_authority,
        source_verified=c.source_verified,
        page_start=c.page_start,
        page_end=c.page_end,
        section=c.section,
        similarity=c.similarity,
        evidence_ids=c.evidence_ids,
    )


def _fact_citation(cid: str, e: EvidenceRef) -> Citation:
    return Citation(
        id=cid,
        kind="verified_fact",
        excerpt=e.excerpt,
        source_url=e.source_url,
        source_title=e.source_title,
        source_authority=e.source_authority,
        source_verified=True,
        locator=e.locator,
        evidence_ids=(e.key,),
    )
