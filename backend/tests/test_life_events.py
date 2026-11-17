"""Multi-life-event expansion: categories, cross-event workflows and coverage gaps (no Gemini)."""

import pytest

from app.knowledge import repository
from app.models.enums import LifeEvent
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

MARRIAGE = "marriage-registration-delhi"
NAME_AADHAAR = "aadhaar-name-update"
NAME_PASSPORT = "passport-reissue-name-change-marriage"
CHILD = "child-aadhaar-enrolment"
EPAN = "instant-e-pan"
MARRIAGE_DOCS = [
    "aadhaar_number",
    "matriculation_certificate",
    "ration_card",
    "marriage_affidavits",
    "marriage_photographs_attested",
]


@pytest.fixture
async def snapshot(seeded_factory):
    async with seeded_factory() as s:
        return await load_snapshot(s)


def run(snapshot, targets, owned=(), completed=()):
    return plan(snapshot, PlanRequest(tuple(targets), tuple(owned), tuple(completed)))


def step(result, sid):
    return next(s for s in result.steps if s.service_id == sid)


async def test_every_service_has_valid_life_events_and_category_coverage(seeded_factory):
    async with seeded_factory() as s:
        services = await repository.list_services(s)
    valid = {e.value for e in LifeEvent}
    counts = {e: 0 for e in valid}
    for svc in services:
        assert svc.life_events and set(svc.life_events) <= valid, svc.slug
        for e in svc.life_events:
            counts[e] += 1
    # 5 address services + Aadhaar name update + 6 identity/vehicle services of the first batch
    assert counts["relocation-identity"] == 12
    assert counts["marriage-family"] == 3
    assert counts["birth-parenthood"] == 1
    assert counts["employment-career"] == 2  # e-PAN + fresh passport
    # Known coverage gap: no machine-readable official source verified yet for business services.
    assert counts["starting-business"] == 0


def test_marriage_certificate_route_orders_name_updates_after_registration(snapshot):
    owned = [*MARRIAGE_DOCS, "passport_existing"]
    r = run(snapshot, [NAME_AADHAAR, NAME_PASSPORT], owned)
    assert (
        step(r, MARRIAGE).role is StepRole.ACQUISITION
        and step(r, MARRIAGE).status is StepStatus.READY
    )
    for sid in (NAME_AADHAAR, NAME_PASSPORT):
        [dep] = step(r, sid).depends_on
        assert dep.service_id == MARRIAGE and dep.reason is DependencyReason.ACQUISITION
        assert dep.document_id == "marriage_certificate" and dep.evidence_ids
    assert r.next_action.service_id == MARRIAGE
    assert set(r.next_action.reason.unblocks) == {NAME_AADHAAR, NAME_PASSPORT}


def test_joint_photo_declaration_is_a_valid_alternative_for_passport(snapshot):
    r = run(snapshot, [NAME_PASSPORT], ["passport_existing", "joint_photo_declaration"])
    assert [s.service_id for s in r.steps] == [NAME_PASSPORT]
    assert step(r, NAME_PASSPORT).status is StepStatus.READY


def test_optional_and_conditional_marriage_documents_never_block(snapshot):
    r = run(snapshot, [MARRIAGE], MARRIAGE_DOCS)
    assert step(r, MARRIAGE).status is StepStatus.READY
    kinds = {
        x.requirement_id.split(".")[1]: x.kind.value
        for x in step(r, MARRIAGE).requirements
        if x.state is RequirementState.NOT_PROVIDED
    }
    assert kinds == {
        "invitation-card": "optional",
        "divorce-or-death-certificate": "conditional",
        "priest-certificate": "conditional",
        "embassy-certificate": "conditional",
    }


def test_aadhaar_is_not_compulsory_for_marriage_registration(snapshot):
    owned = [
        "pan_card",
        "matriculation_certificate",
        "ration_card",
        "marriage_affidavits",
        "marriage_photographs_attested",
    ]
    assert step(run(snapshot, [MARRIAGE], owned), MARRIAGE).status is StepStatus.READY


def test_child_aadhaar_without_birth_certificate_is_an_honest_blocker(snapshot):
    r = run(snapshot, [CHILD], ["parent_aadhaar_numbers", "legal_guardianship_document"])
    [b] = [b for b in r.blockers if b.code is BlockerCode.MISSING_DOCUMENT_NO_ROUTE]
    assert b.document_options == (
        "birth_certificate",
    )  # birth registration is not in the knowledge base
    assert r.next_action.type is NextActionType.OBTAIN_DOCUMENT
    ready = run(snapshot, [CHILD], ["parent_aadhaar_numbers", "birth_certificate"])
    assert step(ready, CHILD).status is StepStatus.READY


def test_e_pan_ready_and_blocked_cases(snapshot):
    owned = [
        "aadhaar_number",
        "mobile_linked_to_aadhaar",
        "digilocker_access",
        "driving_licence_existing",
    ]
    assert step(run(snapshot, [EPAN], owned), EPAN).status is StepStatus.READY
    no_mobile = run(snapshot, [EPAN], [d for d in owned if d != "mobile_linked_to_aadhaar"])
    assert step(no_mobile, EPAN).status is StepStatus.BLOCKED


def test_no_dependencies_invented_between_life_events(snapshot):
    owned = [
        *MARRIAGE_DOCS,
        "passport_existing",
        "joint_photo_declaration",
        "marriage_certificate",
        "parent_aadhaar_numbers",
        "birth_certificate",
        "mobile_linked_to_aadhaar",
        "digilocker_access",
    ]
    r = run(snapshot, [MARRIAGE, NAME_AADHAAR, NAME_PASSPORT, CHILD, EPAN], owned)
    assert all(s.depends_on == () for s in r.steps)
    assert r.prerequisite_services == ()


def test_assistant_relevance_for_new_life_events():
    from app.rag.context import FactLine, ServiceFacts, relevant_services

    facts = [
        ServiceFacts(slug, slug, None, frozenset(), (FactLine(slug, None),))
        for slug in (
            MARRIAGE,
            NAME_AADHAAR,
            NAME_PASSPORT,
            CHILD,
            EPAN,
            "vehicle-rc-address-change",
        )
    ]

    def pick(q):
        return {
            f.slug for f in relevant_services(q, facts, evidence_ids=set(), workflow_service_ids=[])
        }  # noqa: E731

    assert MARRIAGE in pick("How do I register my marriage in Delhi?")
    assert pick("शादी के बाद आधार में नाम कैसे बदलें?") >= {MARRIAGE, NAME_AADHAAR}
    assert EPAN in pick("How do I get a PAN card?")
    assert CHILD in pick("मेरे बच्चे का आधार कैसे बनवाएँ?")
    assert (
        pick("How do I register for GST?") == set()
    )  # uncovered topic: no facts, no invented service
