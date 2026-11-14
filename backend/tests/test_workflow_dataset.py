"""Planner behaviour on the real curated dataset, loaded through the database snapshot loader."""

import pytest
from sqlalchemy import select

from app.models import ServiceRequirement
from app.models.enums import VerificationStatus
from app.workflow.domain import (
    BlockerCode,
    DependencyReason,
    NextActionType,
    PlanRequest,
    RequirementState,
    StepRole,
    StepStatus,
)
from app.workflow.loader import load_snapshot
from app.workflow.planner import plan

AADHAAR = "aadhaar-address-update"
VOTER = "voter-id-address-change-form-8"
DL = "driving-licence-address-change"
RC = "vehicle-rc-address-change"
PASSPORT = "passport-reissue-change-of-address"


@pytest.fixture
async def snapshot(seeded_factory):
    async with seeded_factory() as s:
        return await load_snapshot(s)


def run(snapshot, targets, owned=(), completed=()):
    return plan(snapshot, PlanRequest(tuple(targets), tuple(owned), tuple(completed)))


def step(result, sid):
    return next(s for s in result.steps if s.service_id == sid)


def test_snapshot_contains_only_verified_facts(snapshot):
    assert set(snapshot.services) == {AADHAAR, VOTER, DL, RC, PASSPORT}
    assert all(s.prerequisites == () for s in snapshot.services.values())
    assert snapshot.producers_of("aadhaar_current_address") == [AADHAAR]
    assert snapshot.producers_of("driving_licence_current_address") == [DL]
    for svc in snapshot.services.values():
        for r in svc.requirements:
            assert r.evidence_ids and all(e in snapshot.evidence for e in r.evidence_ids)


def test_one_utility_bill_makes_three_services_independent(snapshot):
    owned = ["aadhaar_number", "epic_existing", "passport_existing", "electricity_bill"]
    r = run(snapshot, [AADHAAR, VOTER, PASSPORT], owned)
    assert all(s.status is StepStatus.READY and s.depends_on == () for s in r.steps)
    assert r.parallel_groups == ((AADHAAR, PASSPORT, VOTER),)
    assert r.blockers == () and r.acquisition_routes == ()
    # The Form 8 Aadhaar number is optional: never an edge, never a blocker.
    assert r.prerequisite_services == ()


def test_aadhaar_update_is_not_assumed_to_be_a_prerequisite(snapshot):
    owned = ["epic_existing", "passport_existing", "rent_or_lease_agreement"]
    r = run(snapshot, [VOTER, PASSPORT], owned)
    assert AADHAAR not in {s.service_id for s in r.steps}
    assert all(s.status is StepStatus.READY for s in r.steps)


def test_dl_waits_for_aadhaar_when_only_a_bill_is_held(snapshot):
    # Electricity bill is accepted by UIDAI but not listed for DL; an updated Aadhaar is.
    owned = ["aadhaar_number", "driving_licence_existing", "electricity_bill"]
    r = run(snapshot, [AADHAAR, DL], owned)
    assert [s.service_id for s in r.steps] == [AADHAAR, DL]
    assert step(r, DL).status is StepStatus.WAITING
    [dep] = step(r, DL).depends_on
    assert dep.reason is DependencyReason.ACQUISITION
    assert dep.document_id == "aadhaar_current_address" and dep.evidence_ids
    assert r.next_action.type is NextActionType.START_SERVICE
    assert r.next_action.service_id == AADHAAR
    assert r.next_action.reason.unblocks == (DL,)


def test_acquisition_step_is_added_when_not_selected(snapshot):
    owned = ["aadhaar_number", "driving_licence_existing", "electricity_bill"]
    r = run(snapshot, [DL], owned)
    assert step(r, AADHAAR).role is StepRole.ACQUISITION
    [route] = r.acquisition_routes
    assert (route.service_id, route.for_service_id) == (AADHAAR, DL)


def test_replan_after_completing_aadhaar_update(snapshot):
    owned = ["aadhaar_number", "driving_licence_existing", "electricity_bill"]
    r = run(snapshot, [AADHAAR, DL], owned, completed=[AADHAAR])
    assert [s.service_id for s in r.steps] == [DL]
    poa = next(x for x in step(r, DL).requirements if x.name.startswith("Proof"))
    assert poa.satisfied_by_document_id == "aadhaar_current_address"
    assert step(r, DL).status is StepStatus.READY


def test_driving_licence_never_serves_as_aadhaar_address_proof(snapshot):
    owned = ["aadhaar_number", "driving_licence_current_address", "driving_licence_existing"]
    r = run(snapshot, [AADHAAR], owned)
    poa = next(
        x for x in step(r, AADHAAR).requirements if x.requirement_id.endswith("proof-of-address")
    )
    assert poa.state is not RequirementState.SATISFIED


