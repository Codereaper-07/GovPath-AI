"""First knowledge-base expansion batch (2026-11-15): discovery, routes, AND/OR semantics and the
live-validated scenarios, on the curated dataset."""

import pytest

from app.workflow.discovery import CandidateStatus, CitizenContext, discover
from app.workflow.domain import (
    BlockerCode,
    ClarificationCode,
    NextActionType,
    PlanRequest,
    ReasonCode,
    StepRole,
    StepStatus,
)
from app.workflow.loader import load_snapshot
from app.workflow.planner import plan

FORM6 = "voter-id-new-registration-form-6"
FORM8 = "voter-id-address-change-form-8"
FRESH = "passport-fresh-issue"
MOBILE = "aadhaar-mobile-number-update"
DL_RENEW = "driving-licence-renewal"
DL_DUP = "driving-licence-duplicate"
RC_DUP = "vehicle-duplicate-rc"
RC_ADDR = "vehicle-rc-address-change"
MARRIAGE = "marriage-registration-delhi"
NAME_AADHAAR = "aadhaar-name-update"
NAME_PASSPORT = "passport-reissue-name-change-marriage"
EPAN = "instant-e-pan"


@pytest.fixture
async def snapshot(seeded_factory):
    async with seeded_factory() as s:
        return await load_snapshot(s)


def run(kb, targets, owned=(), state="Delhi", lacking=()):
    req = PlanRequest(
        tuple(targets), tuple(owned), citizen_state=state, lacking_document_ids=lacking
    )
    return plan(kb, req)


def statuses(r):
    return {s.service_id: s.status for s in r.steps}


def edges(r):
    return {(d.service_id, s.service_id) for s in r.steps for d in s.depends_on}


@pytest.mark.parametrize(
    ("goal", "service"),
    [
        ("register-as-voter", FORM6),
        ("get-passport", FRESH),
        ("update-aadhaar-mobile", MOBILE),
        ("renew-driving-licence", DL_RENEW),
        ("replace-lost-document", DL_DUP),
        ("replace-lost-document", RC_DUP),
    ],
)
def test_new_services_are_discovered_by_their_goal(snapshot, goal, service):
    # Services that need an existing record (Aadhaar number, licence) first ask whether the citizen
    # holds it; once held they are included. No state restriction (Karnataka is not special).
    held = ("aadhaar_number", "driving_licence_existing")
    ask = {
        x.service_id: x
        for x in discover(snapshot, CitizenContext(goals=(goal,), state="Karnataka")).candidates
    }
    assert ask[service].status in (CandidateStatus.INCLUDED, CandidateStatus.NEEDS_CLARIFICATION)
    ctx = CitizenContext(goals=(goal,), state="Karnataka", held_document_ids=held)
    c = {x.service_id: x for x in discover(snapshot, ctx).candidates}
    assert c[service].status is CandidateStatus.INCLUDED


def test_new_services_cite_verified_evidence_for_every_requirement_and_output(snapshot):
    for sid in (FORM6, FRESH, MOBILE, DL_RENEW, DL_DUP, RC_DUP):
        spec = snapshot.services[sid]
        assert spec.requirements and spec.outputs, sid
        assert all(r.evidence_ids for r in spec.requirements), sid
        assert all(spec.output_evidence.get(o) for o in spec.outputs), sid


def test_scenario_c_is_unchanged(snapshot):
    """Live Scenario C: Aadhaar + passport held, no marriage certificate (Delhi)."""
    r = run(snapshot, [NAME_AADHAAR, NAME_PASSPORT], ["aadhaar_number", "passport_existing"])
    assert r.parallel_groups == ((MARRIAGE,), tuple(sorted((NAME_AADHAAR, NAME_PASSPORT))))
    assert edges(r) == {(MARRIAGE, NAME_AADHAAR), (MARRIAGE, NAME_PASSPORT)}
    assert r.next_action.requirement_id == "marriage-registration-delhi.affidavits"
    no_route = {
        b.requirement_id for b in r.blockers if b.code is BlockerCode.MISSING_DOCUMENT_NO_ROUTE
    }
    assert no_route == {
        "marriage-registration-delhi.affidavits",
        "marriage-registration-delhi.photographs",
    }


