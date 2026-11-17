"""Milestone 10 acceptance scenarios for the workflow engine.

Real-service scenarios use the curated, verified dataset (loaded through the DB snapshot loader).
The knowledge base has no verified service prerequisites (no official source states one between
these services), so prerequisite expansion and cycles are tested on clearly synthetic snapshots.
"""

import pytest

from app.workflow.discovery import CitizenContext, discover
from app.workflow.domain import (
    BlockerCode,
    ClarificationCode,
    CompletionSource,
    DependencyReason,
    DocumentState,
    NextActionType,
    NoticeCode,
    PlanRequest,
    ProcessState,
    ReasonCode,
    RequirementState,
    StepRole,
    StepStatus,
)
from app.workflow.errors import DependencyCycleError
from app.workflow.loader import load_snapshot
from app.workflow.planner import plan
from tests.test_planner import kb, req, svc

AADHAAR = "aadhaar-address-update"
VOTER = "voter-id-address-change-form-8"
DL = "driving-licence-address-change"
RC = "vehicle-rc-address-change"
PASSPORT = "passport-reissue-change-of-address"
MARRIAGE = "marriage-registration-delhi"
AADHAAR_NAME = "aadhaar-name-update"
PASSPORT_NAME = "passport-reissue-name-change-marriage"
CHILD = "child-aadhaar-enrolment"
PAN = "instant-e-pan"

# Documents for Delhi marriage registration (identity, birth date, residence, affidavits, photos).
MARRIAGE_DOCS = ["passport_existing", "marriage_affidavits", "marriage_photographs_attested"]


@pytest.fixture
async def snapshot(seeded_factory):
    async with seeded_factory() as s:
        return await load_snapshot(s)


def run(snapshot, targets, owned=(), completed=(), progress=None, states=None, state=None):
    return plan(
        snapshot,
        PlanRequest(
            tuple(targets),
            tuple(owned),
            tuple(completed),
            progress=progress or {},
            document_states=states or {},
            citizen_state=state,
        ),
    )


def step(result, sid):
    return next(s for s in result.steps if s.service_id == sid)


def ids(result):
    return [s.service_id for s in result.steps]


# 1 -- all documents held


def test_all_required_documents_held_gives_a_ready_step_not_a_completed_one(snapshot):
    r = run(snapshot, [AADHAAR], ["aadhaar_number", "electricity_bill"])
    s = step(r, AADHAAR)
    assert s.status is StepStatus.READY and s.process_state is ProcessState.NOT_STARTED
    assert r.blockers == () and r.next_action.service_id == AADHAAR
    assert r.progress.completed == 0 and r.document_summary.missing == 0


# 2 -- missing mandatory document


def test_missing_mandatory_document_without_route_blocks_with_its_evidence(snapshot):
    owned = ["rc_existing", "vehicle_insurance_certificate", "puc_certificate"]
    r = run(snapshot, [RC], owned)
    assert step(r, RC).status is StepStatus.BLOCKED
    (b,) = r.blockers
    assert b.code is BlockerCode.MISSING_DOCUMENT_NO_ROUTE
    assert b.document_options == ("rto_accepted_address_proof",) and b.evidence_ids
    assert r.next_action.type is NextActionType.OBTAIN_DOCUMENT


# 3 -- workflow repair


def test_missing_marriage_certificate_inserts_marriage_registration_in_delhi(snapshot):
    owned = ["aadhaar_number", *MARRIAGE_DOCS]
    r = run(snapshot, [AADHAAR_NAME, PASSPORT_NAME], owned, state="Delhi")
    assert step(r, MARRIAGE).role is StepRole.ACQUISITION
    assert step(r, MARRIAGE).status is StepStatus.READY
    for target in (AADHAAR_NAME, PASSPORT_NAME):
        s = step(r, target)
        assert s.status is StepStatus.WAITING
        (dep,) = s.depends_on
        assert dep.service_id == MARRIAGE and dep.reason is DependencyReason.ACQUISITION
        assert dep.document_id == "marriage_certificate"
        # Both halves of the edge are evidenced: the producer issues it, the target accepts it.
        assert dep.evidence_ids and dep.acceptance_evidence_ids
    assert r.parallel_groups[0] == (MARRIAGE,)
    assert r.next_action.service_id == MARRIAGE
    assert r.next_action.reason.code is ReasonCode.UNBLOCKS_DOWNSTREAM
    assert set(r.next_action.reason.unblocks) == {AADHAAR_NAME, PASSPORT_NAME}
    assert r.clarifications == ()


