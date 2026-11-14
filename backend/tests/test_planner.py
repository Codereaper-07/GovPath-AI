"""Deterministic planner rules, tested against small synthetic knowledge snapshots."""

import pytest

from app.workflow.domain import (
    BlockerCode,
    DependencyReason,
    DocumentSpec,
    EvidenceRef,
    Kind,
    KnowledgeSnapshot,
    NextActionType,
    PlanRequest,
    ReasonCode,
    RequirementSpec,
    RequirementState,
    ServiceSpec,
    StepRole,
    StepStatus,
)
from app.workflow.errors import DependencyCycleError, EmptySelectionError, UnknownIdsError
from app.workflow.planner import plan

M, OPT, C = Kind.MANDATORY, Kind.OPTIONAL, Kind.CONDITIONAL


def req(service: str, slug: str, docs: list[str], kind: Kind = M, evidence=()) -> RequirementSpec:
    return RequirementSpec(
        id=f"{service}.{slug}",
        service_id=service,
        name=slug.replace("_", " "),
        kind=kind,
        document_ids=tuple(docs),
        evidence_ids=tuple(evidence),
    )


def kb(*services: ServiceSpec, docs: list[str] | None = None, evidence=()) -> KnowledgeSnapshot:
    all_docs = set(docs or [])
    for s in services:
        all_docs.update(s.outputs)
        for r in s.requirements:
            all_docs.update(r.document_ids)
    return KnowledgeSnapshot(
        services={s.id: s for s in services},
        documents={d: DocumentSpec(d, d.replace("_", " ").title(), "other") for d in all_docs},
        evidence={e.id: e for e in evidence},
    )


def svc(sid: str, reqs=(), outputs=(), prereqs=(), **kw) -> ServiceSpec:
    return ServiceSpec(
        id=sid,
        name=sid.replace("_", " ").title(),
        requirements=tuple(reqs),
        outputs=tuple(outputs),
        prerequisites=tuple(prereqs),
        **kw,
    )


def run(snapshot, targets, owned=(), completed=()):
    return plan(snapshot, PlanRequest(tuple(targets), tuple(owned), tuple(completed)))


def step(result, sid):
    return next(s for s in result.steps if s.service_id == sid)


# ------------------------------------------------------------------ basics


def test_fully_satisfied_service_is_ready_with_no_blockers():
    k = kb(svc("a", [req("a", "id", ["passport"]), req("a", "poa", ["bill", "deed"])]))
    r = run(k, ["a"], owned=["passport", "bill"])
    s = step(r, "a")
    assert s.status is StepStatus.READY and s.role is StepRole.TARGET
    assert r.blockers == () and r.missing_documents == ()
    assert {x.requirement_id for x in r.satisfied_requirements} == {"a.id", "a.poa"}
    assert r.next_action.type is NextActionType.START_SERVICE
    assert r.next_action.service_id == "a"
    assert r.next_action.reason.code is ReasonCode.READY_INDEPENDENT
    assert set(r.next_action.reason.documents_used) == {"passport", "bill"}


def test_missing_mandatory_document_without_route_blocks():
    k = kb(svc("a", [req("a", "existing_licence", ["licence"])]))
    r = run(k, ["a"])
    assert step(r, "a").status is StepStatus.BLOCKED
    [b] = r.blockers
    assert b.code is BlockerCode.MISSING_DOCUMENT_NO_ROUTE
    assert b.requirement_id == "a.existing_licence" and b.document_options == ("licence",)
    [m] = r.missing_documents
    assert m.acquisition_service_id is None
    assert r.next_action.type is NextActionType.OBTAIN_DOCUMENT
    assert r.next_action.reason.code is ReasonCode.RESOLVE_BLOCKER
    assert r.next_action.document_options == ("licence",)


def test_owned_document_satisfies_matching_requirement():
    k = kb(svc("a", [req("a", "x", ["doc_x"])]))
    r = run(k, ["a"], owned=["doc_x"])
    [status] = step(r, "a").requirements
    assert status.state is RequirementState.SATISFIED
    assert status.satisfied_by_document_id == "doc_x"