def test_scenario_a_re_evaluated_no_impossible_e_pan_step(snapshot):
    """Live Scenario A (empty vault, Delhi). Before the route fix the planner added Instant e-PAN
    to supply marriage registration's identity proof, although e-PAN itself needs an Aadhaar
    number the citizen does not have (and an Aadhaar number alone already satisfies that proof).
    Now: marriage registration first, both name updates after it, and the identity proof is asked
    for directly (any one of the accepted documents)."""
    r = run(snapshot, [NAME_AADHAAR, NAME_PASSPORT])
    assert r.parallel_groups == ((MARRIAGE,), tuple(sorted((NAME_AADHAAR, NAME_PASSPORT))))
    assert EPAN not in statuses(r) and MOBILE not in statuses(r)
    assert r.next_action.type is NextActionType.OBTAIN_DOCUMENT
    assert r.next_action.requirement_id == "marriage-registration-delhi.identity-proof"
    assert {"aadhaar_number", "pan_card"} <= set(r.next_action.document_options)


def test_scenario_b_no_generic_passport_renewal_service(snapshot):
    passport_services = sorted(s for s in snapshot.services if "passport" in s)
    assert passport_services == [FRESH, "passport-reissue-change-of-address", NAME_PASSPORT]


def test_alternatives_are_not_independent_requirements(snapshot):
    # Any one address proof and any one date-of-birth proof satisfy the fresh passport.
    r = run(snapshot, [FRESH], ["electricity_bill", "pan_card"])
    assert statuses(r) == {FRESH: StepStatus.READY} and r.blockers == ()


def test_parallel_services_stay_parallel(snapshot):
    owned = [
        "photograph",
        "birth_certificate",
        "electricity_bill",
        "aadhaar_number",
        "driving_licence_existing",
    ]
    r = run(snapshot, [FORM6, FRESH, DL_RENEW], owned)
    assert r.parallel_groups == (tuple(sorted((FORM6, FRESH, DL_RENEW))),)
    assert edges(r) == set() and all(s is StepStatus.READY for s in statuses(r).values())


def test_conditional_requirements_never_block(snapshot):
    # Duplicate RC: only PUC + insurance are mandatory; state-dependent / theft-only ones are not.
    assert statuses(
        run(snapshot, [RC_DUP], ["puc_certificate", "vehicle_insurance_certificate"])
    ) == {RC_DUP: StepStatus.READY}
    # Renewal: Form 1 / Form 1A depend on the vehicle class.
    assert statuses(run(snapshot, [DL_RENEW], ["driving_licence_existing"])) == {
        DL_RENEW: StepStatus.READY
    }


def test_duplicates_never_stand_in_for_a_document_you_never_had(snapshot):
    # No RC held: the RC address change is NOT routed through a duplicate RC.
    r = run(snapshot, [RC_ADDR], ["puc_certificate", "vehicle_insurance_certificate"])
    assert RC_DUP not in statuses(r)
    assert any(
        b.requirement_id == f"{RC_ADDR}.existing-rc" or "rc" in (b.requirement_id or "")
        for b in r.blockers
    )
    # Not enrolled: Form 8 is not chained after Form 6 (Form 6 is the alternative, not a step).
    r8 = run(snapshot, [FORM8], ["electricity_bill"])
    assert FORM6 not in statuses(r8)
    # The duplicate licence never stands in for a licence (e.g. as a date-of-birth proof).
    rp = run(snapshot, [FRESH], ["electricity_bill"])
    assert DL_DUP not in statuses(rp) and DL_RENEW not in statuses(rp)


