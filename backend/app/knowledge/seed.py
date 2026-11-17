"""Idempotent loader for the curated, verified knowledge base in data/knowledge/.

Validation happens before anything is written. Re-running with unchanged files creates
nothing new. Verification rules:
- A source is marked verified as of `verified_on`, unless ingestion has since detected a
  content change (last_changed_at after verified_on): then it stays `needs_review`. The first
  fetch of a curated source is not a change (only a `changed` outcome sets
  `previous_content_hash`); its excerpts are still checked against the fetched text.
- Evidence is verified only if its source is verified and, when the source text has been
  ingested, the excerpt is actually found in it.
- A requirement is verified only if it has at least one evidence item and all of its
  evidence (requirement-level and option-level) is verified.
"""

import json
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time
from pathlib import Path

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ingestion.verification import excerpt_hash, excerpt_in_text
from app.models import (
    DocumentType,
    Evidence,
    GovernmentService,
    RequirementOption,
    ServiceOutput,
    ServicePrerequisite,
    ServiceRequirement,
    SourceDocument,
)
from app.models.enums import (
    CitizenGoal,
    DocumentCategory,
    Jurisdiction,
    LifeEvent,
    RequirementType,
    SourceType,
    VerificationStatus,
)

DEFAULT_SEED_DIR = Path(__file__).resolve().parents[3] / "data" / "knowledge"
CURATOR = "curated-seed"


class SeedError(ValueError):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("invalid seed data:\n- " + "\n- ".join(problems))


# ------------------------------------------------------------------ file schema


class _Strict(BaseModel):
    model_config = {"extra": "forbid"}


class DocumentIn(_Strict):
    slug: str = Field(pattern=r"^[a-z0-9_]+$")
    name: str
    name_hi: str | None = None
    category: DocumentCategory
    description: str | None = None


class EvidenceIn(_Strict):
    key: str = Field(pattern=r"^[a-z0-9-]+$")
    excerpt: str = Field(min_length=3)
    locator: str | None = None
    note: str | None = None


class SourceIn(_Strict):
    url: str = Field(pattern=r"^https://")
    title: str
    authority: str
    source_type: SourceType
    verified_on: date | None = None
    evidence: list[EvidenceIn] = []


class OptionIn(_Strict):
    document: str
    notes: str | None = None
    evidence: str | None = None


class RequirementIn(_Strict):
    slug: str = Field(pattern=r"^[a-z0-9-]+$")
    name: str
    name_hi: str | None = None
    type: RequirementType
    description: str | None = None
    condition: str | None = None
    notes: str | None = None
    evidence: list[str] = []
    options: list[OptionIn] = Field(min_length=1)


class OutputIn(_Strict):
    document: str
    evidence: str


class PrerequisiteIn(_Strict):
    service: str
    evidence: str  # verified prerequisites must cite evidence
    notes: str | None = None


class ServiceIn(_Strict):
    slug: str = Field(pattern=r"^[a-z0-9-]+$")
    name: str
    name_hi: str | None = None
    description: str
    description_hi: str | None = None
    authority: str
    jurisdiction: Jurisdiction
    state: str | None = None
    category: str
    life_events: list[LifeEvent] = Field(min_length=1)
    goals: list[CitizenGoal] = Field(min_length=1)
    application_form: str | None = None
    official_info_url: str = Field(pattern=r"^https://")
    application_url: str | None = Field(default=None, pattern=r"^https://")
    is_active: bool = True
    last_verified_on: date | None = None
    verification_notes: str | None = None
    evidence: list[str] = []
    requirements: list[RequirementIn] = []
    outputs: list[OutputIn] = []
    prerequisites: list[PrerequisiteIn] = []


@dataclass
class SeedData:
    documents: list[DocumentIn]
    sources: list[SourceIn]
    services: list[ServiceIn]


@dataclass
class SeedReport:
    created: dict[str, int] = field(default_factory=dict)
    totals: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    status_counts: dict[str, dict[str, int]] = field(default_factory=dict)

    def bump(self, entity: str) -> None:
        self.created[entity] = self.created.get(entity, 0) + 1


# ------------------------------------------------------------------ load + validate