@pytest.mark.parametrize("held", ["bill", "deed", "passbook"])
def test_any_alternative_in_or_group_satisfies(held):
    k = kb(svc("a", [req("a", "poa", ["bill", "deed", "passbook"])]))
    r = run(k, ["a"], owned=[held])
    [status] = step(r, "a").requirements
    assert status.is_alternative_group
    assert status.state is RequirementState.SATISFIED
    assert status.satisfied_by_document_id == held
    assert step(r, "a").status is StepStatus.READY


def test_first_listed_owned_alternative_is_reported_deterministically():
    k = kb(svc("a", [req("a", "poa", ["bill", "deed"])]))
    r1 = run(k, ["a"], owned=["deed", "bill"])
    r2 = run(k, ["a"], owned=["bill", "deed"])
    assert r1 == r2
    assert step(r1, "a").requirements[0].satisfied_by_document_id == "bill"


@pytest.mark.parametrize("kind", [OPT, C])
def test_optional_and_conditional_requirements_never_block(kind):
    k = kb(svc("a", [req("a", "id", ["passport"]), req("a", "extra", ["noc"], kind=kind)]))
    r = run(k, ["a"], owned=["passport"])
    assert step(r, "a").status is StepStatus.READY
    assert r.blockers == ()
    [opt] = r.optional_documents
    assert opt.state is RequirementState.NOT_PROVIDED and opt.kind is kind
    assert all(x.kind is M for x in r.required_documents)
    assert r.next_action.service_id == "a"


def test_optional_document_with_producer_does_not_create_a_step():
    producer = svc("p", outputs=["noc"])
    a = svc("a", [req("a", "extra", ["noc"], kind=OPT)])
    r = run(kb(producer, a), ["a"])
    assert [s.service_id for s in r.steps] == ["a"]
    assert r.acquisition_routes == ()


# ------------------------------------------------------------------ graph shape


def test_independent_services_stay_independent_and_parallel():
    k = kb(svc("a", [req("a", "x", ["d1"])]), svc("b", [req("b", "y", ["d2"])]))
    r = run(k, ["b", "a"], owned=["d1", "d2"])
    assert r.parallel_groups == (("a", "b"),)
    assert all(s.depends_on == () and s.status is StepStatus.READY for s in r.steps)
    assert r.next_action.service_id == "a"  # tie broken by id
    assert r.next_action.reason.parallel_with == ("b",)
    assert r.selected_service_ids == ("b", "a")


def test_verified_prerequisite_orders_steps():
    ev = EvidenceRef("ev-pre", "https://example.gov.in/rule", "Rule", "B must precede A")
    a = svc("a", prereqs=["b"], prerequisite_evidence={"b": ("ev-pre",)})
    b = svc("b")
    r = run(kb(a, b, evidence=[ev]), ["a"])
    assert [s.service_id for s in r.steps] == ["b", "a"]
    assert step(r, "b").role is StepRole.PREREQUISITE and step(r, "b").status is StepStatus.READY
    assert step(r, "a").status is StepStatus.WAITING
    [dep] = step(r, "a").depends_on
    assert dep.reason is DependencyReason.PREREQUISITE and dep.evidence_ids == ("ev-pre",)
    assert r.prerequisite_services[0].service_id == "a"
    assert r.next_action.service_id == "b"
    assert r.next_action.reason.code is ReasonCode.UNBLOCKS_DOWNSTREAM
    assert r.next_action.reason.unblocks == ("a",)
    assert ev in r.evidence


def test_transitive_prerequisites_are_included():
    r = run(kb(svc("a", prereqs=["b"]), svc("b", prereqs=["c"]), svc("c")), ["a"])
    assert r.parallel_groups == (("c",), ("b",), ("a",))
    assert r.next_action.reason.unblocks == ("a", "b")


def test_completed_prerequisite_creates_no_edge():
    r = run(kb(svc("a", prereqs=["b"]), svc("b")), ["a"], completed=["b"])
    assert [s.service_id for s in r.steps] == ["a"]
    assert step(r, "a").status is StepStatus.READY


def test_unrelated_services_do_not_gain_dependencies():
    # 'b' produces a document 'a' accepts, but 'a' is already satisfied: no edge is invented.
    a = svc("a", [req("a", "poa", ["bill", "b_card"])])
    b = svc("b", outputs=["b_card"])
    r = run(kb(a, b), ["a", "b"], owned=["bill"])
    assert all(s.depends_on == () for s in r.steps)
    assert r.parallel_groups == (("a", "b"),)


