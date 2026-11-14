"""Read-only context for the assistant: verified structured facts and the deterministic plan.

Nothing here writes to the knowledge base or changes planner output; the planner's result is
summarised as text for Gemini to explain.
"""

import re
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from app.knowledge import repository
from app.models import Evidence
from app.models.enums import VerificationStatus
from app.workflow.domain import PlanResult

# Words that signal a question is about a service (relevance hint only, not a fact).
SERVICE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "aadhaar-address-update": ("aadhaar", "aadhar", "uidai", "आधार"),
    "voter-id-address-change-form-8": (
        "voter",
        "epic",
        "form 8",
        "form-8",
        "electoral",
        "मतदाता",
        "वोटर",
    ),
    "driving-licence-address-change": (
        "driving",
        "licence",
        "license",
        "sarathi",
        "ड्राइविंग",
        "लाइसेंस",
    ),
    "vehicle-rc-address-change": (
        "vehicle",
        "registration certificate",
        " rc",
        "vahan",
        "form 33",
        " car",
        "bike",
        "scooter",
        "motorcycle",
        "two-wheeler",
        "वाहन",
        "आरसी",
        "कार",
        "गाड़ी",
        "बाइक",
    ),
    "passport-reissue-change-of-address": ("passport", "पासपोर्ट"),
}


# Signals a general "I moved, what do I update?" question: every covered service may apply.
RELOCATION_KEYWORDS = (
    "moved", "moving", "move to", "relocat", "shifted", "shifting", "new city", "new state",
    "another state", "new address", "change of address", "address change", "change my address",
    "स्थानांतर", "शिफ्ट", "नए पते", "नया पता", "पता बदल", "घर बदल", "दूसरे राज्य",
)  # fmt: skip


def mentions(text: str, term: str) -> bool:
    """Whole-word match: 'car' must not match 'card', and 'कार' (car) must not match inside
    'सरकार' (government) or 'कार्ड' (card)."""
    term = term.strip().casefold()
    if not term:
        return False
    if term.isascii():
        return (
            re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", text.casefold()) is not None
        )
    return re.search(rf"(?<![\u0900-\u097F]){re.escape(term)}(?![\u0900-\u097F])", text) is not None


def is_relocation_question(question: str) -> bool:
    """Prefix match at a word start ('relocat' matches 'relocating'; never inside a word)."""
    q = question.casefold()
    return any(
        re.search(rf"(?<![a-z0-9\u0900-\u097F]){re.escape(k)}", q) for k in RELOCATION_KEYWORDS
    )


@dataclass(frozen=True)
class EvidenceRef:
    key: str
    excerpt: str
    source_url: str
    source_title: str | None
    source_authority: str | None
    locator: str | None


@dataclass(frozen=True)
class FactLine:
    text: str
    evidence: EvidenceRef | None


@dataclass(frozen=True)
class ServiceFacts:
    slug: str
    name: str
    name_hi: str | None
    evidence_keys: frozenset[str]
    lines: tuple[FactLine, ...]
    lines_hi: tuple[FactLine, ...] = field(default=())


def _ref(e: Evidence | None) -> EvidenceRef | None:
    if e is None or e.verification_status is not VerificationStatus.VERIFIED:
        return None
    return EvidenceRef(
        e.key, e.excerpt, e.source.url, e.source.title, e.source.authority, e.locator
    )


def _doc(o, hindi: bool) -> str:
    name = o.document_type.name
    if hindi and o.document_type.name_hi:
        name = f"{o.document_type.name_hi} ({name})"
    return name + (f" [{o.notes}]" if o.notes else "")


