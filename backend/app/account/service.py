"""Signed-in citizen's data: vault documents, reported progress, saved plans and activity.

Every function takes the verified `user_id` and filters by it; another user's row is reported
as "not found". Plans are re-evaluated with the existing deterministic planner (never an LLM):
the vault supplies `owned_document_ids` + `document_states`, `service_progress` supplies the
reported progress. A document change re-evaluates every active plan and logs what changed; it
never touches progress (progress is only changed by an explicit progress update).
"""

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.knowledge.cache import TTLCache
from app.knowledge.regions import normalise_state
from app.models import ActivityEvent, ServiceProgress, UserPlan, VaultDocument
from app.models.enums import (
    ActivityType,
    CitizenGoal,
    PlanStatus,
    ReportedProgress,
    VaultDocumentStatus,
)
from app.schemas.workflow import build_plan_response
from app.workflow.errors import DependencyCycleError, EmptySelectionError, UnknownIdsError
from app.workflow.service import get_planning_data, plan_workflow


class NotFoundError(Exception):
    """The row does not exist or belongs to another user (indistinguishable on purpose)."""


class ConflictError(Exception):
    def __init__(self, code: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.code = code
        self.extra = extra


class InvalidInputError(Exception):
    def __init__(self, code: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.code = code
        self.extra = extra


# ---------------------------------------------------------------- vault -> planner input

# When a citizen holds several documents of one type and none is valid, the most hopeful state
# is reported to the planner (it does not change readiness: only "available" satisfies).
_PROBLEM_ORDER = (
    VaultDocumentStatus.UNSURE,
    VaultDocumentStatus.EXPIRED,
    VaultDocumentStatus.INVALID,
)
_PLANNER_STATE = {
    VaultDocumentStatus.UNSURE: "unsure",
    VaultDocumentStatus.EXPIRED: "expired",
    VaultDocumentStatus.INVALID: "invalid",
}


# Expiry uses the Indian calendar date: a document is valid through its expiry date and
# expired from 00:00 IST on the next day, wherever the server runs.
INDIA = ZoneInfo("Asia/Kolkata")


def today(now: datetime | None = None) -> date:
    return (now or datetime.now(UTC)).astimezone(INDIA).date()


def expiry_passed(doc: VaultDocument, on: date | None = None) -> bool:
    return doc.expiry_date is not None and doc.expiry_date < (on or today())


def effective_status(doc: VaultDocument, on: date | None = None) -> VaultDocumentStatus:
    """The reported status, except that a "valid" document past its expiry date is expired."""
    if doc.status == VaultDocumentStatus.VALID and expiry_passed(doc, on):
        return VaultDocumentStatus.EXPIRED
    return doc.status


def planner_documents(
    docs: Iterable[VaultDocument], known_types: Iterable[str], on: date | None = None
) -> tuple[list[str], dict[str, str]]:
    """Vault -> (owned document types, document_states) for the planner. A type is owned when
    the citizen holds any document of it; it is usable ("available") if any copy is valid."""
    known = set(known_types)
    by_type: dict[str, set[VaultDocumentStatus]] = {}
    for d in docs:
        if d.document_type in known:  # a type the catalogue no longer lists is ignored
            by_type.setdefault(d.document_type, set()).add(effective_status(d, on))
    states: dict[str, str] = {}
    for doc_type, statuses in by_type.items():
        if VaultDocumentStatus.VALID not in statuses:
            worst_case = next(s for s in _PROBLEM_ORDER if s in statuses)
            states[doc_type] = _PLANNER_STATE[worst_case]
    return sorted(by_type), dict(sorted(states.items()))


# ---------------------------------------------------------------- queries


async def list_documents(session: AsyncSession, user_id: uuid.UUID) -> list[VaultDocument]:
    rows = await session.execute(
        select(VaultDocument)
        .where(VaultDocument.user_id == user_id)
        .order_by(VaultDocument.document_type, VaultDocument.created_at)
    )
    return list(rows.scalars())


async def get_document(
    session: AsyncSession, user_id: uuid.UUID, doc_id: uuid.UUID
) -> VaultDocument:
    doc = await session.get(VaultDocument, doc_id)
    if doc is None or doc.user_id != user_id:
        raise NotFoundError
    return doc


async def progress_map(session: AsyncSession, user_id: uuid.UUID) -> dict[str, str]:
    rows = await session.execute(select(ServiceProgress).where(ServiceProgress.user_id == user_id))
    return {p.service_id: p.state.value for p in rows.scalars()}


async def list_plans(
    session: AsyncSession, user_id: uuid.UUID, status: PlanStatus | None = None
) -> list[UserPlan]:
    q = select(UserPlan).where(UserPlan.user_id == user_id)
    if status is not None:
        q = q.where(UserPlan.status == status)
    rows = await session.execute(q.order_by(UserPlan.updated_at.desc(), UserPlan.created_at.desc()))
    return list(rows.scalars())


async def get_plan(session: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID) -> UserPlan:
    p = await session.get(UserPlan, plan_id)
    if p is None or p.user_id != user_id:
        raise NotFoundError
    return p


async def list_activity(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    limit: int,
    before_id: int | None = None,
    entity_id: str | None = None,
) -> list[ActivityEvent]:
    q = select(ActivityEvent).where(ActivityEvent.user_id == user_id)
    if before_id is not None:
        q = q.where(ActivityEvent.id < before_id)
    if entity_id is not None:
        q = q.where(ActivityEvent.entity_id == entity_id)
    rows = await session.execute(q.order_by(ActivityEvent.id.desc()).limit(limit))
    return list(rows.scalars())


def record(
    session: AsyncSession,
    user_id: uuid.UUID,
    event_type: ActivityType,
    entity_type: str,
    entity_id: object | None,
    details: dict[str, Any],
) -> None:
    """Append an activity event (structured facts only: no notes, labels or identity data)."""
    session.add(
        ActivityEvent(
            user_id=user_id,
            event_type=event_type,
            entity_type=entity_type,
            entity_id=None if entity_id is None else str(entity_id),
            details=details,
        )
    )


# ---------------------------------------------------------------- plan evaluation


@dataclass(frozen=True)
class PlanChange:
    plan_id: uuid.UUID
    title: str | None
    steps: list[dict[str, str | None]]
    blockers_added: list[str]
    blockers_removed: list[str]
    next_action_changed: bool

    def details(self) -> dict[str, Any]:
        return {
            "steps": self.steps,
            "blockers_added": self.blockers_added,
            "blockers_removed": self.blockers_removed,
            "next_action_changed": self.next_action_changed,
        }


def _digest(snapshot: dict | None) -> dict[str, Any]:
    """The parts of a plan whose change is worth telling the citizen about."""
    if not snapshot:
        return {"steps": {}, "blockers": set(), "next": None}
    steps = {s["service_id"]: s["status"] for s in snapshot.get("steps", [])}
    for sid in snapshot.get("completed_service_ids", []):
        steps[sid] = "completed"
    blockers = {
        f"{b['code']}:{b['service_id']}:{b.get('requirement_id') or ''}"
        for b in snapshot.get("blockers", [])
    }
    nxt = snapshot.get("next_action") or {}
    return {"steps": steps, "blockers": blockers, "next": (nxt.get("type"), nxt.get("service_id"))}


def diff_plans(plan_row: UserPlan, before: dict | None, after: dict | None) -> PlanChange | None:
    a, b = _digest(before), _digest(after)
    ids = sorted(set(a["steps"]) | set(b["steps"]))
    steps = [
        {"service_id": s, "before": a["steps"].get(s), "after": b["steps"].get(s)}
        for s in ids
        if a["steps"].get(s) != b["steps"].get(s)
    ]
    added = sorted(b["blockers"] - a["blockers"])
    removed = sorted(a["blockers"] - b["blockers"])
    next_changed = a["next"] != b["next"]
    if not (steps or added or removed or next_changed):
        return None
    return PlanChange(plan_row.id, plan_row.title, steps, added, removed, next_changed)


async def evaluate(
    session: AsyncSession,
    plan_row: UserPlan,
    docs: Sequence[VaultDocument],
    progress: dict[str, str],
    cache: TTLCache | None,
    *,
    on: date | None = None,
) -> bool:
    """Re-run the deterministic planner for a saved plan and store the result as its snapshot.

    Returns False (and keeps the previous snapshot) when the plan can no longer be computed,
    e.g. a service was removed from the catalogue; `evaluation_error` says why.
    """
    kb, _ = await get_planning_data(session, cache)
    if any(s not in kb.services for s in plan_row.target_service_ids):
        plan_row.evaluation_error = "catalogue_changed"
        return False
    owned, states = planner_documents(docs, kb.documents, on)
    known_progress = {s: p for s, p in progress.items() if s in kb.services}
    completed = sorted(s for s, p in known_progress.items() if p == "completed")
    try:
        result, names = await plan_workflow(
            session,
            list(plan_row.target_service_ids),
            owned,
            completed,
            progress=known_progress,
            document_states=states,
            state=plan_row.citizen_state,
            cache=cache,
        )
    except UnknownIdsError:
        plan_row.evaluation_error = "catalogue_changed"
        return False
    except EmptySelectionError:
        plan_row.evaluation_error = "empty_selection"
        return False
    except DependencyCycleError:
        plan_row.evaluation_error = "dependency_cycle"
        return False
    plan_row.snapshot = build_plan_response(result, names).model_dump(mode="json")
    plan_row.evaluated_at = datetime.now(UTC)
    plan_row.evaluation_error = None
    return True


async def recalculate_active_plans(
    session: AsyncSession,
    user_id: uuid.UUID,
    cause: dict[str, Any],
    cache: TTLCache | None,
    *,
    skip: uuid.UUID | None = None,
    on: date | None = None,
) -> list[PlanChange]:
    """Re-evaluate every active plan after a vault/progress change; log each plan that changed.
    Archived plans are frozen (re-evaluated when restored)."""
    docs = await list_documents(session, user_id)
    progress = await progress_map(session, user_id)
    changes: list[PlanChange] = []
    for plan_row in await list_plans(session, user_id, PlanStatus.ACTIVE):
        if plan_row.id == skip:
            continue
        before = plan_row.snapshot
        if not await evaluate(session, plan_row, docs, progress, cache, on=on):
            continue
        change = diff_plans(plan_row, before, plan_row.snapshot)
        if change:
            changes.append(change)
            record(
                session,
                user_id,
                ActivityType.PLAN_RECALCULATED,
                "plan",
                plan_row.id,
                {"cause": cause, **change.details()},
            )
    return changes


# ---------------------------------------------------------------- references


def _requirement_options(snapshot: dict | None) -> dict[str, set[str]]:
    """document type -> requirement ids in the plan that the type can satisfy."""
    out: dict[str, set[str]] = {}
    if not snapshot:
        return out
    for step in snapshot.get("steps", []):
        for req in step.get("requirements", []):
            for d in req.get("document_options", []):
                out.setdefault(d, set()).add(req["requirement_id"])
    return out


def document_refs(plan_row: UserPlan, docs: Sequence[VaultDocument]) -> list[dict[str, Any]]:
    options = _requirement_options(plan_row.snapshot)
    by_type: dict[str, list[uuid.UUID]] = {}
    for d in docs:
        if d.document_type in options:
            by_type.setdefault(d.document_type, []).append(d.id)
    return [
        {"document_type": t, "vault_document_ids": ids, "requirement_ids": sorted(options[t])}
        for t, ids in sorted(by_type.items())
    ]


def plans_using(plans: Sequence[UserPlan]) -> dict[str, list[uuid.UUID]]:
    """document type -> active plans whose requirements can use it."""
    out: dict[str, list[uuid.UUID]] = {}
    for p in plans:
        if p.status != PlanStatus.ACTIVE:
            continue
        for doc_type in _requirement_options(p.snapshot):
            out.setdefault(doc_type, []).append(p.id)
    return out


# ---------------------------------------------------------------- automatic expiry


def _mark_expiry_seen(doc: VaultDocument) -> None:
    """A write by the citizen that already leaves a "valid" document past its expiry date is
    logged as that write; the expiry job must not log it again."""
    if doc.status == VaultDocumentStatus.VALID and expiry_passed(doc):
        doc.expiry_processed_for = doc.expiry_date


@dataclass(frozen=True)
class ExpiryRun:
    users: int
    documents: int
    plans_changed: int


def _due(on: date):
    return (
        select(VaultDocument)
        .where(VaultDocument.status == VaultDocumentStatus.VALID)
        .where(VaultDocument.expiry_date.is_not(None), VaultDocument.expiry_date < on)
        .where(
            or_(
                VaultDocument.expiry_processed_for.is_(None),
                VaultDocument.expiry_processed_for != VaultDocument.expiry_date,
            )
        )
    )


async def expire_for_user(
    session: AsyncSession, user_id: uuid.UUID, cache: TTLCache | None, on: date | None = None
) -> tuple[int, list[PlanChange]]:
    """Process this user's documents whose expiry date has passed (idempotent).

    Each document is claimed with a conditional UPDATE, so concurrent runs (scheduler + a page
    load) cannot log it twice. Logs `document_expired` per document, then re-evaluates every
    active plan once and logs the resulting changes. Reported status and progress are untouched.
    """
    on = on or today()
    docs = (await session.execute(_due(on).where(VaultDocument.user_id == user_id))).scalars().all()
    claimed: list[VaultDocument] = []
    for d in docs:
        result = await session.execute(
            update(VaultDocument)
            .where(VaultDocument.id == d.id, VaultDocument.status == VaultDocumentStatus.VALID)
            .where(
                or_(
                    VaultDocument.expiry_processed_for.is_(None),
                    VaultDocument.expiry_processed_for != VaultDocument.expiry_date,
                )
            )
            .values(expiry_processed_for=VaultDocument.expiry_date)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount == 1:
            claimed.append(d)
            record(
                session,
                user_id,
                ActivityType.DOCUMENT_EXPIRED,
                "document",
                d.id,
                {
                    "document_type": d.document_type,
                    "expiry_date": d.expiry_date.isoformat() if d.expiry_date else None,
                    "reported_status": d.status.value,
                    "effective_status": "expired",
                },
            )
    if not claimed:
        return 0, []
    cause = {
        "type": "document_expired",
        "document_ids": [str(d.id) for d in claimed],
        "document_type": claimed[0].document_type if len(claimed) == 1 else None,
        "document_types": sorted({d.document_type for d in claimed}),
    }
    changes = await recalculate_active_plans(session, user_id, cause, cache, on=on)
    return len(claimed), changes


async def expire_all(
    session: AsyncSession, cache: TTLCache | None, on: date | None = None
) -> ExpiryRun:
    """Scheduled job: process every user with due documents; commits per user."""
    on = on or today()
    users = (
        (
            await session.execute(
                select(VaultDocument.user_id)
                .where(VaultDocument.id.in_(_due(on).with_only_columns(VaultDocument.id)))
                .distinct()
            )
        )
        .scalars()
        .all()
    )
    total_docs = total_plans = 0
    for uid in users:
        n, changes = await expire_for_user(session, uid, cache, on)
        await session.commit()
        total_docs += n
        total_plans += len(changes)
    return ExpiryRun(users=len(users), documents=total_docs, plans_changed=total_plans)


async def catch_up(session: AsyncSession, user_id: uuid.UUID, cache: TTLCache | None) -> None:
    """Run the user's due expiries before serving account data (works without any scheduler)."""
    n, _ = await expire_for_user(session, user_id, cache)
    if n:
        await session.commit()


# ---------------------------------------------------------------- writes


async def _known_documents(session: AsyncSession, cache: TTLCache | None) -> set[str]:
    kb, _ = await get_planning_data(session, cache)
    return set(kb.documents)


def _norm_label(label: str | None) -> str:
    return (label or "").casefold()


async def create_document(
    session: AsyncSession,
    user_id: uuid.UUID,
    fields: dict[str, Any],
    cache: TTLCache | None,
    *,
    source: str = "vault",
) -> tuple[VaultDocument, list[PlanChange]]:
    doc_type = fields["document_type"]
    if doc_type not in await _known_documents(session, cache):
        raise UnknownIdsError([], [doc_type])
    existing = await list_documents(session, user_id)
    if any(
        d.document_type == doc_type and _norm_label(d.label) == _norm_label(fields.get("label"))
        for d in existing
    ):
        raise ConflictError(
            "duplicate_document",
            "You already saved this document. Give a second copy a label to tell them apart.",
        )
    doc = VaultDocument(user_id=user_id, **fields)
    _mark_expiry_seen(doc)
    session.add(doc)
    await session.flush()
    record(
        session,
        user_id,
        ActivityType.DOCUMENT_ADDED,
        "document",
        doc.id,
        {
            "document_type": doc_type,
            "status": doc.status.value,
            "expiry_date": doc.expiry_date.isoformat() if doc.expiry_date else None,
            "source": source,
        },
    )
    changes = await recalculate_active_plans(
        session,
        user_id,
        {"type": "document_added", "document_id": str(doc.id), "document_type": doc_type},
        cache,
    )
    return doc, changes


_PLANNING_FIELDS = ("status", "expiry_date")


async def update_document(
    session: AsyncSession,
    user_id: uuid.UUID,
    doc_id: uuid.UUID,
    changes_in: dict[str, Any],
    cache: TTLCache | None,
) -> tuple[VaultDocument, list[PlanChange]]:
    doc = await get_document(session, user_id, doc_id)
    if "status" in changes_in and changes_in["status"] is None:
        raise InvalidInputError("invalid_status", "Choose a status.")
    issue = changes_in.get("issue_date", doc.issue_date)
    expiry = changes_in.get("expiry_date", doc.expiry_date)
    if issue and expiry and expiry < issue:
        raise InvalidInputError("invalid_dates", "The expiry date cannot be before the issue date.")
    if issue and issue > today():
        raise InvalidInputError("invalid_dates", "The issue date cannot be in the future.")
    if "label" in changes_in:
        siblings = await list_documents(session, user_id)
        if any(
            d.id != doc.id
            and d.document_type == doc.document_type
            and _norm_label(d.label) == _norm_label(changes_in["label"])
            for d in siblings
        ):
            raise ConflictError("duplicate_document", "Another saved copy already has this label.")
    before = {"status": doc.status.value, "effective": effective_status(doc).value}
    changed: dict[str, Any] = {}
    for field, value in changes_in.items():
        old = getattr(doc, field)
        if old == value:
            continue
        setattr(doc, field, value)
        if field == "status":
            changed["status"] = [old.value, value.value]
        elif field in ("issue_date", "expiry_date"):
            changed[field] = [
                old.isoformat() if old else None,
                value.isoformat() if value else None,
            ]
        else:  # label / note: record THAT it changed, never the text
            changed[field] = "changed"
    if not changed:
        return doc, []
    _mark_expiry_seen(doc)
    await session.flush()
    record(
        session,
        user_id,
        ActivityType.DOCUMENT_UPDATED,
        "document",
        doc.id,
        {"document_type": doc.document_type, "changes": changed},
    )
    plan_changes: list[PlanChange] = []
    if any(f in changed for f in _PLANNING_FIELDS):
        cause = {
            "type": "document_updated",
            "document_id": str(doc.id),
            "document_type": doc.document_type,
            "status": [before["effective"], effective_status(doc).value],
        }
        plan_changes = await recalculate_active_plans(session, user_id, cause, cache)
    return doc, plan_changes


async def delete_document(
    session: AsyncSession, user_id: uuid.UUID, doc_id: uuid.UUID, cache: TTLCache | None
) -> list[PlanChange]:
    doc = await get_document(session, user_id, doc_id)
    details = {"document_type": doc.document_type, "status": doc.status.value}
    await session.delete(doc)
    await session.flush()
    record(session, user_id, ActivityType.DOCUMENT_REMOVED, "document", doc_id, details)
    cause = {
        "type": "document_removed",
        "document_id": str(doc_id),
        "document_type": details["document_type"],
    }
    return await recalculate_active_plans(session, user_id, cause, cache)


async def set_progress(
    session: AsyncSession,
    user_id: uuid.UUID,
    service_id: str,
    state: str,
    cache: TTLCache | None,
    *,
    source: str = "user",
) -> tuple[bool, list[PlanChange]]:
    """Explicit progress report (the only way progress changes). Returns (changed, plan changes)."""
    if state != "not_started":
        kb, _ = await get_planning_data(session, cache)
        if service_id not in kb.services:
            raise UnknownIdsError([service_id], [])
    row = await session.get(ServiceProgress, (user_id, service_id))
    before = row.state.value if row else "not_started"
    if before == state:
        return False, []
    if state == "not_started":
        await session.delete(row)
    elif row is None:
        session.add(
            ServiceProgress(user_id=user_id, service_id=service_id, state=ReportedProgress(state))
        )
    else:
        row.state = ReportedProgress(state)
    await session.flush()
    record(
        session,
        user_id,
        ActivityType.PROGRESS_CHANGED,
        "service",
        service_id,
        {"service_id": service_id, "from": before, "to": state, "source": source},
    )
    cause = {"type": "progress_changed", "service_id": service_id, "progress": [before, state]}
    return True, await recalculate_active_plans(session, user_id, cause, cache)


async def _validate_plan_inputs(
    session: AsyncSession,
    cache: TTLCache | None,
    targets: Iterable[str] = (),
    goals: Iterable[str] = (),
    state: str | None = None,
    held: Iterable[str] = (),
    progress: Iterable[str] = (),
) -> str | None:
    kb, _ = await get_planning_data(session, cache)
    unknown_services = [s for s in [*targets, *progress] if s not in kb.services]
    unknown_docs = [d for d in held if d not in kb.documents]
    allowed_goals = {g.value for g in CitizenGoal}
    unknown_services += [g for g in goals if g not in allowed_goals]
    if unknown_services or unknown_docs:
        raise UnknownIdsError(unknown_services, unknown_docs)
    if state is None:
        return None
    canonical = normalise_state(state)
    if canonical is None:
        raise InvalidInputError("unknown_state", "Unknown state or union territory.")
    return canonical


async def _add_held_documents(
    session: AsyncSession,
    user_id: uuid.UUID,
    held: Iterable[tuple[str, VaultDocumentStatus]],
    source: str,
) -> list[uuid.UUID]:
    """Add reviewed documents the vault does not have yet (existing vault entries win)."""
    have = {d.document_type for d in await list_documents(session, user_id)}
    created: list[uuid.UUID] = []
    for doc_type, status in held:
        if doc_type in have:
            continue
        have.add(doc_type)
        doc = VaultDocument(user_id=user_id, document_type=doc_type, status=status)
        session.add(doc)
        await session.flush()
        created.append(doc.id)
        record(
            session,
            user_id,
            ActivityType.DOCUMENT_ADDED,
            "document",
            doc.id,
            {
                "document_type": doc_type,
                "status": status.value,
                "expiry_date": None,
                "source": source,
            },
        )
    return created


def _unique(xs: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(xs))


async def find_by_request(
    session: AsyncSession, user_id: uuid.UUID, client_request_id: str
) -> UserPlan | None:
    """The plan an earlier submission with this request id created (double-click / retry
    protection). Two different submissions are always two plans, even with the same services."""
    events = await session.execute(
        select(ActivityEvent)
        .where(ActivityEvent.user_id == user_id)
        .where(ActivityEvent.event_type == ActivityType.PLAN_CREATED)
        .order_by(ActivityEvent.id.desc())
        .limit(200)
    )
    for e in events.scalars():
        if (e.details or {}).get("client_request_id") == client_request_id and e.entity_id:
            p = await session.get(UserPlan, uuid.UUID(e.entity_id))
            if p is not None and p.user_id == user_id:
                return p
    return None


async def create_plan(
    session: AsyncSession, user_id: uuid.UUID, body: Any, cache: TTLCache | None
) -> tuple[UserPlan, list[uuid.UUID], list[PlanChange], str | None]:
    """Save an accepted plan as a NEW, independent plan (never merged into, replacing or
    archiving another). A repeated submission with the same `client_request_id` returns the
    plan it already created. Returns (plan, documents added, other plans changed, repeat flag)."""
    if body.client_request_id:
        earlier = await find_by_request(session, user_id, body.client_request_id)
        if earlier is not None:
            return earlier, [], [], "repeat_request"
    targets = _unique(body.target_service_ids)
    goals = _unique(body.goals or [])
    held = [(h.document_type, h.status) for h in body.held_documents]
    state = await _validate_plan_inputs(
        session, cache, targets, goals, body.state, [h[0] for h in held], body.progress
    )
    created_docs = await _add_held_documents(session, user_id, held, body.source)
    imported: list[str] = []
    if body.progress:
        existing = await progress_map(session, user_id)
        for sid, p in body.progress.items():
            if sid in existing:
                continue  # account progress is never overwritten by an import
            session.add(ServiceProgress(user_id=user_id, service_id=sid, state=ReportedProgress(p)))
            imported.append(sid)
            record(
                session,
                user_id,
                ActivityType.PROGRESS_CHANGED,
                "service",
                sid,
                {"service_id": sid, "from": "not_started", "to": p, "source": body.source},
            )
        await session.flush()
    plan_row = UserPlan(
        user_id=user_id,
        title=body.title,
        status=PlanStatus.ACTIVE,
        target_service_ids=targets,
        goals=goals,
        citizen_state=state,
    )
    session.add(plan_row)
    await session.flush()
    docs = await list_documents(session, user_id)
    if not await evaluate(session, plan_row, docs, await progress_map(session, user_id), cache):
        raise InvalidInputError(
            plan_row.evaluation_error or "plan_error", "The plan could not be built."
        )
    record(
        session,
        user_id,
        ActivityType.PLAN_CREATED,
        "plan",
        plan_row.id,
        {
            "source": body.source,
            "target_service_ids": targets,
            "documents_added": len(created_docs),
            "progress_imported": imported,
            **({"client_request_id": body.client_request_id} if body.client_request_id else {}),
        },
    )
    other_changes: list[PlanChange] = []
    if created_docs or imported:
        cause = {"type": "plan_created", "plan_id": str(plan_row.id)}
        other_changes = await recalculate_active_plans(
            session, user_id, cause, cache, skip=plan_row.id
        )
    return plan_row, created_docs, other_changes, None


async def update_plan(
    session: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    body: Any,
    cache: TTLCache | None,
) -> tuple[UserPlan, list[uuid.UUID], list[PlanChange]]:
    plan_row = await get_plan(session, user_id, plan_id)
    fields = body.model_fields_set
    held = [(h.document_type, h.status) for h in body.held_documents]
    targets = _unique(body.target_service_ids) if body.target_service_ids is not None else None
    goals = _unique(body.goals) if body.goals is not None else None
    state = await _validate_plan_inputs(
        session,
        cache,
        targets or [],
        goals or [],
        body.state if "state" in fields else None,
        [h[0] for h in held],
    )
    details: dict[str, Any] = {}
    if targets is not None and targets != plan_row.target_service_ids:
        details["services_added"] = [s for s in targets if s not in plan_row.target_service_ids]
        details["services_removed"] = [s for s in plan_row.target_service_ids if s not in targets]
        plan_row.target_service_ids = targets
    if goals is not None and goals != plan_row.goals:
        details["goals"] = goals
        plan_row.goals = goals
    if "state" in fields and state != plan_row.citizen_state:
        details["state"] = [plan_row.citizen_state, state]
        plan_row.citizen_state = state
    if "title" in fields and body.title != plan_row.title:
        details["title"] = "changed"
        plan_row.title = body.title
    created_docs = await _add_held_documents(session, user_id, held, "proposal")
    if created_docs:
        details["documents_added"] = len(created_docs)
    if not details:
        return plan_row, [], []
    before = plan_row.snapshot
    docs = await list_documents(session, user_id)
    if plan_row.status == PlanStatus.ACTIVE and not await evaluate(
        session, plan_row, docs, await progress_map(session, user_id), cache
    ):
        raise InvalidInputError(
            plan_row.evaluation_error or "plan_error", "The plan could not be built."
        )
    change = diff_plans(plan_row, before, plan_row.snapshot)
    if change:
        details.update(change.details())
    plan_row.updated_at = datetime.now(UTC)
    record(session, user_id, ActivityType.PLAN_UPDATED, "plan", plan_row.id, details)
    other: list[PlanChange] = []
    if created_docs:
        cause = {"type": "plan_updated", "plan_id": str(plan_row.id)}
        other = await recalculate_active_plans(session, user_id, cause, cache, skip=plan_row.id)
    return plan_row, created_docs, other


async def set_plan_status(
    session: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    status: PlanStatus,
    cache: TTLCache | None,
) -> UserPlan:
    plan_row = await get_plan(session, user_id, plan_id)
    if plan_row.status == status:
        return plan_row
    plan_row.status = status
    plan_row.archived_at = datetime.now(UTC) if status == PlanStatus.ARCHIVED else None
    plan_row.updated_at = datetime.now(UTC)
    if status == PlanStatus.ACTIVE:  # catch up with vault/progress changes made meanwhile
        docs = await list_documents(session, user_id)
        await evaluate(session, plan_row, docs, await progress_map(session, user_id), cache)
    event = (
        ActivityType.PLAN_ARCHIVED if status == PlanStatus.ARCHIVED else ActivityType.PLAN_RESTORED
    )
    record(session, user_id, event, "plan", plan_row.id, {"title": plan_row.title})
    return plan_row


async def delete_plan(session: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID) -> None:
    plan_row = await get_plan(session, user_id, plan_id)
    details = {"title": plan_row.title, "target_service_ids": plan_row.target_service_ids}
    await session.delete(plan_row)
    record(session, user_id, ActivityType.PLAN_DELETED, "plan", plan_id, details)


async def recalculate_plan(
    session: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID, cache: TTLCache | None
) -> tuple[UserPlan, PlanChange | None]:
    plan_row = await get_plan(session, user_id, plan_id)
    before = plan_row.snapshot
    docs = await list_documents(session, user_id)
    ok = await evaluate(session, plan_row, docs, await progress_map(session, user_id), cache)
    change = diff_plans(plan_row, before, plan_row.snapshot) if ok else None
    if change:
        record(
            session,
            user_id,
            ActivityType.PLAN_RECALCULATED,
            "plan",
            plan_row.id,
            {"cause": {"type": "manual"}, **change.details()},
        )
    return plan_row, change


# ---------------------------------------------------------------- situation (signed in)


async def account_facts(session: AsyncSession, user_id: uuid.UUID, cache: TTLCache | None):
    """Everything the account already knows that matters for a new situation."""
    from app.models import CitizenProfile

    kb, _ = await get_planning_data(session, cache)
    docs = await list_documents(session, user_id)
    owned, states = planner_documents(docs, kb.documents)
    vault = {d: states.get(d, "valid") for d in owned}
    progress = {s: p for s, p in (await progress_map(session, user_id)).items() if s in kb.services}
    profile = await session.get(CitizenProfile, user_id)
    plans = await list_plans(session, user_id, PlanStatus.ACTIVE)
    return kb, profile, vault, states, progress, plans


def plan_services(p: UserPlan) -> set[str]:
    snap = p.snapshot or {}
    steps = {s["service_id"] for s in snap.get("steps", [])}
    return set(p.target_service_ids) | steps | set(snap.get("completed_service_ids", []))


async def situation_context(session: AsyncSession, user_id: uuid.UUID, cache: TTLCache | None):
    from app.llm.situation import SituationContext

    _, profile, vault, _, progress, plans = await account_facts(session, user_id, cache)
    return SituationContext(
        state=profile.state if profile else None,
        city=profile.city if profile else None,
        documents=vault,
        completed_service_ids=tuple(sorted(s for s, p in progress.items() if p == "completed")),
        in_progress_service_ids=tuple(sorted(s for s, p in progress.items() if p != "completed")),
        planned_service_ids=tuple(sorted({s for p in plans for s in p.target_service_ids})),
    )


async def account_proposal(
    session: AsyncSession, user_id: uuid.UUID, body: Any, cache: TTLCache | None
) -> dict[str, Any]:
    """Reviewed situation + account facts -> discovery + deterministic plan (never saved).

    The vault is the source of truth for documents it holds (effective statuses, so expired
    copies never count); documents only mentioned in the description are added for this
    proposal. Account progress is used as-is (completed services are not proposed again)."""
    from app.workflow.discovery import CitizenContext
    from app.workflow.service import propose_workflow

    kb, profile, vault, vault_states, progress, plans = await account_facts(session, user_id, cache)
    profile_state = profile.state if profile else None
    state = body.state or profile_state
    state_source = (
        (body.state_source or "description")
        if body.state
        else ("profile" if profile_state else "none")
    )
    extra_held = [d for d in dict.fromkeys(body.held_document_ids) if d not in vault]
    states = {**{d: s for d, s in body.document_states.items() if d in extra_held}, **vault_states}
    account_completed = sorted(s for s, p in progress.items() if p == "completed")
    reported = [
        s for s in dict.fromkeys(body.reported_completed_service_ids) if s not in account_completed
    ]
    ctx = CitizenContext(
        goals=tuple(body.goals),
        life_events=tuple(body.life_events),
        state=state,
        held_document_ids=tuple([*vault, *extra_held]),
        lacking_document_ids=tuple(d for d in body.lacking_document_ids if d not in vault),
        completed_service_ids=tuple([*account_completed, *reported]),
    )
    result, names = await propose_workflow(
        session,
        ctx,
        document_states=states,
        progress={s: p for s, p in progress.items() if p != "completed"},
        target_ids=body.target_service_ids,
        requested_ids=body.requested_service_ids,
        cache=cache,
    )
    from app.schemas.workflow import build_proposal_response

    proposal = build_proposal_response(result, names, normalise_state(state))
    done = set(ctx.completed_service_ids)
    pending = set(result.target_ids) - done  # completed targets are shown as done, not planned
    proposed = pending | {s.service_id for s in result.supporting}
    overlaps = []
    for p in plans:
        common = sorted(proposed & plan_services(p))
        if common:
            overlaps.append(
                {
                    "plan_id": p.id,
                    "title": p.title,
                    "target_service_ids": p.target_service_ids,
                    "overlapping_service_ids": common,
                    "covers_all": bool(pending) and pending <= set(p.target_service_ids),
                }
            )
    overlaps.sort(key=lambda o: (not o["covers_all"], -len(o["overlapping_service_ids"])))
    if not pending:
        recommendation, rec_plan = "none", None
    elif overlaps and overlaps[0]["covers_all"]:
        recommendation, rec_plan = "covered", overlaps[0]["plan_id"]
    elif overlaps:
        recommendation, rec_plan = "extend", overlaps[0]["plan_id"]
    else:
        recommendation, rec_plan = "new", None
    return {
        "proposal": proposal,
        "account_context": {
            "state": normalise_state(state),
            "state_source": state_source,
            "profile_state": profile_state,
            "city": profile.city if profile else None,
            "vault": vault,
            "documents_from_description": extra_held,
            "completed_service_ids": account_completed,
            "reported_completed_service_ids": reported,
            "in_progress": {s: p for s, p in progress.items() if p != "completed"},
        },
        "existing_plans": overlaps,
        "recommendation": recommendation,
        "recommended_plan_id": rec_plan,
    }


# ---------------------------------------------------------------- dashboard

EXPIRY_WARNING_DAYS = 30


async def dashboard(session: AsyncSession, user_id: uuid.UUID) -> dict[str, Any]:
    from app.models import CitizenProfile

    profile = await session.get(CitizenProfile, user_id)
    plans = await list_plans(session, user_id, PlanStatus.ACTIVE)
    docs = await list_documents(session, user_id)
    on = today()
    actions, blockers = [], []
    for p in plans:
        snap = p.snapshot or {}
        nxt = snap.get("next_action")
        if nxt and nxt.get("type") != "none":
            actions.append(
                {
                    "plan_id": p.id,
                    "plan_title": p.title,
                    "type": nxt["type"],
                    "service_id": nxt.get("service_id"),
                    "reason_code": (nxt.get("reason") or {}).get("code", ""),
                    "document_options": nxt.get("document_options", []),
                }
            )
        for b in snap.get("blockers", []):
            blockers.append(
                {
                    "plan_id": p.id,
                    "plan_title": p.title,
                    "code": b["code"],
                    "service_id": b["service_id"],
                    "requirement_id": b.get("requirement_id"),
                    "document_options": b.get("document_options", []),
                    "blocked_by_service_ids": b.get("blocked_by_service_ids", []),
                }
            )
    counts = {s.value: 0 for s in VaultDocumentStatus}
    for d in docs:
        counts[effective_status(d, on).value] += 1
    soon = [
        d
        for d in docs
        if effective_status(d, on) == VaultDocumentStatus.VALID
        and d.expiry_date is not None
        and (d.expiry_date - on).days <= EXPIRY_WARNING_DAYS
    ]
    expired = [d for d in docs if effective_status(d, on) == VaultDocumentStatus.EXPIRED]
    soon.sort(key=lambda d: d.expiry_date or on)
    return {
        "today": on,
        "profile": profile,
        "plans": plans,
        "next_actions": actions,
        "blockers": blockers,
        "progress": await progress_map(session, user_id),
        "vault_counts": counts,
        "vault_total": len(docs),
        "expiring_soon": soon,
        "expired": expired,
        "recent_activity": await list_activity(session, user_id, limit=6),
    }