def load_seed_data(seed_dir: Path = DEFAULT_SEED_DIR) -> SeedData:
    problems: list[str] = []

    def parse(model, raw, where):
        try:
            return model.model_validate(raw)
        except ValidationError as exc:
            problems.append(f"{where}: {exc.errors()[0]['loc']} {exc.errors()[0]['msg']}")
            return None

    docs_raw = json.loads((seed_dir / "documents.json").read_text(encoding="utf-8"))
    srcs_raw = json.loads((seed_dir / "sources.json").read_text(encoding="utf-8"))
    documents = [
        d for i, r in enumerate(docs_raw) if (d := parse(DocumentIn, r, f"documents[{i}]"))
    ]
    sources = [s for i, r in enumerate(srcs_raw) if (s := parse(SourceIn, r, f"sources[{i}]"))]
    services = []
    for path in sorted((seed_dir / "services").glob("*.json")):
        svc = parse(ServiceIn, json.loads(path.read_text(encoding="utf-8")), path.name)
        if svc:
            services.append(svc)
    if problems:
        raise SeedError(problems)
    data = SeedData(documents, sources, services)
    validate_seed_data(data)
    return data


def _dupes(values: list[str]) -> set[str]:
    seen, dup = set(), set()
    for v in values:
        (dup if v in seen else seen).add(v)
    return dup


def validate_seed_data(data: SeedData) -> None:
    problems: list[str] = []
    doc_slugs = [d.slug for d in data.documents]
    ev_keys = [e.key for s in data.sources for e in s.evidence]
    svc_slugs = [s.slug for s in data.services]
    for label, values in (
        ("document slug", doc_slugs),
        ("evidence key", ev_keys),
        ("service slug", svc_slugs),
        ("source url", [s.url for s in data.sources]),
    ):
        problems += [f"duplicate {label}: {v}" for v in sorted(_dupes(values))]

    docs, evs, svcs = set(doc_slugs), set(ev_keys), set(svc_slugs)
    for s in data.services:
        where = f"service {s.slug}"
        problems += [f"{where}: unknown evidence {k}" for k in s.evidence if k not in evs]
        problems += [
            f"{where}: duplicate requirement slug {v}"
            for v in sorted(_dupes([r.slug for r in s.requirements]))
        ]
        for r in s.requirements:
            rw = f"{where} requirement {r.slug}"
            problems += [f"{rw}: unknown evidence {k}" for k in r.evidence if k not in evs]
            if r.type is RequirementType.CONDITIONAL and not r.condition:
                problems.append(f"{rw}: conditional requirement needs a condition")
            problems += [
                f"{rw}: duplicate option {v}"
                for v in sorted(_dupes([o.document for o in r.options]))
            ]
            for o in r.options:
                if o.document not in docs:
                    problems.append(f"{rw}: unknown document {o.document}")
                if o.evidence and o.evidence not in evs:
                    problems.append(f"{rw}: unknown evidence {o.evidence}")
        for o in s.outputs:
            if o.document not in docs:
                problems.append(f"{where}: unknown output document {o.document}")
            if o.evidence not in evs:
                problems.append(f"{where}: unknown output evidence {o.evidence}")
        for p in s.prerequisites:
            if p.service not in svcs or p.service == s.slug:
                problems.append(f"{where}: invalid prerequisite service {p.service}")
            if p.evidence not in evs:
                problems.append(f"{where}: unknown prerequisite evidence {p.evidence}")
    if problems:
        raise SeedError(problems)


# ------------------------------------------------------------------ apply


def _as_datetime(d: date | None) -> datetime | None:
    return datetime.combine(d, time.min, tzinfo=UTC) if d else None


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


async def _by(session: AsyncSession, model, attr: str, *options) -> dict:
    rows = (await session.execute(select(model).options(*options))).scalars().all()
    return {getattr(r, attr): r for r in rows}


