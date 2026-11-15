"""The signed-in citizen's vault, progress, saved plans and activity (`/api/me/*`).

The owner is always the verified token's user; another user's row answers 404. There are no
endpoints that change or delete activity history.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.account import service as svc
from app.api.routes.situation import get_interpreter, run_interpreter, situation_vocabulary
from app.auth import CurrentUser
from app.db import get_session
from app.knowledge.cache import TTLCache, get_knowledge_cache
from app.llm.situation import SituationInterpreter, state_mentioned
from app.models import UserPlan, VaultDocument
from app.models.enums import PlanStatus
from app.schemas.account import (
    AccountProposalOut,
    AccountProposeIn,
    ActivityEventOut,
    ActivityListOut,
    DashboardActionOut,
    DashboardBlockerOut,
    DashboardOut,
    DocumentListOut,
    DocumentRefOut,
    DocumentWriteOut,
    PlanChangeOut,
    PlanCreate,
    PlanDetailOut,
    PlanListOut,
    PlanSummaryOut,
    PlanUpdate,
    ProgressOut,
    ProgressUpdate,
    StepChangeOut,
    VaultDocumentCreate,
    VaultDocumentOut,
    VaultDocumentUpdate,
)
from app.schemas.situation import SituationIn, SituationOut
from app.workflow.errors import DependencyCycleError, UnknownIdsError
from app.workflow.service import get_planning_data

router = APIRouter(prefix="/me", tags=["account"])

Session = Annotated[AsyncSession, Depends(get_session)]
Cache = Annotated[TTLCache, Depends(get_knowledge_cache)]


def _not_found(what: str) -> HTTPException:
    return HTTPException(404, {"code": "not_found", "message": f"{what} not found."})


def _error(exc: Exception) -> HTTPException:
    if isinstance(exc, svc.NotFoundError):
        return _not_found("Item")
    if isinstance(exc, UnknownIdsError):
        return HTTPException(
            422,
            {
                "code": "unknown_ids",
                "message": str(exc),
                "unknown_service_ids": exc.unknown_service_ids,
                "unknown_document_ids": exc.unknown_document_ids,
            },
        )
    if isinstance(exc, svc.ConflictError):
        return HTTPException(409, {"code": exc.code, "message": str(exc), **exc.extra})
    if isinstance(exc, svc.InvalidInputError):
        return HTTPException(422, {"code": exc.code, "message": str(exc), **exc.extra})
    raise exc


HANDLED = (svc.NotFoundError, UnknownIdsError, svc.ConflictError, svc.InvalidInputError)


def _changes(changes: list[svc.PlanChange]) -> list[PlanChangeOut]:
    return [
        PlanChangeOut(
            plan_id=c.plan_id,
            title=c.title,
            steps=[StepChangeOut(**s) for s in c.steps],
            blockers_added=c.blockers_added,
            blockers_removed=c.blockers_removed,
            next_action_changed=c.next_action_changed,
        )
        for c in changes
    ]


async def _document_out(
    session: AsyncSession,
    user_id: uuid.UUID,
    docs: list[VaultDocument],
    cache: TTLCache,
) -> list[VaultDocumentOut]:
    _, names = await get_planning_data(session, cache)
    using = svc.plans_using(await svc.list_plans(session, user_id, PlanStatus.ACTIVE))
    on = svc.today()
    out = []
    for d in docs:
        name = names["documents"].get(d.document_type)
        out.append(
            VaultDocumentOut(
                id=d.id,
                document_type=d.document_type,
                name=name[0] if name else None,
                name_hi=name[1] if name else None,
                status=d.status,
                effective_status=svc.effective_status(d, on),
                expiry_passed=svc.expiry_passed(d, on),
                label=d.label,
                issue_date=d.issue_date,
                expiry_date=d.expiry_date,
                note=d.note,
                used_by_plan_ids=using.get(d.document_type, []),
                created_at=d.created_at,
                updated_at=d.updated_at,
            )
        )
    return out


def _event_out(e) -> ActivityEventOut:
    return ActivityEventOut(
        id=e.id,
        event_type=e.event_type.value,
        entity_type=e.entity_type,
        entity_id=e.entity_id,
        details=e.details,
        created_at=e.created_at,
    )


def _summary_fields(p: UserPlan) -> dict:
    snap = p.snapshot or {}
    prog = snap.get("progress") or {}
    return {
        "id": p.id,
        "title": p.title,
        "status": p.status.value,
        "target_service_ids": p.target_service_ids,
        "citizen_state": p.citizen_state,
        "goals": p.goals,
        "service_names": snap.get("services", {}),
        "total_services": prog.get("total_services", len(snap.get("steps", []))),
        "completed": prog.get("completed", 0),
        "blocked": prog.get("blocked", 0),
        "ready": prog.get("ready", 0),
        "next_action": (
            {k: snap["next_action"].get(k) for k in ("type", "service_id")}
            if snap.get("next_action")
            else None
        ),
        "evaluation_error": p.evaluation_error,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
        "archived_at": p.archived_at,
    }


async def _plan_detail(
    session: AsyncSession,
    user_id: uuid.UUID,
    p: UserPlan,
    *,
    created: list[uuid.UUID] | None = None,
    changes: list[svc.PlanChange] | None = None,
) -> PlanDetailOut:
    await session.refresh(p)
    docs = await svc.list_documents(session, user_id)
    return PlanDetailOut(
        **_summary_fields(p),
        evaluated_at=p.evaluated_at,
        plan=p.snapshot,
        document_refs=[DocumentRefOut(**r) for r in svc.document_refs(p, docs)],
        created_document_ids=created or [],
        plan_changes=_changes(changes or []),
    )


# ---------------------------------------------------------------- documents


@router.get("/documents", response_model=DocumentListOut)
async def list_documents(user: CurrentUser, session: Session, cache: Cache) -> DocumentListOut:
    await svc.catch_up(session, user.id, cache)
    docs = await svc.list_documents(session, user.id)
    return DocumentListOut(documents=await _document_out(session, user.id, docs, cache))


@router.post("/documents", response_model=DocumentWriteOut, status_code=201)
async def add_document(
    body: VaultDocumentCreate, user: CurrentUser, session: Session, cache: Cache
) -> DocumentWriteOut:
    try:
        doc, changes = await svc.create_document(session, user.id, body.model_dump(), cache)
    except HANDLED as exc:
        raise _error(exc) from exc
    await session.commit()
    await session.refresh(doc)
    [out] = await _document_out(session, user.id, [doc], cache)
    return DocumentWriteOut(document=out, plan_changes=_changes(changes))


@router.patch("/documents/{document_id}", response_model=DocumentWriteOut)
async def edit_document(
    document_id: uuid.UUID,
    body: VaultDocumentUpdate,
    user: CurrentUser,
    session: Session,
    cache: Cache,
) -> DocumentWriteOut:
    try:
        doc, changes = await svc.update_document(
            session, user.id, document_id, body.model_dump(include=body.model_fields_set), cache
        )
    except HANDLED as exc:
        raise _error(exc) from exc
    await session.commit()
    await session.refresh(doc)
    [out] = await _document_out(session, user.id, [doc], cache)
    return DocumentWriteOut(document=out, plan_changes=_changes(changes))


@router.delete("/documents/{document_id}", response_model=DocumentWriteOut)
async def remove_document(
    document_id: uuid.UUID, user: CurrentUser, session: Session, cache: Cache
) -> DocumentWriteOut:
    try:
        changes = await svc.delete_document(session, user.id, document_id, cache)
    except HANDLED as exc:
        raise _error(exc) from exc
    await session.commit()
    return DocumentWriteOut(document=None, plan_changes=_changes(changes))


# ---------------------------------------------------------------- progress


@router.get("/progress", response_model=ProgressOut)
async def get_progress(user: CurrentUser, session: Session) -> ProgressOut:
    return ProgressOut(progress=await svc.progress_map(session, user.id))


@router.put("/progress/{service_id}", response_model=ProgressOut)
async def put_progress(
    service_id: str,
    body: ProgressUpdate,
    user: CurrentUser,
    session: Session,
    cache: Cache,
) -> ProgressOut:
    if not service_id.strip() or len(service_id) > 100:
        raise HTTPException(422, {"code": "invalid_service", "message": "Invalid service id."})
    try:
        _, changes = await svc.set_progress(session, user.id, service_id, body.state, cache)
    except HANDLED as exc:
        raise _error(exc) from exc
    await session.commit()
    return ProgressOut(
        progress=await svc.progress_map(session, user.id), plan_changes=_changes(changes)
    )


# ---------------------------------------------------------------- plans


@router.get("/plans", response_model=PlanListOut)
async def list_plans(
    user: CurrentUser,
    session: Session,
    cache: Cache,
    plan_status: Annotated[
        str, Query(alias="status", pattern="^(active|archived|all)$")
    ] = "active",
) -> PlanListOut:
    await svc.catch_up(session, user.id, cache)
    wanted = None if plan_status == "all" else PlanStatus(plan_status)
    plans = await svc.list_plans(session, user.id, wanted)
    return PlanListOut(plans=[PlanSummaryOut(**_summary_fields(p)) for p in plans])


@router.post("/plans", response_model=PlanDetailOut, status_code=201)
async def create_plan(
    body: PlanCreate, user: CurrentUser, session: Session, cache: Cache
) -> PlanDetailOut:
    """Save an accepted plan (explicit citizen action: proposal acceptance or device import)."""
    try:
        plan_row, created, changes, dedup = await svc.create_plan(session, user.id, body, cache)
    except HANDLED as exc:
        raise _error(exc) from exc
    await session.commit()
    out = await _plan_detail(session, user.id, plan_row, created=created, changes=changes)
    out.deduplicated = dedup
    return out


@router.get("/plans/{plan_id}", response_model=PlanDetailOut)
async def get_plan(
    plan_id: uuid.UUID, user: CurrentUser, session: Session, cache: Cache
) -> PlanDetailOut:
    await svc.catch_up(session, user.id, cache)
    try:
        plan_row = await svc.get_plan(session, user.id, plan_id)
    except svc.NotFoundError as exc:
        raise _not_found("Plan") from exc
    return await _plan_detail(session, user.id, plan_row)


@router.patch("/plans/{plan_id}", response_model=PlanDetailOut)
async def update_plan(
    plan_id: uuid.UUID, body: PlanUpdate, user: CurrentUser, session: Session, cache: Cache
) -> PlanDetailOut:
    try:
        plan_row, created, changes = await svc.update_plan(session, user.id, plan_id, body, cache)
    except HANDLED as exc:
        raise _error(exc) from exc
    await session.commit()
    return await _plan_detail(session, user.id, plan_row, created=created, changes=changes)


@router.post("/plans/{plan_id}/archive", response_model=PlanDetailOut)
async def archive_plan(
    plan_id: uuid.UUID, user: CurrentUser, session: Session, cache: Cache
) -> PlanDetailOut:
    try:
        plan_row = await svc.set_plan_status(session, user.id, plan_id, PlanStatus.ARCHIVED, cache)
    except HANDLED as exc:
        raise _error(exc) from exc
    await session.commit()
    return await _plan_detail(session, user.id, plan_row)


@router.post("/plans/{plan_id}/restore", response_model=PlanDetailOut)
async def restore_plan(
    plan_id: uuid.UUID, user: CurrentUser, session: Session, cache: Cache
) -> PlanDetailOut:
    try:
        plan_row = await svc.set_plan_status(session, user.id, plan_id, PlanStatus.ACTIVE, cache)
    except HANDLED as exc:
        raise _error(exc) from exc
    await session.commit()
    return await _plan_detail(session, user.id, plan_row)


@router.post("/plans/{plan_id}/recalculate", response_model=PlanDetailOut)
async def recalculate_plan(
    plan_id: uuid.UUID, user: CurrentUser, session: Session, cache: Cache
) -> PlanDetailOut:
    """Re-run the planner on demand (e.g. after the verified catalogue was updated)."""
    try:
        plan_row, change = await svc.recalculate_plan(session, user.id, plan_id, cache)
    except HANDLED as exc:
        raise _error(exc) from exc
    await session.commit()
    return await _plan_detail(session, user.id, plan_row, changes=[change] if change else [])


@router.delete("/plans/{plan_id}", status_code=204)
async def delete_plan(plan_id: uuid.UUID, user: CurrentUser, session: Session) -> Response:
    try:
        await svc.delete_plan(session, user.id, plan_id)
    except svc.NotFoundError as exc:
        raise _not_found("Plan") from exc
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- dashboard & situation


@router.get("/dashboard", response_model=DashboardOut)
async def get_dashboard(user: CurrentUser, session: Session, cache: Cache) -> DashboardOut:
    """What the citizen should do next, from their own saved data (expiries processed first)."""
    await svc.catch_up(session, user.id, cache)
    d = await svc.dashboard(session, user.id)
    profile = d["profile"]
    expiring = await _document_out(session, user.id, d["expiring_soon"], cache)
    expired = await _document_out(session, user.id, d["expired"], cache)
    return DashboardOut(
        today=d["today"],
        full_name=profile.full_name if profile else user.full_name,
        state=profile.state if profile else None,
        city=profile.city if profile else None,
        preferred_language=profile.preferred_language.value if profile else "en",
        plans=[PlanSummaryOut(**_summary_fields(p)) for p in d["plans"]],
        next_actions=[DashboardActionOut(**a) for a in d["next_actions"]],
        blockers=[DashboardBlockerOut(**b) for b in d["blockers"]],
        progress=d["progress"],
        vault_counts=d["vault_counts"],
        vault_total=d["vault_total"],
        expiring_soon=expiring,
        expired=expired,
        recent_activity=[_event_out(e) for e in d["recent_activity"]],
    )


@router.post("/situation/interpret", response_model=SituationOut)
async def interpret_situation(
    body: SituationIn,
    user: CurrentUser,
    session: Session,
    cache: Cache,
    interpreter: Annotated[SituationInterpreter, Depends(get_interpreter)],
) -> SituationOut:
    """AI reads the description WITH the account's known facts (so it does not ask for them)."""
    await svc.catch_up(session, user.id, cache)
    context = await svc.situation_context(session, user.id, cache)
    out = await run_interpreter(
        interpreter, body, await situation_vocabulary(session, cache), context
    )
    # The model may echo the profile's state although the text never names it: that is not a
    # fact from the description, so leave it to the profile (the UI then labels it correctly).
    if (
        out.state is not None
        and out.state == context.state
        and not state_mentioned(body.text, out.state)
    ):
        out.state = None
    out.account_state = context.state
    out.account_document_ids = sorted(context.documents)
    return out


