"""Milestone 3: automatic expiry, account-aware situation planning, dashboard (all offline)."""

import asyncio
import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.account import service as svc
from app.api.routes.situation import get_interpreter
from app.auth import get_token_verifier
from app.config import Settings, get_settings
from app.db import get_session
from app.llm.situation import (
    SituationContext,
    SituationExtraction,
    SituationInterpreter,
    SituationVocabulary,
    build_prompt,
    validate,
)
from app.main import create_app
from app.models import ActivityEvent
from tests.auth_fakes import SUPABASE_URL, bearer, make_token, make_verifier

A = uuid.UUID("aaaaaaaa-3333-4333-8333-333333333333")
B = uuid.UUID("bbbbbbbb-4444-4444-8444-444444444444")
HA, HB = bearer(make_token(A)), bearer(make_token(B))
AADHAAR_NAME = "aadhaar-name-update"
PASSPORT_NAME = "passport-reissue-name-change-marriage"
MARRIAGE_REG = "marriage-registration-delhi"
AADHAAR_ADDR = "aadhaar-address-update"
DL_ADDR = "driving-licence-address-change"
PASSPORT_ADDR = "passport-reissue-change-of-address"
SETTINGS = Settings(
    _env_file=None,
    database_url=None,
    gemini_api_key=None,
    supabase_url=SUPABASE_URL,
    cron_secret="test-cron-secret",
)
TODAY = date(2026, 11, 16)  # the Indian calendar date the tests run "on"


class FakeInterpreter:
    """Stands in for Gemini: returns a canned extraction and records the context it was given."""

    model = "fake-model"

    def __init__(self, raw: SituationExtraction):
        self.raw, self.calls = raw, []

    async def interpret(self, text, vocab, context=None, previous=None):
        self.calls.append({"text": text, "context": context, "previous": previous})
        return validate(self.raw, vocab, context.state if context else None)


@pytest.fixture
def frozen_today(monkeypatch):
    monkeypatch.setattr(svc, "today", lambda now=None: TODAY)
    return TODAY


@pytest.fixture
def app_and_client(seeded_factory, frozen_today):
    application = create_app()

    async def _session():
        async with seeded_factory() as s:
            yield s

    verifier = make_verifier()
    application.dependency_overrides[get_session] = _session
    application.dependency_overrides[get_settings] = lambda: SETTINGS
    application.dependency_overrides[get_token_verifier] = lambda: verifier
    return application, TestClient(application)


@pytest.fixture
def client(app_and_client) -> TestClient:
    return app_and_client[1]


def add_doc(c, doc_type, status="valid", h=HA, **extra):
    r = c.post(
        "/api/me/documents", headers=h, json={"document_type": doc_type, "status": status, **extra}
    )
    assert r.status_code == 201, r.text
    return r.json()["document"]


def new_plan(c, targets, h=HA, **extra):
    r = c.post(
        "/api/me/plans", headers=h, json={"target_service_ids": targets, "state": "Delhi", **extra}
    )
    assert r.status_code == 201, r.text
    return r.json()


def steps(detail):
    snap = detail["plan"]
    out = {s["service_id"]: s["status"] for s in snap["steps"]}
    out.update({sid: "completed" for sid in snap["completed_service_ids"]})
    return out


def plan(c, pid, h=HA):
    return c.get(f"/api/me/plans/{pid}", headers=h).json()


def events(c, h=HA, kind=None):
    evs = c.get("/api/me/activity", headers=h, params={"limit": 100}).json()["events"]
    return [e for e in evs if kind is None or e["event_type"] == kind]


def run_expiry(seeded_factory, on=TODAY):
    async def _run():
        async with seeded_factory() as s:
            return await svc.expire_all(s, None, on)

    return asyncio.run(_run())


# ---------------------------------------------------------------- calendar semantics


@pytest.mark.parametrize(
    ("utc", "ist_date"),
    [
        ("2026-11-15T18:29:59+00:00", date(2026, 11, 15)),  # 23:59:59 IST
        ("2026-11-15T18:30:00+00:00", date(2026, 11, 16)),  # 00:00 IST next day
        ("2026-11-15T00:00:00+00:00", date(2026, 11, 15)),
        ("2026-12-31T19:00:00+00:00", date(2027, 1, 1)),  # new year in India first
    ],
)
def test_today_is_the_indian_calendar_date(utc: str, ist_date: date) -> None:
    assert svc.today(datetime.fromisoformat(utc)) == ist_date