def test_routes_only_use_curated_producers_of_an_accepted_document(snapshot):
    # Fresh passport with an Aadhaar number but no address proof: the Aadhaar address update is a
    # possible route; every added step issues a document that the requirement it serves lists as
    # an option (no invented services or edges).
    r = run(snapshot, [FRESH], ["birth_certificate", "aadhaar_number"])
    assert [a.service_id for a in r.acquisition_routes] == ["aadhaar-address-update"]
    for a in r.acquisition_routes:
        req = next(
            q
            for q in snapshot.services[a.for_service_id].requirements
            if q.id == a.for_requirement_id
        )
        assert a.document_id in req.document_ids and a.service_id in snapshot.producers_of(
            a.document_id
        )


# ---------------------------------------------------------------- impossible existing-record routes


def next_docs(r):
    return set(r.next_action.document_options)


def test_first_time_voter_is_never_routed_through_form_8(snapshot):
    r = run(snapshot, [FORM6], ["photograph", "birth_certificate"])
    assert statuses(r) == {FORM6: StepStatus.BLOCKED} and FORM8 not in statuses(r)
    assert "epic_existing" not in next_docs(r)
    assert r.next_action.requirement_id == f"{FORM6}.proof-of-residence"  # any one of its list


def test_existing_epic_keeps_the_form_8_route(snapshot):
    r = run(
        snapshot, ["passport-reissue-change-of-address"], ["passport_existing", "epic_existing"]
    )
    assert (FORM8, "passport-reissue-change-of-address") in edges(r)
    assert r.steps[0].role is StepRole.ACQUISITION


def test_first_time_passport_applicant_is_never_routed_through_reissue(snapshot):
    r = run(snapshot, [FRESH], ["birth_certificate"])
    assert statuses(r) == {FRESH: StepStatus.BLOCKED}  # no reissue, no Form 8, no Form 6 detour
    assert not {"passport_existing", "epic_existing"} & next_docs(r)
    assert r.next_action.requirement_id == f"{FRESH}.proof-of-present-address"


def test_existing_passport_holder_keeps_the_reissue_route(snapshot):
    owned = ["aadhaar_number", "passport_existing"]
    r = run(snapshot, ["aadhaar-address-update"], owned)
    assert ("passport-reissue-change-of-address", "aadhaar-address-update") in edges(r)


def test_discovery_and_planner_use_the_same_record_rule(snapshot):
    # Not enrolled: discovery excludes Form 8 and the planner never routes through it.
    found = discover(
        snapshot,
        CitizenContext(
            goals=("update-address",), state="Delhi", lacking_document_ids=("epic_existing",)
        ),
    )
    assert {c.service_id: c.status for c in found.candidates}[FORM8] is CandidateStatus.EXCLUDED
    r = run(snapshot, ["passport-reissue-change-of-address"], ["passport_existing"])
    assert FORM8 not in statuses(r)


# ---------------------------------------------------------------- Aadhaar mobile registration

EPAN_DOCS = ["aadhaar_number", "digilocker_access", "driving_licence_existing"]


def test_e_pan_with_registered_mobile_has_no_mobile_step(snapshot):
    r = run(snapshot, [EPAN], [*EPAN_DOCS, "mobile_linked_to_aadhaar"])
    assert statuses(r) == {EPAN: StepStatus.READY} and r.clarifications == ()


def test_e_pan_with_unknown_mobile_status_asks_instead_of_assuming(snapshot):
    r = run(snapshot, [EPAN], EPAN_DOCS)
    assert MOBILE not in statuses(r)
    [q] = r.clarifications
    assert q.code is ClarificationCode.DOCUMENT_STATUS_REQUIRED
    assert (q.service_id, q.document_id, q.route_service_ids) == (
        EPAN,
        "mobile_linked_to_aadhaar",
        (MOBILE,),
    )
    [b] = r.blockers
    assert b.code is BlockerCode.STATUS_UNKNOWN and b.route_service_ids == (MOBILE,)
    assert r.next_action.reason.code is ReasonCode.CONFIRM_DOCUMENT
    assert r.next_action.document_options == ("mobile_linked_to_aadhaar",)


