"""Deterministic workflow planner.

Given verified knowledge (a KnowledgeSnapshot), the services a citizen wants, the documents they
hold and how far they have got with each process, produce an ordered, explainable plan. No AI,
no I/O: the same input always yields the same output.

Three separate concepts
- Document readiness: which documents the citizen holds and can use. Only documents marked
  available satisfy a requirement; expired/invalid/unsure ones are reported but never count.
- Process progress: not started / started / submitted / completed, as reported by the citizen.
  Holding documents never completes a process. A completed process (always user-reported: there
  is no departmental integration) makes its verified output documents available.
- Workflow: the services involved, the edges between them, stages, blockers and next action.

Edges come from exactly two places
1. verified prerequisites (ServiceSpec.prerequisites, each with evidence), and
2. acquisition routes (workflow repair): a missing mandatory document that another known service
   issues. The producer becomes a step that must finish first. Producers whose verified coverage
   excludes the citizen's state are never used; routes that would create a cycle are skipped; if
   no route remains the requirement is a blocker. Nothing else ever creates an edge.
"""

from collections.abc import Iterable

from app.workflow.domain import (
    AcquisitionRoute,
    Blocker,
    BlockerCode,
    Clarification,
    ClarificationCode,
    CompletedService,
    CompletionSource,
    Dependency,
    DependencyReason,
    DocumentState,
    DocumentSummary,
    Kind,
    KnowledgeSnapshot,
    MissingDocument,
    NextAction,
    NextActionType,
    Notice,
    NoticeCode,
    PlanRequest,
    PlanResult,
    PlanStep,
    ProcessState,
    ProgressSummary,
    Reason,
    ReasonCode,
    RequirementSpec,
    RequirementState,
    RequirementStatus,
    StepRole,
    StepStatus,
    UnusableDocument,
)
from app.workflow.errors import EmptySelectionError, UnknownIdsError
from app.workflow.graph import dependents_closure, reaches, topological_stages

_ROLE_RANK = {StepRole.PREREQUISITE: 0, StepRole.ACQUISITION: 1, StepRole.TARGET: 2}
_ACTIVE = (ProcessState.STARTED, ProcessState.SUBMITTED)


def _dedupe(ids: Iterable[str]) -> list[str]:
    seen: dict[str, None] = {}
    for i in ids:
        seen.setdefault(i.strip(), None)
    return [i for i in seen if i]


def validate_request(snapshot: KnowledgeSnapshot, request: PlanRequest) -> None:
    targets = _dedupe(request.target_service_ids)
    if not targets:
        raise EmptySelectionError()
    referenced = [*targets, *request.completed_service_ids, *request.progress]
    unknown_services = [s for s in referenced if s not in snapshot.services]
    docs = [*request.owned_document_ids, *request.document_states]
    unknown_docs = [d for d in docs if d not in snapshot.documents]
    if unknown_services or unknown_docs:
        raise UnknownIdsError(unknown_services, unknown_docs)