def test_a_document_is_valid_through_its_expiry_date() -> None:
    from app.models import VaultDocument
    from app.models.enums import VaultDocumentStatus as S

    doc = VaultDocument(
        document_type="passport_existing", status=S.VALID, expiry_date=date(2026, 11, 15)
    )
    assert svc.effective_status(doc, date(2026, 11, 15)) == S.VALID
    assert svc.effective_status(doc, date(2026, 11, 16)) == S.EXPIRED
    doc.status = S.UNSURE  # the reported status is never rewritten by expiry
    assert svc.effective_status(doc, date(2026, 11, 16)) == S.UNSURE


# ---------------------------------------------------------------- automatic expiry


def _marriage_setup(c):
    for d in ("aadhaar_number", "passport_existing"):
        add_doc(c, d)
    cert = add_doc(c, "marriage_certificate", expiry_date=TODAY.isoformat())  # valid today
    p1 = new_plan(c, [AADHAAR_NAME])
    p2 = new_plan(c, [PASSPORT_NAME])
    assert steps(p1)[AADHAAR_NAME] == "ready" and steps(p2)[PASSPORT_NAME] == "ready"
    return cert, p1, p2


def test_expiry_recalculates_every_affected_plan_once(client, seeded_factory) -> None:
    cert, p1, p2 = _marriage_setup(client)
    client.put(f"/api/me/progress/{AADHAAR_NAME}", headers=HA, json={"state": "started"})
    before_progress = client.get("/api/me/progress", headers=HA).json()["progress"]

    tomorrow = TODAY + timedelta(days=1)
    first = run_expiry(seeded_factory, tomorrow)
    assert (first.users, first.documents, first.plans_changed) == (1, 1, 2)
    # Idempotent: further runs (and the catch-up on read) log nothing more.
    assert run_expiry(seeded_factory, tomorrow).documents == 0
    assert run_expiry(seeded_factory, tomorrow + timedelta(days=3)).documents == 0

    expired = events(client, kind="document_expired")
    assert len(expired) == 1 and expired[0]["entity_id"] == cert["id"]
    assert expired[0]["details"]["effective_status"] == "expired"
    recalcs = [
        e
        for e in events(client, kind="plan_recalculated")
        if e["details"]["cause"]["type"] == "document_expired"
    ]
    assert sorted(e["entity_id"] for e in recalcs) == sorted([p1["id"], p2["id"]])
    # The reported status is kept; the effective status is what plans use.
    doc = client.get("/api/me/documents", headers=HA).json()["documents"]
    cert_now = next(d for d in doc if d["id"] == cert["id"])
    assert cert_now["status"] == "valid"
    # Progress untouched.
    assert client.get("/api/me/progress", headers=HA).json()["progress"] == before_progress


def test_expired_document_makes_steps_unusable_but_alternatives_still_work(
    client, seeded_factory, monkeypatch
) -> None:
    cert, p1, p2 = _marriage_setup(client)
    add_doc(client, "joint_photo_declaration")  # alternative accepted by the passport only
    tomorrow = TODAY + timedelta(days=1)
    monkeypatch.setattr(svc, "today", lambda now=None: tomorrow)
    run_expiry(seeded_factory, tomorrow)
    assert steps(plan(client, p1["id"]))[AADHAAR_NAME] != "ready"
    assert MARRIAGE_REG in steps(plan(client, p1["id"]))
    assert steps(plan(client, p2["id"]))[PASSPORT_NAME] == "ready"  # OR group satisfied
    docs = client.get("/api/me/documents", headers=HA).json()["documents"]
    cert_now = next(d for d in docs if d["id"] == cert["id"])
    assert cert_now["effective_status"] == "expired" and cert_now["expiry_passed"]
    assert set(cert_now["used_by_plan_ids"]) == {p1["id"], p2["id"]}


def test_reads_catch_up_without_a_scheduler(client, monkeypatch) -> None:
    cert, p1, _ = _marriage_setup(client)
    monkeypatch.setattr(svc, "today", lambda now=None: TODAY + timedelta(days=1))
    detail = plan(client, p1["id"])  # no scheduler ran
    assert steps(detail)[AADHAAR_NAME] != "ready"
    plan(client, p1["id"])
    client.get("/api/me/dashboard", headers=HA)
    assert len(events(client, kind="document_expired")) == 1


def test_new_expiry_date_is_processed_again_and_user_writes_are_not_duplicated(
    client, seeded_factory, monkeypatch
) -> None:
    cert, _, _ = _marriage_setup(client)
    tomorrow = TODAY + timedelta(days=1)
    run_expiry(seeded_factory, tomorrow)
    # Renewed (future date), then that one passes too: a second, separate expiry event.
    client.patch(f"/api/me/documents/{cert['id']}", headers=HA, json={"expiry_date": "2026-12-01"})
    run_expiry(seeded_factory, date(2026, 12, 2))
    assert len(events(client, kind="document_expired")) == 2
    # A document the citizen saves with an already-past expiry date is logged by that write only.
    add_doc(client, "pan_card", expiry_date="2020-01-01")
    run_expiry(seeded_factory, date(2026, 12, 2))
    assert len(events(client, kind="document_expired")) == 2