def test_repair_never_uses_a_service_outside_its_verified_jurisdiction(snapshot):
    owned = ["aadhaar_number", *MARRIAGE_DOCS]
    r = run(snapshot, [AADHAAR_NAME], owned, state="Maharashtra")
    assert MARRIAGE not in ids(r)
    (b,) = r.blockers
    assert b.code is BlockerCode.ROUTE_OUTSIDE_JURISDICTION
    assert b.route_service_ids == (MARRIAGE,) and "Delhi" in b.message
    assert r.next_action.type is NextActionType.OBTAIN_DOCUMENT


def test_unknown_state_keeps_the_route_but_asks_for_the_state(snapshot):
    r = run(snapshot, [AADHAAR_NAME], ["aadhaar_number", *MARRIAGE_DOCS])
    assert MARRIAGE in ids(r)
    (c,) = r.clarifications
    assert c.code is ClarificationCode.STATE_REQUIRED and c.service_id == MARRIAGE
    assert c.region == "Delhi"


def test_holding_an_alternative_needs_no_repair(snapshot):
    r = run(snapshot, [PASSPORT_NAME], ["passport_existing", "joint_photo_declaration"])
    assert ids(r) == [PASSPORT_NAME] and r.acquisition_routes == ()


# 4, 7, 13 -- prerequisites (synthetic)


def test_the_curated_knowledge_has_no_unverified_prerequisites(snapshot):
    assert all(s.prerequisites == () for s in snapshot.services.values())


def test_verified_prerequisite_is_added_recursively_with_its_evidence():
    snap = kb(
        svc("svc_a", prereqs=["svc_b"], prerequisite_evidence={"svc_b": ("ev1",)}),
        svc("svc_b", prereqs=["svc_c"], prerequisite_evidence={"svc_c": ("ev2",)}),
        svc("svc_c"),
    )
    r = plan(snap, PlanRequest(("svc_a",)))
    assert [g for g in r.parallel_groups] == [("svc_c",), ("svc_b",), ("svc_a",)]
    assert step(r, "svc_b").role is StepRole.PREREQUISITE
    assert step(r, "svc_a").depends_on[0].evidence_ids == ("ev1",)
    assert r.next_action.service_id == "svc_c"


def test_cyclic_prerequisites_are_detected():
    snap = kb(svc("svc_a", prereqs=["svc_b"]), svc("svc_b", prereqs=["svc_a"]))
    with pytest.raises(DependencyCycleError) as exc:
        plan(snap, PlanRequest(("svc_a",)))
    assert set(exc.value.cycle) >= {"svc_a", "svc_b"}


def test_a_blocked_prerequisite_blocks_the_dependent_action():
    snap = kb(
        svc("svc_a", prereqs=["svc_b"]),
        svc("svc_b", reqs=[req("svc_b", "doc", ["doc_x"])]),
    )
    r = plan(snap, PlanRequest(("svc_a",)))
    assert step(r, "svc_b").status is StepStatus.BLOCKED
    assert step(r, "svc_a").status is StepStatus.BLOCKED
    dep = next(b for b in r.blockers if b.code is BlockerCode.DEPENDENCY_BLOCKED)
    assert dep.service_id == "svc_a" and dep.blocked_by_service_ids == ("svc_b",)
    assert r.next_action.type is NextActionType.OBTAIN_DOCUMENT
    assert r.next_action.service_id == "svc_b"


def test_missing_documents_for_a_repair_step_block_the_real_dependent(snapshot):
    # The licence and an Aadhaar number are held: the Aadhaar update that would supply an address
    # proof lacks its own documents, so the licence step is blocked by it, not waiting.
    r = run(snapshot, [DL], ["driving_licence_existing", "aadhaar_number"])
    assert step(r, AADHAAR).status is StepStatus.BLOCKED
    assert step(r, DL).status is StepStatus.BLOCKED
    assert any(
        b.code is BlockerCode.DEPENDENCY_BLOCKED and b.blocked_by_service_ids == (AADHAAR,)
        for b in r.blockers
    )
    # Without an Aadhaar number the Aadhaar update could never be done, so it is not used as a
    # route: the address proof is a plain blocker instead.
    only_dl = run(snapshot, [DL], ["driving_licence_existing"])
    assert [s.service_id for s in only_dl.steps] == [DL]
    assert any(b.code is BlockerCode.MISSING_DOCUMENT_NO_ROUTE for b in only_dl.blockers)


