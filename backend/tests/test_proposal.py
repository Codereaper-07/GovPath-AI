# ruff: noqa: F811  (the `snapshot` fixture is imported from test_workflow_engine)
"""Situation -> proposed workflow (discovery + the existing planner) on the curated dataset.

No AI is involved here: the context is what the citizen reviewed (typed, or extracted by the
situation interpreter and confirmed). Services come only from the knowledge base.
"""

import pytest

from app.workflow.discovery import CitizenContext, DiscoveryQuestion
from app.workflow.domain import (
    BlockerCode,
    ClarificationCode,
    DocumentState,
    PlanRequest,
    RequirementState,
    StepRole,
    StepStatus,
)
from app.workflow.errors import UnknownIdsError
from app.workflow.planner import plan
from app.workflow.proposal import ProposalStatus, propose
from tests.test_planner import kb
from tests.test_workflow_engine import (  # noqa: F401  (fixture)
    AADHAAR,
    AADHAAR_NAME,
    DL,
    MARRIAGE,
    PAN,
    PASSPORT,
    PASSPORT_NAME,
    snapshot,
)

# "I'm recently married in Delhi. I want to update my Aadhaar and passport surname. I don't have
# my marriage certificate yet." -> reviewed structured context.
MARRIED_DELHI = CitizenContext(
    goals=("update-name-after-marriage",),
    life_events=("marriage-family",),
    state="Delhi",
    held_document_ids=("aadhaar_number", "passport_existing"),
    lacking_document_ids=("marriage_certificate",),
)


def ctx(**kw) -> CitizenContext:
    return CitizenContext(**{**MARRIED_DELHI.__dict__, **kw})


def step(result, sid):
    return next(s for s in result.plan.steps if s.service_id == sid)


def test_situation_identifies_multiple_outcomes_without_manual_selection(snapshot):
    p = propose(snapshot, MARRIED_DELHI)
    assert p.status is ProposalStatus.READY
    assert set(p.target_ids) == {AADHAAR_NAME, PASSPORT_NAME}
    assert {s.service_id for s in p.plan.steps if s.role is StepRole.TARGET} == set(p.target_ids)


def test_prerequisite_service_is_added_by_the_planner_with_its_reason(snapshot):
    p = propose(snapshot, MARRIED_DELHI)
    [support] = p.supporting
    assert support.service_id == MARRIAGE and support.role is StepRole.ACQUISITION
    assert support.document_ids == ("marriage_certificate",)
    assert set(support.for_service_ids) == {AADHAAR_NAME, PASSPORT_NAME}
    # Marriage registration is not an intended outcome (no "register-marriage" goal)
    assert MARRIAGE not in p.target_ids
    # ...and the planner orders it first, with both name updates waiting for it.
    assert step(p, MARRIAGE).stage < step(p, AADHAAR_NAME).stage == step(p, PASSPORT_NAME).stage
    assert [d.service_id for d in step(p, AADHAAR_NAME).depends_on] == [MARRIAGE]


def test_the_existing_planner_alone_decides_the_workflow(snapshot):
    p = propose(snapshot, MARRIED_DELHI)
    direct = plan(
        snapshot,
        PlanRequest(
            p.target_ids,
            MARRIED_DELHI.held_document_ids,
            (),
            citizen_state="Delhi",
        ),
    )
    assert p.plan == direct


def test_alternative_document_paths_stay_correct(snapshot):
    p = propose(snapshot, MARRIED_DELHI)
    proof = next(
        r
        for r in step(p, PASSPORT_NAME).requirements
        if "joint_photo_declaration" in r.document_options
    )
    assert proof.state is RequirementState.PENDING_ACQUISITION  # routed, alternative still listed
    assert proof.acquired_document_id == "marriage_certificate"
    # With the passport's accepted alternative (Annexure J), only Aadhaar waits for the
    # marriage certificate: Aadhaar accepts no such alternative.
    alt = propose(
        snapshot,
        ctx(held_document_ids=(*MARRIED_DELHI.held_document_ids, "joint_photo_declaration")),
    )
    assert step(alt, PASSPORT_NAME).depends_on == ()
    assert [d.service_id for d in step(alt, AADHAAR_NAME).depends_on] == [MARRIAGE]
    assert step(alt, PASSPORT_NAME).status is StepStatus.READY