def test_documents_not_reported_valid_are_not_expiry_events(client, seeded_factory) -> None:
    add_doc(client, "passport_existing", status="unsure", expiry_date=TODAY.isoformat())
    assert run_expiry(seeded_factory, TODAY + timedelta(days=5)).documents == 0


def test_archived_plans_stay_frozen_and_catch_up_on_restore(
    client, seeded_factory, monkeypatch
) -> None:
    cert, p1, _ = _marriage_setup(client)
    client.post(f"/api/me/plans/{p1['id']}/archive", headers=HA)
    tomorrow = TODAY + timedelta(days=1)
    monkeypatch.setattr(svc, "today", lambda now=None: tomorrow)
    run_expiry(seeded_factory, tomorrow)
    assert steps(plan(client, p1["id"]))[AADHAAR_NAME] == "ready"  # frozen snapshot
    assert cert["id"] in {e["entity_id"] for e in events(client, kind="document_expired")}
    assert p1["id"] not in {e["entity_id"] for e in events(client, kind="plan_recalculated")}
    restored = client.post(f"/api/me/plans/{p1['id']}/restore", headers=HA).json()
    assert steps(restored)[AADHAAR_NAME] != "ready"


def test_expiry_is_per_user(client, seeded_factory) -> None:
    _marriage_setup(client)
    add_doc(client, "passport_existing", h=HB, expiry_date=TODAY.isoformat())
    run = run_expiry(seeded_factory, TODAY + timedelta(days=1))
    assert (run.users, run.documents) == (2, 2)
    assert len(events(client, h=HB, kind="document_expired")) == 1
    assert len(events(client, h=HA, kind="document_expired")) == 1


def test_scheduler_endpoint_requires_the_secret(app_and_client, seeded_factory) -> None:
    application, client = app_and_client
    _marriage_setup(client)
    assert client.post("/api/internal/expire-documents").status_code == 401
    r = client.post("/api/internal/expire-documents", headers={"X-Cron-Secret": "wrong"})
    assert r.status_code == 401
    r = client.post("/api/internal/expire-documents", headers={"X-Cron-Secret": "test-cron-secret"})
    assert r.status_code == 200 and r.json()["documents"] == 0  # nothing due "today"
    no_secret = Settings(_env_file=None, database_url=None, gemini_api_key=None)
    application.dependency_overrides[get_settings] = lambda: no_secret
    r = client.post("/api/internal/expire-documents", headers={"X-Cron-Secret": "x"})
    assert r.status_code == 404  # disabled unless CRON_SECRET is configured


async def test_concurrent_runs_log_each_expiry_once(seeded_factory, monkeypatch) -> None:
    """Two runs that both read the document as due (a race): only the conditional claim lets
    one of them log it."""
    from app.models import VaultDocument
    from app.models.enums import VaultDocumentStatus as S

    async with seeded_factory() as s:
        s.add(VaultDocument(user_id=A, document_type="pan_card", status=S.VALID, expiry_date=TODAY))
        await s.commit()
    tomorrow = TODAY + timedelta(days=1)
    async with seeded_factory() as s1:
        n1, _ = await svc.expire_for_user(s1, A, None, tomorrow)
        await s1.commit()
    # The second run's read is stale: it still sees the document as due.
    stale = select(VaultDocument).where(VaultDocument.status == S.VALID)
    monkeypatch.setattr(svc, "_due", lambda on: stale)
    async with seeded_factory() as s2:
        n2, _ = await svc.expire_for_user(s2, A, None, tomorrow)
        await s2.commit()
    async with seeded_factory() as s:
        count = (
            await s.execute(
                select(func.count())
                .select_from(ActivityEvent)
                .where(ActivityEvent.event_type == "document_expired")
            )
        ).scalar()
    assert (n1, n2, count) == (1, 0, 1)


# ---------------------------------------------------------------- situation understanding

VOCAB = SituationVocabulary(
    goals={"update-address": "update address", "get-pan": "pan"},
    life_events={"relocation-identity": "moving"},
    documents={"rent_or_lease_agreement": "Rent agreement", "aadhaar_number": "Aadhaar"},
    services={AADHAAR_ADDR: "Aadhaar address", DL_ADDR: "DL address", PASSPORT_ADDR: "Passport"},
)