# 5, 6, 14 -- ordering & next action


def test_dependent_services_are_ordered_and_independent_ones_grouped(snapshot):
    owned = ["aadhaar_number", "driving_licence_existing", "passport_existing", "electricity_bill"]
    r = run(snapshot, [AADHAAR, DL, PASSPORT], owned)
    assert r.parallel_groups == ((AADHAAR, PASSPORT), (DL,))
    assert step(r, DL).depends_on[0].service_id == AADHAAR
    # Aadhaar is recommended over the equally ready passport because it unblocks the licence.
    assert r.next_action.service_id == AADHAAR
    assert r.next_action.reason.parallel_with == (PASSPORT,)
    assert r.next_action.reason.evidence_ids


# 8 -- nothing invented


def test_unsupported_dependency_is_not_invented(snapshot):
    r = run(snapshot, [CHILD], ["parent_aadhaar_numbers"])
    assert ids(r) == [CHILD] and r.acquisition_routes == ()
    assert {b.code for b in r.blockers} == {BlockerCode.MISSING_DOCUMENT_NO_ROUTE}
    r2 = run(snapshot, [PAN, AADHAAR], ["aadhaar_number", "electricity_bill"])
    assert all(s.depends_on == () for s in r2.steps)


# 9, 10 -- completion semantics


def test_holding_documents_never_completes_a_service(snapshot):
    # Even the service's own output document does not mark the process done.
    owned = ["aadhaar_number", "electricity_bill", "aadhaar_current_address"]
    r = run(snapshot, [AADHAAR], owned)
    assert step(r, AADHAAR).status is StepStatus.READY
    assert r.completed == () and r.progress.completed == 0
    r2 = run(snapshot, [MARRIAGE], ["marriage_certificate", *MARRIAGE_DOCS], state="Delhi")
    assert step(r2, MARRIAGE).process_state is ProcessState.NOT_STARTED


def test_completion_is_user_reported_and_never_claimed_as_verified(snapshot):
    r = run(
        snapshot,
        [AADHAAR, DL],
        ["aadhaar_number", "driving_licence_existing", "electricity_bill"],
        progress={AADHAAR: ProcessState.COMPLETED},
    )
    (c,) = r.completed
    assert c.service_id == AADHAAR and c.source is CompletionSource.USER_REPORTED
    assert c.output_document_ids == ("aadhaar_current_address",)
    assert r.progress.completed_user_reported == 1 and r.progress.completed_verified == 0
    assert step(r, DL).status is StepStatus.READY


# 11 -- document changes replan


def test_document_changes_recalculate_the_workflow(snapshot):
    base = ["driving_licence_existing", "aadhaar_number", "electricity_bill"]
    r = run(snapshot, [DL], base)
    assert ids(r) == [AADHAAR, DL]  # repair: the Aadhaar update supplies an address proof
    r2 = run(snapshot, [DL], [*base, "aadhaar_current_address"])
    assert ids(r2) == [DL] and step(r2, DL).status is StepStatus.READY
    # The same document marked expired no longer counts: the repair comes back.
    r3 = run(
        snapshot,
        [DL],
        [*base, "aadhaar_current_address"],
        states={"aadhaar_current_address": DocumentState.EXPIRED},
    )
    assert ids(r3) == [AADHAAR, DL]
    proof = next(
        q for q in step(r3, DL).requirements if q.requirement_id.endswith("proof-of-address")
    )
    assert proof.unusable_document_ids == ("aadhaar_current_address",)
    assert [(u.document_id, u.state) for u in r3.document_summary.unusable] == [
        ("aadhaar_current_address", DocumentState.EXPIRED)
    ]


# 12 -- progress changes replan