class _Planner:
    def __init__(self, snapshot: KnowledgeSnapshot, request: PlanRequest):
        self.kb = snapshot
        self.state = (request.citizen_state or "").strip() or None
        self.targets = _dedupe(request.target_service_ids)
        self.completed = set(_dedupe(request.completed_service_ids)) | {
            s for s, p in request.progress.items() if p is ProcessState.COMPLETED
        }
        self.active = {
            s for s, p in request.progress.items() if p in _ACTIVE and s not in self.completed
        }
        self.progress = {
            s: request.progress.get(s, ProcessState.NOT_STARTED) for s in self.kb.services
        }
        for s in self.completed:
            self.progress[s] = ProcessState.COMPLETED

        # Document readiness. Only AVAILABLE documents are usable.
        self.unusable = {
            d: st for d, st in request.document_states.items() if st is not DocumentState.AVAILABLE
        }
        owned = set(_dedupe(request.owned_document_ids)) | {
            d for d, st in request.document_states.items() if st is DocumentState.AVAILABLE
        }
        self.owned = owned - set(self.unusable)
        # A (user-reported) completed process makes its verified outputs available, unless the
        # citizen marked that document expired/invalid/unsure: their assessment always wins.
        self.from_completion: dict[str, str] = {}
        for sid in sorted(self.completed):
            for doc in self.kb.services[sid].outputs:
                if doc in self.unusable:
                    continue
                if doc not in self.owned:
                    self.from_completion.setdefault(doc, sid)
                self.owned.add(doc)

        self.roles: dict[str, StepRole] = {}
        self.deps: dict[str, dict[str, Dependency]] = {}
        self.req_status: dict[str, RequirementStatus] = {}
        self.routes: list[AcquisitionRoute] = []
        self.prereq_links: list[Dependency] = []
        self.out_of_region: dict[str, tuple[str, ...]] = {}  # requirement id -> producers
        self.clarify: dict[str, Clarification] = {}

    # ------------------------------------------------------------ build graph

    def _include(self, sid: str, role: StepRole) -> bool:
        if sid in self.roles:
            current = self.roles[sid]
            if current is not StepRole.TARGET and _ROLE_RANK[role] < _ROLE_RANK[current]:
                self.roles[sid] = role
            return False
        self.roles[sid] = role
        self.deps[sid] = {}
        spec = self.kb.services[sid]
        if spec.available_in(self.state) is None:
            self.clarify[sid] = Clarification(ClarificationCode.STATE_REQUIRED, sid, spec.region)
        return True

    def _add_edge(self, sid: str, dep: Dependency) -> bool:
        if dep.service_id in self.deps[sid]:
            return False
        self.deps[sid][dep.service_id] = dep
        return True

    def _include_tree(self, sid: str, role: StepRole) -> list[str]:
        """Include a service plus its verified prerequisite closure; return new service ids."""
        if not self._include(sid, role):
            return []
        new = [sid]
        spec = self.kb.services[sid]
        for pre in sorted(spec.prerequisites):
            if pre in self.completed:
                continue
            evidence = tuple(spec.prerequisite_evidence.get(pre, ()))
            dep = Dependency(pre, DependencyReason.PREREQUISITE, evidence_ids=evidence)
            if self._add_edge(sid, dep):
                self.prereq_links.append(
                    Dependency(sid, DependencyReason.PREREQUISITE, evidence_ids=evidence)
                )
            new += self._include_tree(pre, StepRole.PREREQUISITE)
        return new

    def build(self) -> None:
        worklist: list[str] = []
        for t in self.targets:
            if t not in self.completed:
                worklist += self._include_tree(t, StepRole.TARGET)
        # Resolve requirements; acquisition steps may add more services (processed in turn).
        i = 0
        while i < len(worklist):
            sid = worklist[i]
            i += 1
            for req in self.kb.services[sid].requirements:
                worklist += self._resolve(sid, req)

    def _unmet_mandatory(self, sid: str) -> int:
        return sum(
            1
            for r in self.kb.services[sid].requirements
            if r.blocks_progress and not any(d in self.owned for d in r.document_ids)
        )

    def _resolve(self, sid: str, req: RequirementSpec) -> list[str]:
        """Set the requirement's status; return newly included service ids, if any."""
        owned = next((d for d in req.document_ids if d in self.owned), None)
        base = dict(
            requirement_id=req.id,
            service_id=sid,
            name=req.name,
            kind=req.kind,
            document_options=req.document_ids,
            is_alternative_group=req.is_alternative_group,
            condition=req.condition,
            notes=req.notes,
            evidence_ids=req.evidence_ids,
            unusable_document_ids=tuple(d for d in req.document_ids if d in self.unusable),
        )
        if owned is not None:
            self.req_status[req.id] = RequirementStatus(
                state=RequirementState.SATISFIED, satisfied_by_document_id=owned, **base
            )
            return []
        if not req.blocks_progress:
            self.req_status[req.id] = RequirementStatus(state=RequirementState.NOT_PROVIDED, **base)
            return []

        candidates: list[tuple[tuple, str, str]] = []
        outside: set[str] = set()
        cycle_view = self._cycle_view()
        for doc in req.document_ids:
            for producer in self.kb.producers_of(doc):
                if producer == sid or producer in self.completed:
                    continue
                if self.kb.services[producer].available_in(self.state) is False:
                    outside.add(producer)
                    continue
                # Adding edge sid -> producer must not create a cycle.
                if reaches(producer, sid, cycle_view):
                    continue
                # Prefer services already in the plan, then those closest to being ready.
                in_plan = 0 if producer in self.roles else 1
                rank = (in_plan, self._unmet_mandatory(producer), producer)
                candidates.append((rank, producer, doc))
        if not candidates:
            if outside:
                self.out_of_region[req.id] = tuple(sorted(outside))
            self.req_status[req.id] = RequirementStatus(state=RequirementState.MISSING, **base)
            return []

        _, producer, doc = min(candidates)
        evidence = tuple(self.kb.services[producer].output_evidence.get(doc, ()))
        self._add_edge(
            sid,
            Dependency(
                service_id=producer,
                reason=DependencyReason.ACQUISITION,
                document_id=doc,
                requirement_id=req.id,
                evidence_ids=evidence,
                acceptance_evidence_ids=req.evidence_ids,
            ),
        )
        self.routes.append(AcquisitionRoute(producer, doc, sid, req.id, evidence, req.evidence_ids))
        self.req_status[req.id] = RequirementStatus(
            state=RequirementState.PENDING_ACQUISITION,
            acquired_via_service_id=producer,
            acquired_document_id=doc,
            **base,
        )
        return self._include_tree(producer, StepRole.ACQUISITION)

    def _dep_view(self) -> dict[str, list[str]]:
        return {s: list(d) for s, d in self.deps.items()}

    def _cycle_view(self) -> dict[str, set[str]]:
        """Current edges plus the verified prerequisites any service would bring along."""
        view = {
            sid: set(spec.prerequisites) - self.completed for sid, spec in self.kb.services.items()
        }
        for sid, ds in self.deps.items():
            view[sid].update(ds)
        return view

    # ------------------------------------------------------------ assemble

    def result(self) -> PlanResult:
        dep_view = self._dep_view()
        stages = topological_stages(self.roles, dep_view)
        order = [sid for stage in stages for sid in stage]
        stage_of = {sid: n for n, stage in enumerate(stages, start=1) for sid in stage}
        direct_dependents = {
            sid: tuple(sorted(s for s, ds in dep_view.items() if sid in ds)) for sid in order
        }

        blockers: list[Blocker] = []
        notices: list[Notice] = []
        status: dict[str, StepStatus] = {}
        for sid in order:  # topological order: dependencies are decided first
            spec = self.kb.services[sid]
            missing = [
                self.req_status[r.id]
                for r in spec.requirements
                if self.req_status[r.id].state is RequirementState.MISSING
            ]
            blocked_deps = sorted(d for d in dep_view[sid] if status[d] is StepStatus.BLOCKED)
            for m in missing:
                blockers.append(self._missing_blocker(spec.name, sid, m))
            if blocked_deps:
                blockers.append(
                    Blocker(
                        code=BlockerCode.DEPENDENCY_BLOCKED,
                        service_id=sid,
                        blocked_by_service_ids=tuple(blocked_deps),
                        message=(
                            f"'{spec.name}' cannot proceed until blocked step(s) are resolved: "
                            f"{self._names(blocked_deps)}."
                        ),
                    )
                )
            if sid in self.active:
                status[sid] = StepStatus.IN_PROGRESS
                if dep_view[sid]:
                    notices.append(
                        Notice(
                            code=NoticeCode.STARTED_BEFORE_DEPENDENCIES,
                            service_id=sid,
                            related_service_ids=tuple(sorted(dep_view[sid])),
                            message=(
                                f"'{spec.name}' was reported as started, but the plan expects "
                                f"{self._names(sorted(dep_view[sid]))} to finish first."
                            ),
                        )
                    )
            elif missing or blocked_deps:
                status[sid] = StepStatus.BLOCKED
            elif dep_view[sid]:
                status[sid] = StepStatus.WAITING
            else:
                status[sid] = StepStatus.READY
        for t in self.targets:
            if self.kb.services[t].available_in(self.state) is False:
                region = self.kb.services[t].region
                notices.append(
                    Notice(
                        code=NoticeCode.TARGET_OUTSIDE_JURISDICTION,
                        service_id=t,
                        message=(
                            f"'{self.kb.services[t].name}' is verified only for {region}, "
                            f"not {self.state}."
                        ),
                    )
                )
        for sid in sorted(self.active - set(order)):
            notices.append(
                Notice(
                    code=NoticeCode.PROGRESS_OUTSIDE_PLAN,
                    service_id=sid,
                    message=(
                        f"You reported '{self.kb.services[sid].name}' as "
                        f"{self.progress[sid].value}, but it is not part of this plan."
                    ),
                )
            )

        steps = []
        for n, sid in enumerate(order, start=1):
            spec = self.kb.services[sid]
            reqs = tuple(self.req_status[r.id] for r in spec.requirements)
            evidence = set(spec.evidence_ids)
            for r in reqs:
                evidence.update(r.evidence_ids)
            for d in self.deps[sid].values():
                evidence.update(d.evidence_ids)
            completion_ev = sorted(
                {e for d in spec.outputs for e in spec.output_evidence.get(d, ())}
            )
            steps.append(
                PlanStep(
                    step_number=n,
                    stage=stage_of[sid],
                    service_id=sid,
                    service_name=spec.name,
                    role=self.roles[sid],
                    status=status[sid],
                    depends_on=tuple(sorted(self.deps[sid].values(), key=lambda d: d.service_id)),
                    unblocks=direct_dependents[sid],
                    requirements=reqs,
                    evidence_ids=tuple(sorted(evidence | set(completion_ev))),
                    process_state=self.progress[sid],
                    authority=spec.authority,
                    region=spec.region,
                    completion_document_ids=spec.outputs,
                    completion_evidence_ids=tuple(completion_ev),
                )
            )

        all_reqs = [r for s in steps for r in s.requirements]
        mandatory = tuple(r for r in all_reqs if r.kind is Kind.MANDATORY)
        evidence_ids = sorted({e for s in steps for e in s.evidence_ids})
        completed = self._completed_in_scope(all_reqs)

        return PlanResult(
            selected_service_ids=tuple(self.targets),
            completed_service_ids=tuple(sorted(self.completed)),
            steps=tuple(steps),
            parallel_groups=tuple(tuple(s) for s in stages),
            required_documents=mandatory,
            satisfied_requirements=tuple(
                r for r in all_reqs if r.state is RequirementState.SATISFIED
            ),
            missing_documents=tuple(
                MissingDocument(
                    requirement_id=r.requirement_id,
                    service_id=r.service_id,
                    document_options=r.document_options,
                    acquisition_service_id=r.acquired_via_service_id,
                )
                for r in mandatory
                if r.state in (RequirementState.MISSING, RequirementState.PENDING_ACQUISITION)
            ),
            optional_documents=tuple(r for r in all_reqs if r.kind is not Kind.MANDATORY),
            prerequisite_services=tuple(self.prereq_links),
            acquisition_routes=tuple(self.routes),
            blockers=tuple(blockers),
            next_action=self._next_action(steps, blockers, dep_view),
            evidence=tuple(self.kb.evidence[e] for e in evidence_ids if e in self.kb.evidence),
            completed=tuple(
                CompletedService(
                    service_id=sid,
                    source=CompletionSource.USER_REPORTED,
                    output_document_ids=self.kb.services[sid].outputs,
                )
                for sid in completed
            ),
            progress=ProgressSummary(
                total_services=len(steps) + len(completed),
                completed=len(completed),
                completed_user_reported=len(completed),
                completed_verified=0,
                in_progress=sum(1 for s in steps if s.status is StepStatus.IN_PROGRESS),
                ready=sum(1 for s in steps if s.status is StepStatus.READY),
                waiting=sum(1 for s in steps if s.status is StepStatus.WAITING),
                blocked=sum(1 for s in steps if s.status is StepStatus.BLOCKED),
            ),
            document_summary=DocumentSummary(
                mandatory_requirements=len(mandatory),
                satisfied=sum(1 for r in mandatory if r.state is RequirementState.SATISFIED),
                will_be_produced=sum(
                    1 for r in mandatory if r.state is RequirementState.PENDING_ACQUISITION
                ),
                missing=sum(1 for r in mandatory if r.state is RequirementState.MISSING),
                unusable=tuple(UnusableDocument(d, st) for d, st in sorted(self.unusable.items())),
            ),
            notices=tuple(notices),
            clarifications=tuple(self.clarify[s] for s in order if s in self.clarify),
            citizen_state=self.state,
        )

    def _completed_in_scope(self, reqs: list[RequirementStatus]) -> list[str]:
        """Completed services that belong to this plan: completed targets, plus completed
        services whose outputs now satisfy one of the plan's requirements."""
        used = {self.from_completion.get(r.satisfied_by_document_id or "") for r in reqs}
        return sorted(s for s in self.completed if s in self.targets or s in used)

    def _missing_blocker(self, service_name: str, sid: str, m: RequirementStatus) -> Blocker:
        outside = self.out_of_region.get(m.requirement_id, ())
        unusable = [d for d in m.document_options if d in self.unusable]
        message = f"'{service_name}' needs {self._options_text(m.document_options)} for '{m.name}'."
        if unusable:
            message += (
                f" You marked {self._options_text(tuple(unusable))} as "
                f"{', '.join(sorted({self.unusable[d].value for d in unusable}))}."
            )
        if outside:
            regions = sorted({self.kb.services[p].region or "" for p in outside})
            message += (
                f" {self._names(outside)} issues one, but GovPath has verified it only for "
                f"{', '.join(regions)}" + (f", not {self.state}." if self.state else ".")
            )
            code = BlockerCode.ROUTE_OUTSIDE_JURISDICTION
            evidence = tuple(
                e
                for p in outside
                for d in m.document_options
                for e in self.kb.services[p].output_evidence.get(d, ())
            )
        else:
            message += " None is held and no service in the knowledge base issues one."
            code = BlockerCode.MISSING_DOCUMENT_NO_ROUTE
            evidence = ()
        return Blocker(
            code=code,
            service_id=sid,
            requirement_id=m.requirement_id,
            document_options=m.document_options,
            route_service_ids=outside,
            evidence_ids=tuple(dict.fromkeys((*m.evidence_ids, *evidence))),
            message=message,
        )

    def _next_action(
        self, steps: list[PlanStep], blockers: list[Blocker], dep_view: dict[str, list[str]]
    ) -> NextAction:
        if not steps:
            return NextAction(
                type=NextActionType.NONE,
                reason=Reason(
                    code=ReasonCode.ALL_COMPLETE,
                    message=(
                        "You have reported every selected service as completed. "
                        "Nothing left to do in this plan."
                    ),
                ),
            )

        ready = [s for s in steps if s.status is StepStatus.READY]
        if ready:
            downstream = {s.service_id: dependents_closure(s.service_id, dep_view) for s in ready}
            best = min(
                ready,
                key=lambda s: (-len(downstream[s.service_id]), _ROLE_RANK[s.role], s.service_id),
            )
            unblocks = tuple(sorted(downstream[best.service_id]))
            parallel = tuple(s.service_id for s in ready if s.service_id != best.service_id)
            used = tuple(
                r.satisfied_by_document_id
                for r in best.requirements
                if r.kind is Kind.MANDATORY and r.satisfied_by_document_id
            )
            name = best.service_name
            if unblocks:
                code = ReasonCode.UNBLOCKS_DOWNSTREAM
                message = (
                    f"Start '{name}' now: every mandatory requirement is met and completing it "
                    f"unblocks {len(unblocks)} other step(s): {self._names(unblocks)}."
                )
            else:
                code = ReasonCode.READY_INDEPENDENT
                message = (
                    f"Start '{name}' now: every mandatory requirement is met and it does not "
                    "depend on any other step."
                )
            if parallel:
                message += f" It can be done in parallel with: {self._names(parallel)}."
            evidence = tuple(
                dict.fromkeys(
                    e for r in best.requirements if r.kind is Kind.MANDATORY for e in r.evidence_ids
                )
            )
            return NextAction(
                type=NextActionType.START_SERVICE,
                service_id=best.service_id,
                reason=Reason(
                    code=code,
                    message=message,
                    unblocks=unblocks,
                    parallel_with=parallel,
                    documents_used=used,
                    evidence_ids=evidence,
                ),
            )

        # Nothing can be started. A document the citizen must obtain comes first.
        roots = [
            b
            for b in blockers
            if b.code
            in (BlockerCode.MISSING_DOCUMENT_NO_ROUTE, BlockerCode.ROUTE_OUTSIDE_JURISDICTION)
        ]
        order = {s.service_id: s.step_number for s in steps}
        if roots:
            best_b = min(
                roots,
                key=lambda b: (
                    -len(dependents_closure(b.service_id, dep_view)),
                    order[b.service_id],
                ),
            )
            freed = tuple(sorted(dependents_closure(best_b.service_id, dep_view)))
            message = (
                f"Obtain {self._options_text(best_b.document_options)} first. "
                f"'{self.kb.services[best_b.service_id].name}' is blocked without it"
            )
            message += f", and so are: {self._names(freed)}." if freed else "."
            return NextAction(
                type=NextActionType.OBTAIN_DOCUMENT,
                service_id=best_b.service_id,
                requirement_id=best_b.requirement_id,
                document_options=best_b.document_options,
                reason=Reason(
                    code=ReasonCode.RESOLVE_BLOCKER,
                    message=message,
                    unblocks=freed,
                    document_options=best_b.document_options,
                    evidence_ids=best_b.evidence_ids,
                ),
            )

        # Otherwise everything left waits for a process the citizen has already started.
        active = [s for s in steps if s.status is StepStatus.IN_PROGRESS]
        best = min(
            active,
            key=lambda s: (-len(dependents_closure(s.service_id, dep_view)), s.step_number),
        )
        freed = tuple(sorted(dependents_closure(best.service_id, dep_view)))
        outputs = (
            self._options_text(best.completion_document_ids) if best.completion_document_ids else ""
        )
        message = (
            f"'{best.service_name}' is in progress. Follow it up with the authority; when you "
            f"receive {outputs or 'the outcome'}, report it as completed"
        )
        message += f". That unblocks: {self._names(freed)}." if freed else "."
        return NextAction(
            type=NextActionType.FOLLOW_UP,
            service_id=best.service_id,
            reason=Reason(
                code=ReasonCode.AWAIT_IN_PROGRESS,
                message=message,
                unblocks=freed,
                evidence_ids=best.completion_evidence_ids,
            ),
        )

    # ------------------------------------------------------------ text helpers

    def _names(self, sids: Iterable[str]) -> str:
        return ", ".join(f"'{self.kb.services[s].name}'" for s in sids)

    def _options_text(self, doc_ids: tuple[str, ...]) -> str:
        names = [self.kb.documents[d].name for d in doc_ids]
        if len(names) == 1:
            return names[0]
        return "one of: " + "; ".join(names)


def plan(snapshot: KnowledgeSnapshot, request: PlanRequest) -> PlanResult:
    """Validate the request and return a deterministic plan.

    Raises UnknownIdsError, EmptySelectionError, or DependencyCycleError.
    """
    validate_request(snapshot, request)
    planner = _Planner(snapshot, request)
    planner.build()
    return planner.result()