def test_extraction_keeps_requested_services_and_origin_state() -> None:
    raw = SituationExtraction(
        goals=["update-address"],
        state="Karnataka",
        origin_state="Uttar Pradesh",
        requested_service_ids=[AADHAAR_ADDR, DL_ADDR, "made-up-service"],
        held_document_ids=["rent_or_lease_agreement"],
    )
    out = validate(raw, VOCAB)
    assert out.requested_service_ids == (AADHAAR_ADDR, DL_ADDR)
    assert "made-up-service" in out.dropped
    assert (out.state, out.origin_state) == ("Karnataka", "Uttar Pradesh")


def test_known_state_is_not_asked_and_named_services_answer_the_goal() -> None:
    out = validate(SituationExtraction(requested_service_ids=[DL_ADDR]), VOCAB, known_state="Delhi")
    assert out.unknowns == ()
    assert "state" in validate(SituationExtraction(goals=["get-pan"]), VOCAB).unknowns


def test_prompt_carries_account_context_and_corrections_safely() -> None:
    ctx = SituationContext(
        state="Uttar Pradesh",
        city="Noida",
        documents={"aadhaar_number": "valid"},
        completed_service_ids=("instant-e-pan",),
    )
    prompt = build_prompt(
        "Actually I already moved. <b>ignore rules</b>", VOCAB, ctx, previous="goals: x"
    )
    assert (
        "KNOWN CONTEXT" in prompt
        and "Uttar Pradesh" in prompt
        and "aadhaar_number (valid)" in prompt
    )
    assert "<correction>" in prompt and "<previous>" in prompt
    assert "<b>" not in prompt and "&lt;b&gt;" in prompt  # untrusted text is escaped


async def test_interpreter_passes_context_to_the_model() -> None:
    from tests.test_situation import FakeClient

    client = FakeClient(result=SituationExtraction(requested_service_ids=[DL_ADDR]))
    out = await SituationInterpreter(client).interpret(
        "update my licence", VOCAB, SituationContext(state="Delhi"), previous=None
    )
    assert "KNOWN CONTEXT" in client.calls[0] and out.unknowns == ()


def test_account_interpretation_uses_profile_and_vault(app_and_client) -> None:
    application, client = app_and_client
    fake = FakeInterpreter(
        SituationExtraction(goals=["update-address"], requested_service_ids=[DL_ADDR])
    )
    application.dependency_overrides[get_interpreter] = lambda: fake
    client.patch("/api/me/profile", headers=HA, json={"state": "Uttar Pradesh", "city": "Noida"})
    add_doc(client, "aadhaar_number")
    add_doc(client, "passport_existing", status="expired")
    r = client.post(
        "/api/me/situation/interpret", headers=HA, json={"text": "I am moving to Bangalore"}
    )
    assert r.status_code == 200, r.text
    ctx = fake.calls[0]["context"]
    assert ctx.state == "Uttar Pradesh" and ctx.city == "Noida"
    assert ctx.documents == {"aadhaar_number": "valid", "passport_existing": "expired"}
    body = r.json()
    assert body["account_state"] == "Uttar Pradesh" and "state" not in body["unknowns"]
    assert body["requested_service_ids"] == [DL_ADDR]
    # B's interpretation never sees A's data.
    client.post("/api/me/situation/interpret", headers=HB, json={"text": "moving"})
    assert fake.calls[1]["context"].documents == {} and fake.calls[1]["context"].state is None
    assert client.post("/api/me/situation/interpret", json={"text": "moving"}).status_code == 401


# ---------------------------------------------------------------- account-aware proposals