def test_jurisdiction_restricts_the_supporting_service(snapshot):
    other = propose(snapshot, ctx(state="Maharashtra"))
    assert MARRIAGE not in [s.service_id for s in other.plan.steps]
    assert {b.code for b in other.plan.blockers} == {BlockerCode.ROUTE_OUTSIDE_JURISDICTION}
    assert other.supporting == ()


def test_unknown_state_asks_instead_of_assuming(snapshot):
    p = propose(snapshot, ctx(state=None))
    assert p.status is ProposalStatus.NEEDS_CLARIFICATION
    assert [c.code for c in p.plan.clarifications] == [ClarificationCode.STATE_REQUIRED]
    # The planner keeps the Delhi-only route provisionally and asks to confirm the state.
    assert p.plan.clarifications[0].service_id == MARRIAGE


def test_unknown_existing_records_trigger_questions_not_guesses(snapshot):
    p = propose(snapshot, ctx(held_document_ids=()))
    assert p.status is ProposalStatus.NEEDS_CLARIFICATION and p.plan is None
    questions = {q.document_ids for q in p.discovery.clarifications}
    assert ("aadhaar_number",) in questions and ("passport_existing",) in questions


def test_no_goal_or_event_asks_for_one(snapshot):
    p = propose(snapshot, CitizenContext(state="Delhi"))
    assert p.status is ProposalStatus.NEEDS_CLARIFICATION and p.plan is None
    assert [q.code for q in p.discovery.clarifications] == [DiscoveryQuestion.GOAL_REQUIRED]


def test_unsupported_situations_produce_no_invented_services(snapshot):
    business = propose(snapshot, CitizenContext(life_events=("starting-business",), state="Delhi"))
    assert business.status is ProposalStatus.NO_SUPPORTED_SERVICES
    assert business.plan is None and business.target_ids == ()
    assert business.uncovered_life_events == ("starting-business",)
    kerala = propose(snapshot, CitizenContext(goals=("register-marriage",), state="Kerala"))
    assert kerala.status is ProposalStatus.NO_SUPPORTED_SERVICES and kerala.plan is None


def test_empty_knowledge_base_fails_safely():
    p = propose(kb(), MARRIED_DELHI)
    assert p.status is ProposalStatus.NO_SUPPORTED_SERVICES and p.plan is None
    assert p.uncovered_goals == ("update-name-after-marriage",)


def test_citizen_can_remove_and_add_services_and_regenerate(snapshot):
    only_aadhaar = propose(snapshot, MARRIED_DELHI, target_ids=(AADHAAR_NAME,))
    assert [s.service_id for s in only_aadhaar.plan.steps] == [MARRIAGE, AADHAAR_NAME]
    plus_pan = propose(snapshot, MARRIED_DELHI, target_ids=(AADHAAR_NAME, PAN))
    assert PAN in plus_pan.target_ids and PAN in [s.service_id for s in plus_pan.plan.steps]
    none = propose(snapshot, MARRIED_DELHI, target_ids=())
    assert none.status is ProposalStatus.NO_SERVICES_SELECTED and none.plan is None
    with pytest.raises(UnknownIdsError):
        propose(snapshot, MARRIED_DELHI, target_ids=("made-up-service",))


def test_parallel_steps_and_blockers_for_an_address_change(snapshot):
    held = ("aadhaar_number", "driving_licence_existing", "passport_existing", "electricity_bill")
    p = propose(
        snapshot, CitizenContext(goals=("update-address",), state="Delhi", held_document_ids=held)
    )
    assert {AADHAAR, DL, PASSPORT} <= set(p.target_ids)
    assert any(len(g) > 1 for g in p.plan.parallel_groups)
    assert [d.service_id for d in step(p, DL).depends_on] == [AADHAAR]
    # Document conditions reach the planner: an expired bill blocks or reroutes the steps.
    expired = propose(
        snapshot,
        CitizenContext(goals=("update-address",), state="Delhi", held_document_ids=held),
        document_states={"electricity_bill": DocumentState.EXPIRED},
    )
    assert expired.plan.document_summary.unusable[0].document_id == "electricity_bill"