# ------------------------------------------------------------------ acquisition routes


def test_missing_document_with_known_route_adds_acquisition_step():
    ev = EvidenceRef("ev-out", "https://example.gov.in/p", "P", "issues X")
    producer = svc(
        "p", [req("p", "id", ["passport"])], outputs=["x"], output_evidence={"x": ("ev-out",)}
    )
    a = svc("a", [req("a", "needs_x", ["x"])])
    r = run(kb(producer, a, evidence=[ev]), ["a"], owned=["passport"])
    assert [s.service_id for s in r.steps] == ["p", "a"]
    assert step(r, "p").role is StepRole.ACQUISITION
    assert step(r, "a").status is StepStatus.WAITING
    [route] = r.acquisition_routes
    assert (route.service_id, route.document_id, route.for_service_id) == ("p", "x", "a")
    assert route.evidence_ids == ("ev-out",)
    [m] = r.missing_documents
    assert m.acquisition_service_id == "p"
    status = step(r, "a").requirements[0]
    assert status.state is RequirementState.PENDING_ACQUISITION
    assert status.acquired_via_service_id == "p"
    assert r.blockers == ()
    assert r.next_action.service_id == "p"
    assert r.next_action.reason.code is ReasonCode.UNBLOCKS_DOWNSTREAM


def test_acquisition_prefers_service_already_selected():
    a = svc("a", [req("a", "poa", ["x_card", "y_card"])])
    x = svc("x", outputs=["x_card"])
    y = svc("y", outputs=["y_card"])
    r = run(kb(a, x, y), ["a", "y"])
    [route] = r.acquisition_routes
    assert route.service_id == "y"  # 'x' would add an extra step
    assert {s.service_id for s in r.steps} == {"a", "y"}


def test_acquisition_prefers_producer_closest_to_ready():
    a = svc("a", [req("a", "poa", ["x_card", "y_card"])])
    x = svc("x", [req("x", "need", ["rare"])], outputs=["x_card"])
    y = svc("y", outputs=["y_card"])
    r = run(kb(a, x, y), ["a"])
    assert r.acquisition_routes[0].service_id == "y"


def test_route_that_would_create_cycle_is_rejected_and_reported_as_blocker():
    # Each service accepts the other's output; holding neither, both are genuinely blocked.
    a = svc("a", [req("a", "poa", ["b_card"])], outputs=["a_card"])
    b = svc("b", [req("b", "poa", ["a_card"])], outputs=["b_card"])
    r = run(kb(a, b), ["a", "b"])
    codes = sorted(b.code for b in r.blockers)
    assert BlockerCode.MISSING_DOCUMENT_NO_ROUTE in codes
    assert all(s.status is StepStatus.BLOCKED for s in r.steps)
    assert r.next_action.type is NextActionType.OBTAIN_DOCUMENT


def test_mutual_acceptance_resolves_when_one_side_is_satisfied():
    a = svc("a", [req("a", "poa", ["bill", "b_card"])], outputs=["a_card"])
    b = svc("b", [req("b", "poa", ["a_card"])], outputs=["b_card"])
    r = run(kb(a, b), ["a", "b"], owned=["bill"])
    assert r.parallel_groups == (("a",), ("b",))
    assert r.blockers == ()
    assert r.next_action.service_id == "a"


def test_blocked_acquisition_step_propagates_dependency_blocker():
    producer = svc("p", [req("p", "existing", ["old_record"])], outputs=["x"])
    a = svc("a", [req("a", "needs_x", ["x"])])
    r = run(kb(producer, a), ["a"])
    assert step(r, "p").status is StepStatus.BLOCKED
    assert step(r, "a").status is StepStatus.BLOCKED
    dep_blockers = [b for b in r.blockers if b.code is BlockerCode.DEPENDENCY_BLOCKED]
    assert dep_blockers[0].service_id == "a" and dep_blockers[0].blocked_by_service_ids == ("p",)
    # The root cause is the producer's missing record; resolving it also frees 'a'.
    assert r.next_action.type is NextActionType.OBTAIN_DOCUMENT
    assert r.next_action.service_id == "p"
    assert r.next_action.reason.unblocks == ("a",)