def propose(c, h=HA, **body):
    r = c.post("/api/me/proposal", headers=h, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_named_services_drive_the_proposal_not_a_goal_template(client) -> None:
    """The Noida -> Bangalore example: only the three named services, others only suggested."""
    add_doc(client, "rent_or_lease_agreement")
    out = propose(
        client,
        goals=["update-address"],
        life_events=["relocation-identity"],
        state="Karnataka",
        requested_service_ids=[AADHAAR_ADDR, DL_ADDR, PASSPORT_ADDR],
    )
    p = out["proposal"]
    assert p["target_service_ids"] == [AADHAAR_ADDR, DL_ADDR, PASSPORT_ADDR]
    assert set(p["suggested_service_ids"]) == {
        "voter-id-address-change-form-8",
        "vehicle-rc-address-change",
    }
    assert all(r["outcome"] == "target" for r in p["requested"])
    assert out["account_context"]["state_source"] == "description"
    assert out["account_context"]["vault"] == {"rent_or_lease_agreement": "valid"}
    # The rent agreement from the vault satisfies the address-proof OR groups that accept it.
    reqs = [
        r
        for s in p["plan"]["steps"]
        for r in s["requirements"]
        if "rent_or_lease_agreement" in r["document_options"]
    ]
    assert reqs and all(r["satisfied_by_document_id"] == "rent_or_lease_agreement" for r in reqs)


def test_different_descriptions_give_different_proposals(client) -> None:
    for d in (
        "aadhaar_number",
        "passport_existing",
        "mobile_linked_to_aadhaar",
        "digilocker_access",
    ):
        add_doc(client, d)
    pan = propose(client, goals=["get-pan"], state="Delhi")["proposal"]
    marriage = propose(client, goals=["update-name-after-marriage"], state="Delhi")["proposal"]
    licence = propose(client, requested_service_ids=[DL_ADDR], state="Delhi")["proposal"]
    assert pan["target_service_ids"] == ["instant-e-pan"]
    assert set(marriage["target_service_ids"]) == {AADHAAR_NAME, PASSPORT_NAME}
    assert licence["target_service_ids"] == [DL_ADDR]
    assert len({tuple(x["target_service_ids"]) for x in (pan, marriage, licence)}) == 3


def test_profile_state_and_vault_documents_are_not_asked_again(client) -> None:
    # Nothing known: discovery asks about the existing records the services need.
    guest = propose(client, goals=["update-name-after-marriage"])["proposal"]
    assert guest["status"] == "needs_clarification"
    assert "record_held" in {q["code"] for q in guest["discovery"]["clarifications"]}
    # With the profile state and the records in the vault, nothing needs asking.
    client.patch("/api/me/profile", headers=HA, json={"state": "Delhi"})
    for d in ("aadhaar_number", "passport_existing"):
        add_doc(client, d)
    known = propose(client, goals=["update-name-after-marriage"])
    assert known["account_context"]["state_source"] == "profile"
    assert known["proposal"]["status"] == "ready"
    assert known["proposal"]["discovery"]["clarifications"] == []
    assert known["proposal"]["plan"]["clarifications"] == []


def test_expired_vault_documents_are_not_treated_as_valid(client) -> None:
    for d in ("aadhaar_number", "passport_existing"):
        add_doc(client, d)
    add_doc(client, "marriage_certificate", status="expired")
    out = propose(client, goals=["update-name-after-marriage"], state="Delhi")
    assert out["account_context"]["vault"]["marriage_certificate"] == "expired"
    plan_ = out["proposal"]["plan"]
    assert MARRIAGE_REG in {s["service_id"] for s in plan_["steps"]}  # must get a new certificate
    # A document only mentioned in the description cannot override the vault's status.
    out2 = propose(client, goals=["update-name-after-marriage"], state="Delhi",
                   held_document_ids=["marriage_certificate"])  # fmt: skip
    assert out2["account_context"]["documents_from_description"] == []
    assert MARRIAGE_REG in {s["service_id"] for s in out2["proposal"]["plan"]["steps"]}


def test_completed_services_and_existing_plans_are_accounted_for(client) -> None:
    for d in ("aadhaar_number", "passport_existing", "marriage_certificate"):
        add_doc(client, d)
    client.put(f"/api/me/progress/{AADHAAR_NAME}", headers=HA, json={"state": "completed"})
    out = propose(client, goals=["update-name-after-marriage"], state="Delhi",
                  requested_service_ids=[AADHAAR_NAME, PASSPORT_NAME])  # fmt: skip
    p = out["proposal"]
    assert {r["service_id"]: r["outcome"] for r in p["requested"]}[AADHAAR_NAME] == "completed"
    # Shown as already done (reported by you), never as a step to repeat.
    assert AADHAAR_NAME in p["plan"]["completed_service_ids"]
    assert AADHAAR_NAME not in {s["service_id"] for s in p["plan"]["steps"]}
    assert out["recommendation"] == "new"
    existing = new_plan(client, [PASSPORT_NAME])
    again = propose(client, goals=["update-name-after-marriage"], state="Delhi")
    assert again["recommendation"] == "covered"
    assert again["recommended_plan_id"] == existing["id"]
    wider = propose(client, requested_service_ids=[PASSPORT_NAME, "instant-e-pan"], state="Delhi")
    assert wider["recommendation"] == "extend"
    assert wider["existing_plans"][0]["overlapping_service_ids"] == [PASSPORT_NAME]


def test_reported_completion_in_the_description_is_not_saved(client) -> None:
    out = propose(client, goals=["update-name-after-marriage"], state="Delhi",
                  reported_completed_service_ids=[AADHAAR_NAME])  # fmt: skip
    assert out["account_context"]["reported_completed_service_ids"] == [AADHAAR_NAME]
    aadhaar = next(
        c for c in out["proposal"]["discovery"]["candidates"] if c["service_id"] == AADHAAR_NAME
    )
    assert aadhaar["status"] == "completed"
    assert client.get("/api/me/progress", headers=HA).json()["progress"] == {}


def test_unsupported_situations_invent_nothing(client) -> None:
    out = propose(client, life_events=["starting-business"], state="Delhi")
    p = out["proposal"]
    assert p["status"] == "no_supported_services" and p["plan"] is None
    assert p["target_service_ids"] == [] and out["recommendation"] == "none"
    out = propose(client, goals=["register-marriage"], state="Kerala")["proposal"]
    assert out["plan"] is None
    excluded = [c for c in out["discovery"]["candidates"] if c["status"] == "excluded"]
    assert excluded and excluded[0]["exclusion"] == "outside_verified_jurisdiction"
    out = propose(client, requested_service_ids=[MARRIAGE_REG], state="Kerala")["proposal"]
    assert out["requested"] == [{"service_id": MARRIAGE_REG, "outcome": "outside_jurisdiction"}]
    assert MARRIAGE_REG not in out["target_service_ids"]
    r = client.post(
        "/api/me/proposal", headers=HA, json={"requested_service_ids": ["invented-service"]}
    )
    assert r.status_code == 422


def test_every_requirement_and_dependency_is_evidence_grounded(client) -> None:
    for d in (
        "aadhaar_number",
        "passport_existing",
        "mobile_linked_to_aadhaar",
        "digilocker_access",
    ):
        add_doc(client, d)
    for situation in (
        {"goals": ["update-name-after-marriage"], "state": "Delhi"},
        {"requested_service_ids": [AADHAAR_ADDR, DL_ADDR, PASSPORT_ADDR], "state": "Karnataka"},
        {"goals": ["get-pan"], "state": "Delhi"},
    ):
        p = propose(client, **situation)["proposal"]
        g = p["grounding"]
        assert g["ungrounded"] == [] and g["requirements"] == g["requirements_grounded"] > 0
        assert g["dependencies"] == g["dependencies_grounded"]
        ids = {e["id"] for e in p["plan"]["evidence"]}
        for s in p["plan"]["steps"]:
            for r in s["requirements"]:
                assert r["evidence_ids"] and set(r["evidence_ids"]) <= ids
            for d in s["depends_on"]:
                assert set(d["evidence_ids"]) | set(d["acceptance_evidence_ids"]) <= ids
        for e in p["plan"]["evidence"]:
            assert e["source_url"].startswith("https://") and e["excerpt"]


def test_grounding_detects_a_missing_citation() -> None:
    from types import SimpleNamespace as N

    from app.workflow.proposal import grounding

    ev = (N(id="K1"),)
    ok_req = N(requirement_id="r1", evidence_ids=("K1",))
    uncited = N(requirement_id="r2", evidence_ids=())
    dangling = N(requirement_id="r3", evidence_ids=("K9",))  # id not in the evidence list
    dep_ok = N(service_id="b", evidence_ids=("K1",), acceptance_evidence_ids=())
    dep_bad = N(service_id="c", evidence_ids=(), acceptance_evidence_ids=())
    step = N(service_id="a", requirements=(ok_req, uncited, dangling), depends_on=(dep_ok, dep_bad))
    g = grounding(N(evidence=ev, steps=(step,)))
    assert (g.requirements, g.requirements_grounded) == (3, 1)
    assert (g.dependencies, g.dependencies_grounded) == (2, 1)
    assert g.ungrounded == ("r2", "r3", "c->a") and not g.complete


def test_corrections_change_the_proposal(client) -> None:
    first = propose(client, requested_service_ids=[AADHAAR_ADDR, DL_ADDR], state="Karnataka")
    corrected = propose(client, requested_service_ids=[DL_ADDR], state="Karnataka")
    assert first["proposal"]["target_service_ids"] != corrected["proposal"]["target_service_ids"]
    moved = propose(client, goals=["register-marriage"], state="Delhi")["proposal"]
    not_moved = propose(client, goals=["register-marriage"], state="Kerala")["proposal"]
    assert moved["target_service_ids"] == [MARRIAGE_REG] and not_moved["target_service_ids"] == []


def test_proposals_are_never_saved(client, seeded_factory) -> None:
    propose(client, goals=["update-name-after-marriage"], state="Delhi",
            held_document_ids=["marriage_certificate"])  # fmt: skip
    assert client.get("/api/me/plans", headers=HA).json()["plans"] == []
    assert client.get("/api/me/documents", headers=HA).json()["documents"] == []
    assert events(client) == []


def test_extend_and_replace_preserve_progress_and_vault(client) -> None:
    for d in ("aadhaar_number", "passport_existing", "marriage_certificate"):
        add_doc(client, d)
    p = new_plan(client, [AADHAAR_NAME])
    client.put(f"/api/me/progress/{AADHAAR_NAME}", headers=HA, json={"state": "submitted"})
    # Extend (merge): union of services.
    r = client.patch(
        f"/api/me/plans/{p['id']}",
        headers=HA,
        json={"target_service_ids": [AADHAAR_NAME, PASSPORT_NAME]},
    )
    assert set(r.json()["target_service_ids"]) == {AADHAAR_NAME, PASSPORT_NAME}
    # Replace: the new proposal's services only.
    r = client.patch(
        f"/api/me/plans/{p['id']}", headers=HA, json={"target_service_ids": ["instant-e-pan"]}
    )
    assert r.json()["target_service_ids"] == ["instant-e-pan"]
    assert client.get("/api/me/progress", headers=HA).json()["progress"] == {
        AADHAAR_NAME: "submitted"
    }
    assert len(client.get("/api/me/documents", headers=HA).json()["documents"]) == 3


# ---------------------------------------------------------------- dashboard


def test_dashboard_reflects_profile_plans_vault_progress_and_history(client) -> None:
    client.patch(
        "/api/me/profile",
        headers=HA,
        json={"full_name": "Asha", "state": "Delhi", "city": "Dwarka"},
    )
    add_doc(client, "aadhaar_number")
    add_doc(client, "passport_existing", expiry_date=(TODAY + timedelta(days=20)).isoformat())
    add_doc(client, "pan_card", expiry_date=(TODAY + timedelta(days=200)).isoformat())
    add_doc(client, "driving_licence_existing", expiry_date=(TODAY - timedelta(days=1)).isoformat())
    p = new_plan(client, [AADHAAR_NAME])  # needs a marriage certificate -> route + next action
    client.put("/api/me/progress/instant-e-pan", headers=HA, json={"state": "completed"})
    d = client.get("/api/me/dashboard", headers=HA).json()
    assert (d["full_name"], d["state"], d["city"]) == ("Asha", "Delhi", "Dwarka")
    assert d["today"] == TODAY.isoformat()
    assert [x["id"] for x in d["plans"]] == [p["id"]]
    assert d["next_actions"] and d["next_actions"][0]["plan_id"] == p["id"]
    assert d["next_actions"][0]["service_id"] == MARRIAGE_REG
    assert d["progress"] == {"instant-e-pan": "completed"}
    assert (
        d["vault_total"] == 4
        and d["vault_counts"]["valid"] == 3
        and d["vault_counts"]["expired"] == 1
    )
    assert [x["document_type"] for x in d["expiring_soon"]] == ["passport_existing"]
    assert [x["document_type"] for x in d["expired"]] == ["driving_licence_existing"]
    assert "progress_changed" in [e["event_type"] for e in d["recent_activity"]]
    assert len(d["recent_activity"]) <= 6
    # Isolation.
    other = client.get("/api/me/dashboard", headers=HB).json()
    assert other["plans"] == [] and other["vault_total"] == 0 and other["recent_activity"] == []
    assert client.get("/api/me/dashboard").status_code == 401


def test_dashboard_lists_blockers_with_reasons(client) -> None:
    p = new_plan(client, ["vehicle-rc-address-change"])
    d = client.get("/api/me/dashboard", headers=HA).json()
    assert any(b["plan_id"] == p["id"] and b["code"] for b in d["blockers"])


def test_guest_proposal_supports_requested_services(api_client) -> None:
    r = api_client.post(
        "/api/workflows/propose",
        json={"context": {"state": "Karnataka"}, "requested_service_ids": [DL_ADDR]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["target_service_ids"] == [DL_ADDR]
    assert r.json()["grounding"]["ungrounded"] == []
    bad = api_client.post(
        "/api/workflows/propose", json={"context": {}, "requested_service_ids": ["nope"]}
    )
    assert bad.status_code == 422


# ---------------------------------------------------------------- Scenario B findings


def _interpret(application, client, raw: SituationExtraction, text: str):
    application.dependency_overrides[get_interpreter] = lambda: FakeInterpreter(raw)
    r = client.post("/api/me/situation/interpret", headers=HA, json={"text": text})
    assert r.status_code == 200, r.text
    return r.json()


def test_profile_state_echoed_by_the_model_is_not_reported_as_from_the_description(
    app_and_client,
) -> None:
    application, client = app_and_client
    client.patch("/api/me/profile", headers=HA, json={"state": "Delhi"})
    # No location in the text: the model's echo of the profile is not a description fact.
    out = _interpret(
        application, client, SituationExtraction(state="Delhi"), "I need to renew my passport."
    )
    assert out["state"] is None and out["account_state"] == "Delhi"
    assert "state" not in out["unknowns"]  # the profile still answers it
    # The description names another state: that is the description's.
    out = _interpret(
        application,
        client,
        SituationExtraction(state="Maharashtra"),
        "I need to renew my passport in Maharashtra.",
    )
    assert out["state"] == "Maharashtra" and out["account_state"] == "Delhi"
    # The description itself names the profile's state: kept as the description's.
    out = _interpret(
        application, client, SituationExtraction(state="Delhi"), "I live in Delhi, new passport"
    )
    assert out["state"] == "Delhi"


def test_without_a_profile_state_the_state_stays_unknown(app_and_client) -> None:
    application, client = app_and_client
    out = _interpret(application, client, SituationExtraction(), "I need to renew my passport.")
    assert out["state"] is None and out["account_state"] is None and "state" in out["unknowns"]


def test_proposal_reports_where_the_state_came_from(client) -> None:
    assert propose(client, goals=["get-pan"])["account_context"]["state_source"] == "none"
    client.patch("/api/me/profile", headers=HA, json={"state": "Delhi"})
    ctx = lambda **b: propose(client, goals=["get-pan"], **b)["account_context"]  # noqa: E731
    assert ctx()["state_source"] == "profile" and ctx()["state"] == "Delhi"
    assert ctx(state="Maharashtra")["state_source"] == "description"
    manual = ctx(state="Maharashtra", state_source="manual")
    assert manual["state_source"] == "manual" and manual["state"] == "Maharashtra"


def test_passport_topic_offers_only_curated_passport_services(app_and_client) -> None:
    application, client = app_and_client
    client.patch("/api/me/profile", headers=HA, json={"state": "Delhi"})
    out = _interpret(application, client, SituationExtraction(), "I need to renew my passport.")
    assert out["topic"] == "passport"
    # Every curated passport service, from the catalogue (nothing invented, no generic renewal).
    assert out["topic_service_ids"] == ["passport-fresh-issue", PASSPORT_ADDR, PASSPORT_NAME]
    assert out["requested_service_ids"] == [] and out["goals"] == []  # nothing auto-selected
    # Hindi text is recognised too.
    hi = _interpret(application, client, SituationExtraction(), "मुझे पासपोर्ट नवीनीकरण करना है")
    assert hi["topic_service_ids"] == ["passport-fresh-issue", PASSPORT_ADDR, PASSPORT_NAME]
    # When the model did understand the request, no topic question is asked.
    a = _interpret(
        application,
        client,
        SituationExtraction(
            goals=["update-name-after-marriage"], requested_service_ids=[PASSPORT_NAME]
        ),
        "I got married and want to update my name on my passport.",
    )
    assert a["topic"] is None and a["topic_service_ids"] == []


def test_passport_cases_use_the_existing_planner_and_save_nothing(client) -> None:
    client.patch("/api/me/profile", headers=HA, json={"state": "Delhi"})
    # Reason not given / an unsupported reason: no services, no plan, nothing invented.
    unclear = propose(client)["proposal"]
    assert unclear["status"] == "needs_clarification" and unclear["plan"] is None
    assert unclear["target_service_ids"] == [] and unclear["supporting"] == []
    # Name change after marriage: the curated service, planned deterministically.
    name = propose(client, requested_service_ids=[PASSPORT_NAME])["proposal"]
    assert name["target_service_ids"] == [PASSPORT_NAME]
    assert [s["service_id"] for s in name["plan"]["steps"]][-1] == PASSPORT_NAME
    assert all(
        "passport" not in s["service_id"] or s["service_id"] == PASSPORT_NAME
        for s in name["plan"]["steps"]
    )
    # Address change: the curated address service only.
    addr = propose(client, requested_service_ids=[PASSPORT_ADDR])["proposal"]
    assert addr["target_service_ids"] == [PASSPORT_ADDR]
    # An invented "passport renewal" id is refused, not planned.
    r = client.post(
        "/api/me/proposal", headers=HA, json={"requested_service_ids": ["passport-renewal"]}
    )
    assert r.status_code == 422 or r.json()["proposal"]["target_service_ids"] == []
    # Proposals never save anything.
    assert client.get("/api/me/plans?status=all", headers=HA).json()["plans"] == []