async def load_service_facts(session: AsyncSession) -> list[ServiceFacts]:
    """Compact, verified-only facts per active service (cacheable plain data)."""
    out = []
    for s in await repository.list_services(session):
        keys = {e.key for e in s.evidence}
        built: dict[bool, list[FactLine]] = {False: [], True: []}
        for hindi in (False, True):
            name = f"{s.name_hi} ({s.name})" if hindi and s.name_hi else s.name
            head = f"{name}: authority {s.authority}"
            if s.application_form:
                head += f"; form {s.application_form}"
            head += f"; official info {s.official_info_url}"
            if s.application_url:
                head += f"; apply at {s.application_url}"
            built[hindi].append(FactLine(head, _ref(s.evidence[0]) if s.evidence else None))
            for r in s.requirements:
                if r.verification_status is not VerificationStatus.VERIFIED:
                    continue
                evs = [*r.evidence, *(o.evidence for o in r.options if o.evidence)]
                keys.update(e.key for e in evs)
                kind = r.requirement_type.value.upper()
                if r.condition:
                    kind += f" (only if: {r.condition})"
                rname = f"{r.name_hi} ({r.name})" if hindi and r.name_hi else r.name
                docs = [_doc(o, hindi) for o in r.options]
                options = docs[0] if len(docs) == 1 else "any one of: " + "; ".join(docs)
                note = f" (note: {r.notes})" if r.notes else ""
                line = f"{name} — {kind}: {rname} — {options}{note}"
                built[hindi].append(FactLine(line, _ref(evs[0] if evs else None)))
            outputs = ", ".join(o.document_type.name for o in s.outputs)
            if outputs:
                built[hindi].append(
                    FactLine(f"{name} — on completion you receive: {outputs}", None)
                )
            if not s.prerequisites:
                built[hindi].append(
                    FactLine(f"{name} — official sources state no prerequisite service.", None)
                )
        out.append(
            ServiceFacts(
                s.slug, s.name, s.name_hi, frozenset(keys), tuple(built[False]), tuple(built[True])
            )
        )
    return out


def relevant_services(
    question: str,
    facts: list[ServiceFacts],
    *,
    evidence_ids: set[str],
    workflow_service_ids: list[str],
    limit: int = 3,
) -> list[ServiceFacts]:
    """Services whose verified facts go into the prompt.

    Order: explicitly mentioned, then the user's workflow, then services cited by the retrieved
    excerpts. A general relocation question includes every covered service, so the answer is not
    limited to whatever happened to be retrieved.
    """
    q = f" {question.casefold()} "
    relocation = is_relocation_question(question)
    if relocation:
        limit = len(facts)
    by_slug = {f.slug: f for f in facts}
    ranked: list[str] = []

    def add(slug: str) -> None:
        if slug in by_slug and slug not in ranked:
            ranked.append(slug)

    for f in facts:  # explicitly mentioned
        names = [f.name.casefold(), *(([f.name_hi.casefold()]) if f.name_hi else [])]
        if any(n in q for n in names) or any(
            mentions(q, k) for k in SERVICE_KEYWORDS.get(f.slug, ())
        ):
            add(f.slug)
    for slug in workflow_service_ids:
        add(slug)
    for f in facts:  # cited by the retrieved official excerpts
        if f.evidence_keys & evidence_ids:
            add(f.slug)
    if relocation:
        for f in facts:
            add(f.slug)
    return [by_slug[s] for s in ranked[:limit]]


def summarize_plan(plan: PlanResult, names: dict[str, dict]) -> str:
    """Deterministic plan as text. Gemini may explain this, never alter it."""
    svc = lambda sid: names["services"].get(sid, (sid, None))[0]  # noqa: E731
    doc = lambda did: names["documents"].get(did, (did, None, None))[0]  # noqa: E731
    lines = []
    a = plan.next_action
    target = f" {svc(a.service_id)}" if a.service_id else ""
    lines.append(f"Next action: {a.type.value}{target}. Planner reason: {a.reason.message}")
    for s in plan.steps:
        deps = ", ".join(
            svc(d.service_id) + (f" (to obtain {doc(d.document_id)})" if d.document_id else "")
            for d in s.depends_on
        )
        lines.append(
            f"Step {s.step_number} (group {s.stage}): {svc(s.service_id)} — "
            f"status {s.status.value}, role {s.role.value}; waits for: {deps or 'nothing'}"
        )
        for r in s.requirements:
            if r.kind.value == "mandatory" and r.state.value == "missing":
                options = "; ".join(doc(d) for d in r.document_options)
                lines.append(f"  missing: {r.name} — any one of: {options}")
    if plan.completed_service_ids:
        lines.append("Completed: " + ", ".join(svc(s) for s in plan.completed_service_ids))
    for b in plan.blockers:
        lines.append(f"Blocker: {b.message}")
    return "\n".join(lines)