def test_process_progress_recalculates_status_and_next_action(snapshot):
    owned = ["aadhaar_number", "driving_licence_existing", "electricity_bill"]
    started = run(snapshot, [DL], owned, progress={AADHAAR: ProcessState.SUBMITTED})
    assert step(started, AADHAAR).status is StepStatus.IN_PROGRESS
    assert step(started, AADHAAR).process_state is ProcessState.SUBMITTED
    assert step(started, DL).status is StepStatus.WAITING
    assert started.next_action.type is NextActionType.FOLLOW_UP
    assert started.next_action.service_id == AADHAAR
    assert started.next_action.reason.code is ReasonCode.AWAIT_IN_PROGRESS
    assert started.progress.in_progress == 1 and started.progress.completed == 0

    done = run(snapshot, [DL], owned, progress={AADHAAR: ProcessState.COMPLETED})
    assert ids(done) == [DL] and step(done, DL).status is StepStatus.READY
    assert done.next_action.service_id == DL
    dl_proof = next(
        q for q in step(done, DL).requirements if q.requirement_id.endswith("proof-of-address")
    )
    assert dl_proof.state is RequirementState.SATISFIED
    assert dl_proof.satisfied_by_document_id == "aadhaar_current_address"


def test_starting_a_step_before_its_dependencies_is_flagged(snapshot):
    owned = ["aadhaar_number", "driving_licence_existing", "electricity_bill"]
    r = run(snapshot, [DL], owned, progress={DL: ProcessState.STARTED})
    assert step(r, DL).status is StepStatus.IN_PROGRESS
    (n,) = r.notices
    assert n.code is NoticeCode.STARTED_BEFORE_DEPENDENCIES and n.related_service_ids == (AADHAAR,)
    assert r.next_action.service_id == AADHAAR  # the ready dependency still comes first


def test_targets_outside_verified_jurisdiction_are_flagged(snapshot):
    r = run(snapshot, [MARRIAGE], MARRIAGE_DOCS, state="Kerala")
    assert [n.code for n in r.notices] == [NoticeCode.TARGET_OUTSIDE_JURISDICTION]


# 15 -- language independence


def test_structured_workflow_is_language_independent(snapshot):
    """The engine never sees the UI language: English and Hindi contexts that resolve to the
    same structured facts produce the identical discovery result and plan."""
    english = CitizenContext(goals=("update-name-after-marriage",), state="Delhi",
                             held_document_ids=("aadhaar_number", "passport_existing"))  # fmt: skip
    hindi = CitizenContext(goals=("update-name-after-marriage",), state="Delhi",
                           held_document_ids=("passport_existing", "aadhaar_number"))  # fmt: skip
    d_en, d_hi = discover(snapshot, english), discover(snapshot, hindi)
    assert d_en == d_hi
    p_en = run(snapshot, d_en.recommended_target_ids, english.held_document_ids, state="Delhi")
    p_hi = run(snapshot, d_hi.recommended_target_ids, hindi.held_document_ids[::-1], state="Delhi")
    assert p_en == p_hi


# Persistence/consistency regressions (audit 2026-11-14)


def test_unusable_mark_beats_output_of_completed_service(snapshot):
    """A document the citizen marked expired never satisfies a requirement, even when a
    completed service issues it (the citizen's assessment wins)."""
    owned = ["aadhaar_number", "driving_licence_existing"]
    r = run(
        snapshot,
        [DL],
        owned,
        completed=[AADHAAR],
        states={"aadhaar_current_address": DocumentState.EXPIRED},
    )
    proof = next(
        q for q in step(r, DL).requirements if "aadhaar_current_address" in q.document_options
    )
    assert proof.state is not RequirementState.SATISFIED
    assert proof.satisfied_by_document_id is None
    assert proof.unusable_document_ids == ("aadhaar_current_address",)
    assert step(r, DL).status is StepStatus.BLOCKED
    # Without the mark, the completed Aadhaar update does satisfy it.
    ok = run(snapshot, [DL], owned, completed=[AADHAAR])
    assert step(ok, DL).status is StepStatus.READY


def test_progress_of_service_that_left_the_plan_is_reported(snapshot):
    """Reported progress is never silently hidden when its service leaves the plan."""
    owned = ["aadhaar_number", *MARRIAGE_DOCS]
    progress = {MARRIAGE: ProcessState.SUBMITTED}
    delhi = run(snapshot, [AADHAAR_NAME], owned, progress=progress, state="Delhi")
    assert step(delhi, MARRIAGE).status is StepStatus.IN_PROGRESS
    assert NoticeCode.PROGRESS_OUTSIDE_PLAN not in [n.code for n in delhi.notices]
    moved = run(snapshot, [AADHAAR_NAME], owned, progress=progress, state="Maharashtra")
    assert MARRIAGE not in ids(moved)
    [notice] = [n for n in moved.notices if n.code is NoticeCode.PROGRESS_OUTSIDE_PLAN]
    assert notice.service_id == MARRIAGE and "submitted" in notice.message