async def apply_seed(session: AsyncSession, data: SeedData) -> SeedReport:
    """Upsert everything in `data`; caller controls the transaction (commit/rollback)."""
    report = SeedReport()

    # Documents
    docs = await _by(session, DocumentType, "slug")
    for d in data.documents:
        row = docs.get(d.slug)
        if row is None:
            row = DocumentType(slug=d.slug)
            session.add(row)
            docs[d.slug] = row
            report.bump("document_types")
        row.name, row.description, row.category = d.name, d.description, d.category
        row.name_hi = d.name_hi

    # Sources + evidence
    sources = await _by(session, SourceDocument, "url")
    evidence = await _by(session, Evidence, "key")
    ev_status: dict[str, VerificationStatus] = {}
    for s in data.sources:
        src = sources.get(s.url)
        if src is None:
            src = SourceDocument(url=s.url, verification_status=VerificationStatus.UNVERIFIED)
            session.add(src)
            sources[s.url] = src
            report.bump("source_documents")
        src.title = s.title  # curated title wins over the extracted <title>
        src.authority, src.source_type = s.authority, s.source_type

        verified_at = _as_datetime(s.verified_on)
        changed_at = _aware(src.last_changed_at)
        if verified_at is None:
            pass
        elif (
            changed_at is not None
            and src.previous_content_hash is not None  # first fetch is not a change
            and changed_at.date() > s.verified_on
        ):
            src.verification_status = VerificationStatus.NEEDS_REVIEW
            report.warnings.append(
                f"source changed on {changed_at.date()} after verification on {s.verified_on}; "
                f"left as needs_review: {s.url}"
            )
        else:
            src.verification_status = VerificationStatus.VERIFIED
            src.verified_at = verified_at

        for e in s.evidence:
            ev = evidence.get(e.key)
            if ev is None:
                ev = Evidence(key=e.key)
                session.add(ev)
                evidence[e.key] = ev
                report.bump("evidence")
            ev.source = src
            ev.excerpt, ev.excerpt_hash = e.excerpt, excerpt_hash(e.excerpt)
            ev.locator, ev.note = e.locator, e.note
            if src.content_text:
                ev.excerpt_found_in_source = excerpt_in_text(e.excerpt, src.content_text)
                ev.excerpt_checked_at = datetime.now(UTC)
            if src.verification_status is VerificationStatus.VERIFIED and (
                ev.excerpt_found_in_source is not False
            ):
                ev.verification_status = VerificationStatus.VERIFIED
                ev.verified_at, ev.verified_by = src.verified_at, CURATOR
            elif src.verification_status is VerificationStatus.VERIFIED:
                ev.verification_status = VerificationStatus.NEEDS_REVIEW
                report.warnings.append(f"evidence excerpt not found in source text: {e.key}")
            else:
                ev.verification_status = (
                    VerificationStatus.NEEDS_REVIEW
                    if src.verification_status is VerificationStatus.NEEDS_REVIEW
                    else VerificationStatus.UNVERIFIED
                )
            ev_status[e.key] = ev.verification_status

    await session.flush()

    # Services
    services = await _by(
        session,
        GovernmentService,
        "slug",
        selectinload(GovernmentService.evidence),
        selectinload(GovernmentService.outputs),
        selectinload(GovernmentService.prerequisites),
        selectinload(GovernmentService.requirements).selectinload(ServiceRequirement.options),
        selectinload(GovernmentService.requirements).selectinload(ServiceRequirement.evidence),
    )
    for s in data.services:
        svc = services.get(s.slug)
        if svc is None:
            svc = GovernmentService(slug=s.slug, requirements=[], outputs=[], prerequisites=[])
            svc.evidence = []
            session.add(svc)
            services[s.slug] = svc
            report.bump("government_services")
        for attr in (
            "name", "name_hi", "description", "description_hi", "authority", "jurisdiction",
            "state", "category",
            "application_form", "official_info_url", "application_url", "is_active",
            "verification_notes",
        ):  # fmt: skip
            setattr(svc, attr, getattr(s, attr))
        svc.last_verified_at = _as_datetime(s.last_verified_on)
        svc.life_events = [e.value for e in s.life_events]
        svc.goals = [g.value for g in s.goals]
        svc.evidence = [evidence[k] for k in s.evidence]
        _sync_requirements(svc, s, docs, evidence, ev_status, report)
        _sync_outputs(svc, s, docs, evidence, report)

    await session.flush()
    for s in data.services:
        _sync_prerequisites(services[s.slug], s, services, evidence, ev_status, report)
    await session.flush()

    for model, name in (
        (DocumentType, "document_types"),
        (SourceDocument, "source_documents"),
        (Evidence, "evidence"),
        (GovernmentService, "government_services"),
        (ServiceRequirement, "service_requirements"),
        (RequirementOption, "requirement_options"),
        (ServiceOutput, "service_outputs"),
        (ServicePrerequisite, "service_prerequisites"),
    ):
        report.totals[name] = (
            await session.execute(select(func.count()).select_from(model))
        ).scalar_one()
    for model, name in (
        (SourceDocument, "source_documents"),
        (Evidence, "evidence"),
        (ServiceRequirement, "service_requirements"),
    ):
        rows = await session.execute(
            select(model.verification_status, func.count()).group_by(model.verification_status)
        )
        report.status_counts[name] = {str(k): v for k, v in rows.all()}
    return report


