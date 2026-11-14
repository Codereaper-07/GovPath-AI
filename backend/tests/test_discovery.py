"""Deterministic service discovery on the curated dataset."""

import pytest

from app.workflow.discovery import (
    CandidateStatus,
    CitizenContext,
    DiscoveryQuestion,
    ExclusionCode,
    discover,
)
from app.workflow.loader import load_snapshot


@pytest.fixture
async def snapshot(seeded_factory):
    async with seeded_factory() as s:
        return await load_snapshot(s)


def by_id(result):
    return {c.service_id: c for c in result.candidates}


def test_no_goal_or_life_event_asks_for_a_goal(snapshot):
    r = discover(snapshot, CitizenContext(state="Delhi"))
    assert r.candidates == () and r.clarifications[0].code is DiscoveryQuestion.GOAL_REQUIRED


def test_moving_home_with_known_records(snapshot):
    ctx = CitizenContext(
        goals=("update-address",),
        state="Maharashtra",
        held_document_ids=("aadhaar_number", "driving_licence_existing", "passport_existing"),
        lacking_document_ids=("rc_existing",),
    )
    r = discover(snapshot, ctx)
    c = by_id(r)
    assert set(c) == {
        "aadhaar-address-update",
        "driving-licence-address-change",
        "passport-reissue-change-of-address",
        "vehicle-rc-address-change",
        "voter-id-address-change-form-8",
    }
    assert c["vehicle-rc-address-change"].status is CandidateStatus.EXCLUDED
    assert c["vehicle-rc-address-change"].exclusion is ExclusionCode.LACKS_REQUIRED_RECORD
    # Voter ID enrolment was not mentioned: ask instead of guessing.
    assert c["voter-id-address-change-form-8"].status is CandidateStatus.NEEDS_CLARIFICATION
    q = next(x for x in r.clarifications if x.code is DiscoveryQuestion.RECORD_HELD)
    assert q.document_ids == ("epic_existing",)
    assert set(r.recommended_target_ids) == {
        "aadhaar-address-update",
        "driving-licence-address-change",
        "passport-reissue-change-of-address",
    }


def test_region_specific_service_needs_the_state(snapshot):
    r = discover(snapshot, CitizenContext(goals=("register-marriage",)))
    (c,) = r.candidates
    assert c.status is CandidateStatus.NEEDS_CLARIFICATION and c.region == "Delhi"
    assert r.clarifications[0].code is DiscoveryQuestion.STATE_REQUIRED
    outside = discover(snapshot, CitizenContext(goals=("register-marriage",), state="Kerala"))
    assert outside.candidates[0].exclusion is ExclusionCode.OUTSIDE_VERIFIED_JURISDICTION
    assert outside.recommended_target_ids == ()
    inside = discover(snapshot, CitizenContext(goals=("register-marriage",), state="delhi"))
    assert inside.recommended_target_ids == ("marriage-registration-delhi",)


def test_life_event_alone_gives_broader_candidates(snapshot):
    r = discover(snapshot, CitizenContext(life_events=("marriage-family",), state="Delhi"))
    assert {c.service_id for c in r.candidates} == {
        "aadhaar-name-update",
        "marriage-registration-delhi",
        "passport-reissue-name-change-marriage",
    }


def test_completed_services_are_reported_as_completed(snapshot):
    ctx = CitizenContext(
        goals=("get-pan",), held_document_ids=("aadhaar_number",),
        completed_service_ids=("instant-e-pan",),
    )  # fmt: skip
    (c,) = discover(snapshot, ctx).candidates
    assert c.status is CandidateStatus.COMPLETED