@router.post("/proposal", response_model=AccountProposalOut)
async def propose_for_account(
    body: AccountProposeIn, user: CurrentUser, session: Session, cache: Cache
) -> AccountProposalOut:
    """Reviewed situation + vault + progress + profile -> proposal (never saved)."""
    await svc.catch_up(session, user.id, cache)
    try:
        out = await svc.account_proposal(session, user.id, body, cache)
    except HANDLED as exc:
        raise _error(exc) from exc
    except DependencyCycleError as exc:
        raise HTTPException(409, {"code": "dependency_cycle", "message": str(exc)}) from exc
    return AccountProposalOut(**out)


# ---------------------------------------------------------------- activity (read-only)


@router.get("/activity", response_model=ActivityListOut)
async def list_activity(
    user: CurrentUser,
    session: Session,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    before_id: Annotated[int | None, Query(ge=1)] = None,
    entity_id: Annotated[str | None, Query(max_length=100)] = None,
) -> ActivityListOut:
    events = await svc.list_activity(
        session, user.id, limit=limit + 1, before_id=before_id, entity_id=entity_id
    )
    more = len(events) > limit
    events = events[:limit]
    return ActivityListOut(
        events=[_event_out(e) for e in events],
        next_before_id=events[-1].id if more and events else None,
    )