def test_e_pan_with_explicitly_unregistered_mobile_routes_through_uidai(snapshot):
    r = run(snapshot, [EPAN], EPAN_DOCS, lacking=("mobile_linked_to_aadhaar",))
    assert edges(r) == {(MOBILE, EPAN)} and r.clarifications == ()
    assert statuses(r) == {MOBILE: StepStatus.READY, EPAN: StepStatus.WAITING}
    route = r.acquisition_routes[0]
    assert route.evidence_ids == ("uidai-mobile-register-at-centre",)  # official UIDAI text


def test_mobile_update_still_needs_an_existing_aadhaar(snapshot):
    owned = ["digilocker_access", "driving_licence_existing"]
    r = run(snapshot, [EPAN], owned, lacking=("mobile_linked_to_aadhaar",))
    assert MOBILE not in statuses(r)  # it could not be done without an Aadhaar number
    assert r.next_action.document_options == ("aadhaar_number",)


def test_choosing_the_mobile_update_yourself_uses_it_without_asking(snapshot):
    r = run(snapshot, [EPAN, MOBILE], EPAN_DOCS)
    assert edges(r) == {(MOBILE, EPAN)} and r.clarifications == ()


def test_a_proposal_keeps_an_explicitly_unregistered_mobile_as_a_chosen_service(snapshot):
    """Saved plans are re-evaluated from the vault, which cannot record 'I don't have it', so the
    proposal turns the declared gap into a service the citizen chose (kept on recalculation)."""
    from app.workflow.proposal import propose

    base = CitizenContext(goals=("get-pan",), state="Delhi", held_document_ids=tuple(EPAN_DOCS))
    unknown = propose(snapshot, base, requested_ids=(EPAN,))
    assert unknown.target_ids == (EPAN,) and MOBILE not in statuses(unknown.plan)
    lacking = CitizenContext(
        **{**base.__dict__, "lacking_document_ids": ("mobile_linked_to_aadhaar",)}
    )
    told = propose(snapshot, lacking, requested_ids=(EPAN,))
    assert told.target_ids == (EPAN, MOBILE)
    assert edges(told.plan) == {(MOBILE, EPAN)}
    # Re-evaluating the saved targets without the declaration gives the same workflow.
    assert edges(run(snapshot, told.target_ids, EPAN_DOCS)) == {(MOBILE, EPAN)}


def test_no_aadhaar_no_mobile_says_the_update_needs_aadhaar_first_without_changing_the_plan(
    snapshot,
):
    """Presentation data only: the mobile item names the service that can provide it later and the
    record it needs; steps, routes and the next action (get the Aadhaar number) are unchanged."""
    owned = ["digilocker_access", "driving_licence_existing"]
    for lacking in ((), ("mobile_linked_to_aadhaar",)):
        r = run(snapshot, [EPAN], owned, lacking=lacking)
        assert statuses(r) == {EPAN: StepStatus.BLOCKED} and r.acquisition_routes == ()
        assert r.next_action.document_options == ("aadhaar_number",)
        mobile = next(
            b for b in r.blockers if b.requirement_id == "instant-e-pan.aadhaar-linked-mobile"
        )
        assert mobile.code is BlockerCode.MISSING_DOCUMENT_NO_ROUTE
        assert mobile.route_service_ids == (MOBILE,) and mobile.route_needs_document_ids == (
            "aadhaar_number",
        )
        aadhaar = next(b for b in r.blockers if b.requirement_id == "instant-e-pan.aadhaar-number")
        assert aadhaar.route_service_ids == () and aadhaar.route_needs_document_ids == ()


def test_alternative_groups_are_not_annotated(snapshot):
    # Scenario A: e-PAN could issue a PAN for the identity-proof group only with an Aadhaar number,
    # which is itself an accepted option there, so no "once you have" note is added.
    r = run(snapshot, [NAME_AADHAAR, NAME_PASSPORT])
    ident = next(
        b for b in r.blockers if b.requirement_id == "marriage-registration-delhi.identity-proof"
    )
    assert ident.route_service_ids == () and ident.route_needs_document_ids == ()