def _requirement_status(keys: list[str], ev_status: dict[str, VerificationStatus]):
    if not keys:
        return VerificationStatus.UNVERIFIED
    statuses = {ev_status[k] for k in keys}
    if statuses == {VerificationStatus.VERIFIED}:
        return VerificationStatus.VERIFIED
    if VerificationStatus.NEEDS_REVIEW in statuses:
        return VerificationStatus.NEEDS_REVIEW
    return VerificationStatus.UNVERIFIED


def _sync_requirements(svc, s: ServiceIn, docs, evidence, ev_status, report: SeedReport) -> None:
    existing = {r.slug: r for r in svc.requirements}
    keep = []
    for order, r in enumerate(s.requirements):
        row = existing.get(r.slug)
        if row is None:
            row = ServiceRequirement(slug=r.slug, options=[])
            row.evidence = []
            report.bump("service_requirements")
        row.name, row.description, row.requirement_type = r.name, r.description, r.type
        row.name_hi = r.name_hi
        row.condition, row.notes, row.sort_order = r.condition, r.notes, order
        row.evidence = [evidence[k] for k in r.evidence]

        opts = {o.document_type_id: o for o in row.options if o.document_type_id}
        new_opts = []
        for o in r.options:
            doc = docs[o.document]
            opt = opts.get(doc.id) if doc.id else None
            if opt is None:
                opt = RequirementOption(document_type=doc)
                report.bump("requirement_options")
            opt.notes = o.notes
            opt.evidence = evidence[o.evidence] if o.evidence else None
            new_opts.append(opt)
        row.options = new_opts

        all_keys = list(r.evidence) + [o.evidence for o in r.options if o.evidence]
        status = _requirement_status(all_keys, ev_status)
        row.verification_status = status
        row.verified_at = svc.last_verified_at if status is VerificationStatus.VERIFIED else None
        if status is not VerificationStatus.VERIFIED:
            report.warnings.append(f"requirement not verified ({status}): {s.slug}.{r.slug}")
        keep.append(row)
    svc.requirements = keep  # requirements removed from the file are deleted (orphan cascade)


def _sync_outputs(svc, s: ServiceIn, docs, evidence, report: SeedReport) -> None:
    existing = {o.document_type_id: o for o in svc.outputs if o.document_type_id}
    keep = []
    for o in s.outputs:
        doc = docs[o.document]
        row = existing.get(doc.id) if doc.id else None
        if row is None:
            row = ServiceOutput(document_type=doc)
            report.bump("service_outputs")
        row.evidence = evidence[o.evidence]
        keep.append(row)
    svc.outputs = keep


def _sync_prerequisites(svc, s: ServiceIn, services, evidence, ev_status, report) -> None:
    existing = {p.prerequisite_service_id: p for p in svc.prerequisites}
    keep = []
    for p in s.prerequisites:
        pre = services[p.service]
        row = existing.get(pre.id)
        if row is None:
            row = ServicePrerequisite(prerequisite=pre)
            report.bump("service_prerequisites")
        row.evidence, row.notes = evidence[p.evidence], p.notes
        row.verification_status = ev_status[p.evidence]
        keep.append(row)
    svc.prerequisites = keep