# ------------------------------------------------------------------ errors


def test_cycle_in_verified_prerequisites_is_detected():
    k = kb(svc("a", prereqs=["b"]), svc("b", prereqs=["a"]))
    with pytest.raises(DependencyCycleError) as exc:
        run(k, ["a"])
    assert set(exc.value.cycle) >= {"a", "b"}


def test_unknown_ids_are_reported_together():
    k = kb(svc("a", [req("a", "x", ["d"])]))
    with pytest.raises(UnknownIdsError) as exc:
        run(k, ["a", "nope"], owned=["d", "ghost"], completed=["zzz"])
    assert exc.value.unknown_service_ids == ["nope", "zzz"]
    assert exc.value.unknown_document_ids == ["ghost"]


@pytest.mark.parametrize("targets", [[], ["", "  "]])
def test_empty_selection_is_rejected(targets):
    with pytest.raises(EmptySelectionError):
        run(kb(svc("a")), targets)


# ------------------------------------------------------------------ next action


def test_next_action_prefers_step_that_unblocks_most_work():
    shared = svc("shared", outputs=["s_card"])
    lone = svc("lone")
    a = svc("a", [req("a", "poa", ["s_card"])])
    b = svc("b", [req("b", "poa", ["s_card"])])
    r = run(kb(shared, lone, a, b), ["lone", "a", "b"])
    assert r.next_action.service_id == "shared"
    assert r.next_action.reason.unblocks == ("a", "b")
    assert "lone" in r.next_action.reason.parallel_with


def test_optional_gaps_do_not_delay_mandatory_progress():
    a = svc("a", [req("a", "id", ["passport"]), req("a", "nice", ["photo"], kind=OPT)])
    b = svc("b", [req("b", "id", ["licence"])])
    r = run(kb(a, b), ["a", "b"], owned=["passport"])
    assert step(r, "a").status is StepStatus.READY
    assert r.next_action.service_id == "a"


def test_all_completed_targets_yield_no_steps():
    r = run(kb(svc("a")), ["a"], completed=["a"])
    assert r.steps == ()
    assert r.next_action.type is NextActionType.NONE
    assert r.next_action.reason.code is ReasonCode.ALL_COMPLETE


# ------------------------------------------------------------------ replanning


def test_replanning_after_obtaining_missing_document_unblocks():
    k = kb(svc("a", [req("a", "poa", ["bill", "deed"])]))
    before = run(k, ["a"])
    assert step(before, "a").status is StepStatus.BLOCKED
    after = run(k, ["a"], owned=["deed"])
    assert step(after, "a").status is StepStatus.READY and after.blockers == ()


def test_replanning_after_completing_acquisition_step():
    producer = svc("p", outputs=["x"])
    a = svc("a", [req("a", "needs_x", ["x"])])
    k = kb(producer, a)
    before = run(k, ["a"])
    assert [s.service_id for s in before.steps] == ["p", "a"]
    after = run(k, ["a"], completed=["p"])
    assert [s.service_id for s in after.steps] == ["a"]
    assert step(after, "a").status is StepStatus.READY
    assert step(after, "a").requirements[0].satisfied_by_document_id == "x"


def test_replanning_when_selected_services_change():
    k = kb(svc("a"), svc("b"))
    assert [s.service_id for s in run(k, ["a"]).steps] == ["a"]
    assert [s.service_id for s in run(k, ["a", "b"]).steps] == ["a", "b"]


def test_plan_is_deterministic():
    a = svc("a", [req("a", "poa", ["x_card", "y_card"])])
    k = kb(a, svc("x", outputs=["x_card"]), svc("y", outputs=["y_card"]))
    assert run(k, ["a"]) == run(k, ["a"])


def test_evidence_is_collected_from_requirements():
    ev = EvidenceRef("ev-1", "https://example.gov.in", "T", "quote")
    k = kb(svc("a", [req("a", "x", ["d"], evidence=["ev-1"])]), evidence=[ev])
    r = run(k, ["a"], owned=["d"])
    assert r.evidence == (ev,)
    assert step(r, "a").evidence_ids == ("ev-1",)