def test_rc_proof_of_address_without_route_is_a_blocker(snapshot):
    owned = ["rc_existing", "vehicle_insurance_certificate", "puc_certificate"]
    r = run(snapshot, [RC], owned)
    [b] = r.blockers
    assert b.code is BlockerCode.MISSING_DOCUMENT_NO_ROUTE
    assert b.document_options == ("rto_accepted_address_proof",)
    # Conditional items (financier NOC, PAN/Form 60, pencil print) never block.
    assert {o.kind.value for o in r.optional_documents} == {"conditional"}
    assert r.next_action.type is NextActionType.OBTAIN_DOCUMENT
    ready = run(snapshot, [RC], [*owned, "rto_accepted_address_proof"])
    assert step(ready, RC).status is StepStatus.READY


def test_nothing_held_yields_blockers_not_cycles(snapshot):
    r = run(snapshot, [AADHAAR, VOTER, DL, RC, PASSPORT])
    assert r.blockers and all(s.status is StepStatus.BLOCKED for s in r.steps)
    assert r.next_action.type is NextActionType.OBTAIN_DOCUMENT


async def test_unverified_requirements_are_excluded_from_planning(seeded_factory):
    async with seeded_factory() as s:
        rows = (
            await s.execute(select(ServiceRequirement).where(ServiceRequirement.slug == "puc"))
        ).scalars()
        for row in rows:
            row.verification_status = VerificationStatus.NEEDS_REVIEW
        await s.commit()
        snap = await load_snapshot(s)
    assert "vehicle-rc-address-change.puc" not in {r.id for r in snap.services[RC].requirements}


# ---------------------------------------------------------------- independent validation


def test_evaluation_workflow_expectations_hold(snapshot):
    """The hand-derived workflow outcomes in data/evaluation/scenarios.json (no Gemini)."""
    import json
    from pathlib import Path

    cases = json.loads(
        (Path(__file__).resolve().parents[2] / "data/evaluation/scenarios.json").read_text()
    )["cases"]
    checked = 0
    for c in cases:
        if "workflow" not in c:
            continue
        wf = c["workflow"]
        r = run(
            snapshot,
            wf["target_service_ids"],
            wf["owned_document_ids"],
            wf["completed_service_ids"],
        )
        exp = c["expected_next_action"]
        assert r.next_action.type.value == exp["type"], c["id"]
        if exp["type"] == "start_service":
            assert r.next_action.service_id in exp["service_ids"], c["id"]
        if c.get("expected_dependencies") is not None:
            edges = {(d.service_id, s.service_id) for s in r.steps for d in s.depends_on}
            assert edges == {tuple(e) for e in c["expected_dependencies"]}, c["id"]
        checked += 1
    assert checked == 5


def test_replan_after_document_reported_missing(snapshot):
    owned = ["aadhaar_number", "epic_existing", "passport_existing", "rent_or_lease_agreement"]
    ready = run(snapshot, [AADHAAR, VOTER, PASSPORT], owned)
    assert all(s.status is StepStatus.READY for s in ready.steps)
    # The user un-ticks the rent agreement: every step loses its only proof of address.
    lost = run(
        snapshot, [AADHAAR, VOTER, PASSPORT], [d for d in owned if d != "rent_or_lease_agreement"]
    )
    assert all(s.status is StepStatus.BLOCKED for s in lost.steps)
    assert lost.next_action.type is NextActionType.OBTAIN_DOCUMENT


def test_plans_are_stable_under_repetition_and_input_order(snapshot):
    owned = ["electricity_bill", "aadhaar_number", "driving_licence_existing"]
    first = run(snapshot, [DL, AADHAAR], owned)
    for _ in range(5):
        assert run(snapshot, [DL, AADHAAR], list(reversed(owned))).steps == first.steps
    assert run(snapshot, [AADHAAR, DL], owned).next_action == first.next_action


def test_no_dependency_is_invented_between_satisfied_services(snapshot):
    everything = [
        "aadhaar_number", "epic_existing", "driving_licence_existing", "rc_existing",
        "passport_existing", "electricity_bill", "aadhaar_current_address",
        "rto_accepted_address_proof", "vehicle_insurance_certificate", "puc_certificate",
    ]  # fmt: skip
    r = run(snapshot, [AADHAAR, VOTER, DL, RC, PASSPORT], everything)
    assert all(s.depends_on == () for s in r.steps)
    assert len(r.parallel_groups) == 1 and r.blockers == ()
