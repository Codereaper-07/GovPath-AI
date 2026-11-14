"""Signed-in account data: vault, progress, saved plans, synchronisation, activity (offline)."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.auth import get_token_verifier
from app.config import get_settings
from app.db import get_session
from app.main import create_app
from app.models import ActivityEvent, ServiceProgress
from app.schemas.account import looks_like_identity_number
from tests.auth_fakes import AUTH_SETTINGS, bearer, make_token, make_verifier

A = uuid.UUID("aaaaaaaa-1111-4111-8111-111111111111")
B = uuid.UUID("bbbbbbbb-2222-4222-8222-222222222222")
AADHAAR_NAME = "aadhaar-name-update"
PASSPORT_NAME = "passport-reissue-name-change-marriage"
MARRIAGE_REG = "marriage-registration-delhi"


@pytest.fixture
def client(seeded_factory) -> TestClient:
    application = create_app()

    async def _session():
        async with seeded_factory() as s:
            yield s

    verifier = make_verifier()
    application.dependency_overrides[get_session] = _session
    application.dependency_overrides[get_settings] = lambda: AUTH_SETTINGS
    application.dependency_overrides[get_token_verifier] = lambda: verifier
    return TestClient(application)


HA, HB = bearer(make_token(A)), bearer(make_token(B))


def add_doc(c: TestClient, doc_type: str, status: str = "valid", h=HA, **extra):
    return c.post(
        "/api/me/documents", headers=h, json={"document_type": doc_type, "status": status, **extra}
    )


def new_plan(c: TestClient, targets: list[str], h=HA, **extra) -> dict:
    r = c.post(
        "/api/me/plans", headers=h, json={"target_service_ids": targets, "state": "Delhi", **extra}
    )
    assert r.status_code == 201, r.text
    return r.json()


def steps(detail: dict) -> dict[str, str]:
    snap = detail["plan"]
    out = {s["service_id"]: s["status"] for s in snap["steps"]}
    out.update({sid: "completed" for sid in snap["completed_service_ids"]})
    return out


def plan(c: TestClient, plan_id: str, h=HA) -> dict:
    r = c.get(f"/api/me/plans/{plan_id}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def activity(c: TestClient, h=HA, **params) -> list[dict]:
    return c.get("/api/me/activity", headers=h, params=params).json()["events"]


def base_docs(c: TestClient) -> None:
    """Documents every name-change step needs, apart from the marriage proof."""
    for d in ("aadhaar_number", "passport_existing"):
        assert add_doc(c, d).status_code == 201


# ---------------------------------------------------------------- auth & isolation


def test_every_account_endpoint_requires_sign_in(client: TestClient) -> None:
    pid = str(uuid.uuid4())
    calls = [
        ("get", "/api/me/documents"),
        ("post", "/api/me/documents"),
        ("patch", f"/api/me/documents/{pid}"),
        ("delete", f"/api/me/documents/{pid}"),
        ("get", "/api/me/plans"),
        ("post", "/api/me/plans"),
        ("get", f"/api/me/plans/{pid}"),
        ("patch", f"/api/me/plans/{pid}"),
        ("post", f"/api/me/plans/{pid}/archive"),
        ("delete", f"/api/me/plans/{pid}"),
        ("get", "/api/me/progress"),
        ("put", f"/api/me/progress/{AADHAAR_NAME}"),
        ("get", "/api/me/activity"),
    ]
    for method, url in calls:
        assert getattr(client, method)(url).status_code == 401, (method, url)


def test_users_cannot_touch_each_others_data(client: TestClient) -> None:
    doc = add_doc(client, "aadhaar_number").json()["document"]
    p = new_plan(client, [AADHAAR_NAME])
    # B sees nothing of A's.
    assert client.get("/api/me/documents", headers=HB).json()["documents"] == []
    assert client.get("/api/me/plans", headers=HB).json()["plans"] == []
    assert client.get("/api/me/activity", headers=HB).json()["events"] == []
    assert client.get("/api/me/progress", headers=HB).json()["progress"] == {}
    # B cannot read, edit, archive or delete A's rows (404, indistinguishable from missing).
    assert client.get(f"/api/me/plans/{p['id']}", headers=HB).status_code == 404
    assert (
        client.patch(f"/api/me/plans/{p['id']}", headers=HB, json={"title": "x"}).status_code == 404
    )
    assert client.post(f"/api/me/plans/{p['id']}/archive", headers=HB).status_code == 404
    assert client.delete(f"/api/me/plans/{p['id']}", headers=HB).status_code == 404
    assert (
        client.patch(
            f"/api/me/documents/{doc['id']}", headers=HB, json={"status": "invalid"}
        ).status_code
        == 404
    )
    assert client.delete(f"/api/me/documents/{doc['id']}", headers=HB).status_code == 404
    # A client-chosen owner is rejected outright.
    r = client.post(
        "/api/me/documents",
        headers=HB,
        json={"document_type": "pan_card", "status": "valid", "user_id": str(A)},
    )
    assert r.status_code == 422
    # A's data is intact.
    assert client.get("/api/me/documents", headers=HA).json()["documents"][0]["status"] == "valid"
    assert plan(client, p["id"])["status"] == "active"
    # B's progress on the same service does not leak into A's plan.
    client.put(f"/api/me/progress/{AADHAAR_NAME}", headers=HB, json={"state": "submitted"})
    assert client.get("/api/me/progress", headers=HA).json()["progress"] == {}


# ---------------------------------------------------------------- documents


def test_document_crud_and_validation(client: TestClient) -> None:
    r = add_doc(client, "passport_existing", label="Old passport", issue_date="2015-01-10",
                expiry_date="2025-01-09", note="kept in the locker")  # fmt: skip
    assert r.status_code == 201, r.text
    doc = r.json()["document"]
    assert doc["status"] == "valid" and doc["effective_status"] == "expired"  # expiry passed
    assert doc["expiry_passed"] is True and doc["name"]
    # Edit: status and note; unknown fields and bad statuses are rejected.
    r = client.patch(
        f"/api/me/documents/{doc['id']}", headers=HA, json={"status": "unsure", "note": None}
    )
    assert r.json()["document"]["status"] == "unsure" and r.json()["document"]["note"] is None
    assert (
        client.patch(
            f"/api/me/documents/{doc['id']}", headers=HA, json={"status": "verified"}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/me/documents/{doc['id']}", headers=HA, json={"status": None}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/me/documents/{doc['id']}", headers=HA, json={"document_type": "pan_card"}
        ).status_code
        == 422
    )
    # Dates must make sense.
    assert add_doc(client, "pan_card", issue_date="2030-01-01").status_code == 422
    assert (
        add_doc(client, "pan_card", issue_date="2020-01-01", expiry_date="2019-01-01").status_code
        == 422
    )
    r = client.patch(
        f"/api/me/documents/{doc['id']}", headers=HA, json={"expiry_date": "2010-01-01"}
    )
    assert r.status_code == 422
    # Unknown document types are rejected.
    assert add_doc(client, "made_up_document").status_code == 422
    # Delete.
    assert client.delete(f"/api/me/documents/{doc['id']}", headers=HA).status_code == 200
    assert client.get("/api/me/documents", headers=HA).json()["documents"] == []
    assert client.delete(f"/api/me/documents/{doc['id']}", headers=HA).status_code == 404


def test_duplicates_rejected_but_labelled_copies_allowed(client: TestClient) -> None:
    assert add_doc(client, "passport_existing").status_code == 201
    r = add_doc(client, "passport_existing")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "duplicate_document"
    assert add_doc(client, "passport_existing", label="Spouse's copy").status_code == 201
    assert add_doc(client, "passport_existing", label="spouse's COPY").status_code == 409
    assert len(client.get("/api/me/documents", headers=HA).json()["documents"]) == 2


@pytest.mark.parametrize(
    "text",
    ["1234 5678 9012", "123456789012", "ABCDE1234F", "abcde 1234 f", "Z1234567", "ABC1234567",
     "call 98765 43210"],
)  # fmt: skip
def test_identity_numbers_are_never_stored(client: TestClient, text: str) -> None:
    assert looks_like_identity_number(text)
    assert add_doc(client, "pan_card", note=text).status_code == 422
    assert add_doc(client, "pan_card", label=text).status_code == 422
    r = client.post(
        "/api/me/plans", headers=HA, json={"target_service_ids": [AADHAAR_NAME], "title": text}
    )
    assert r.status_code == 422


def test_ordinary_notes_and_dates_are_allowed() -> None:
    for text in ("Renewed on 12/05/2024", "valid till 2030-01-31", "Kept with Mum", "Form 8"):
        assert not looks_like_identity_number(text)


# ---------------------------------------------------------------- plans


def test_plan_create_get_list_update_archive_restore_delete(client: TestClient) -> None:
    base_docs(client)
    p = new_plan(
        client, [AADHAAR_NAME], title="Name after marriage", goals=["update-name-after-marriage"]
    )
    assert p["status"] == "active" and p["citizen_state"] == "Delhi"
    snap = p["plan"]
    # The stored plan keeps the full planner output: order, dependencies, blockers, evidence, names.
    for key in (
        "steps",
        "parallel_groups",
        "blockers",
        "next_action",
        "evidence",
        "services",
        "documents",
    ):
        assert key in snap
    assert MARRIAGE_REG in steps(p)  # acquisition route for the missing marriage certificate
    assert plan(client, p["id"])["plan"] == snap
    assert [x["id"] for x in client.get("/api/me/plans", headers=HA).json()["plans"]] == [p["id"]]
    # Update: add a service.
    r = client.patch(
        f"/api/me/plans/{p['id']}",
        headers=HA,
        json={"target_service_ids": [AADHAAR_NAME, PASSPORT_NAME]},
    )
    assert r.status_code == 200 and PASSPORT_NAME in steps(r.json())
    assert (
        client.patch(
            f"/api/me/plans/{p['id']}", headers=HA, json={"target_service_ids": []}
        ).status_code
        == 422
    )
    assert (
        client.patch(f"/api/me/plans/{p['id']}", headers=HA, json={"state": "Atlantis"}).status_code
        == 422
    )
    # Archive hides it from the active list; restore brings it back.
    assert (
        client.post(f"/api/me/plans/{p['id']}/archive", headers=HA).json()["status"] == "archived"
    )
    assert client.get("/api/me/plans", headers=HA).json()["plans"] == []
    assert (
        len(client.get("/api/me/plans", headers=HA, params={"status": "archived"}).json()["plans"])
        == 1
    )
    assert client.post(f"/api/me/plans/{p['id']}/restore", headers=HA).json()["status"] == "active"
    assert client.delete(f"/api/me/plans/{p['id']}", headers=HA).status_code == 204
    assert client.get(f"/api/me/plans/{p['id']}", headers=HA).status_code == 404
    types = [e["event_type"] for e in activity(client, entity_id=p["id"])]
    for t in ("plan_created", "plan_updated", "plan_archived", "plan_restored", "plan_deleted"):
        assert t in types


def test_plan_rejects_unknown_ids(client: TestClient) -> None:
    for body in (
        {"target_service_ids": ["no-such-service"]},
        {"target_service_ids": [AADHAAR_NAME], "goals": ["become-king"]},
        {"target_service_ids": [AADHAAR_NAME], "held_documents": [{"document_type": "nope"}]},
        {"target_service_ids": [AADHAAR_NAME], "user_id": str(B)},
    ):
        assert client.post("/api/me/plans", headers=HA, json=body).status_code == 422


def test_accepting_a_proposal_adds_reviewed_documents_to_the_vault_once(client: TestClient) -> None:
    assert add_doc(client, "aadhaar_number", status="unsure").status_code == 201
    p = new_plan(
        client,
        [PASSPORT_NAME],
        held_documents=[
            {"document_type": "aadhaar_number", "status": "valid"},  # vault already has it: kept
            {"document_type": "passport_existing", "status": "valid"},
            {"document_type": "joint_photo_declaration", "status": "valid"},
        ],
    )
    assert len(p["created_document_ids"]) == 2
    docs = {
        d["document_type"]: d
        for d in client.get("/api/me/documents", headers=HA).json()["documents"]
    }
    assert docs["aadhaar_number"]["status"] == "unsure"  # the vault entry wins
    assert steps(p)[PASSPORT_NAME] == "ready"  # the alternative (joint declaration) satisfies it


def test_plan_is_kept_when_the_catalogue_changes(client: TestClient, seeded_factory) -> None:
    base_docs(client)
    p = new_plan(client, [AADHAAR_NAME])
    import asyncio

    from app.models import UserPlan

    async def _rename_target():
        async with seeded_factory() as s:
            await s.execute(
                update(UserPlan)
                .where(UserPlan.id == uuid.UUID(p["id"]))
                .values(target_service_ids=["service-removed-from-catalogue"])
            )
            await s.commit()

    asyncio.run(_rename_target())
    r = client.post(f"/api/me/plans/{p['id']}/recalculate", headers=HA)
    assert r.status_code == 200
    assert r.json()["evaluation_error"] == "catalogue_changed"
    assert r.json()["plan"] == p["plan"]  # the accepted workflow is still displayable
    # A document change elsewhere does not break the account either.
    assert add_doc(client, "pan_card").status_code == 201


# ---------------------------------------------------------------- synchronisation


def test_one_vault_document_is_referenced_by_several_plans(client: TestClient) -> None:
    base_docs(client)
    cert = add_doc(client, "marriage_certificate").json()["document"]
    p1 = new_plan(client, [AADHAAR_NAME])
    p2 = new_plan(client, [PASSPORT_NAME])
    docs = {
        d["document_type"]: d
        for d in client.get("/api/me/documents", headers=HA).json()["documents"]
    }
    assert set(docs["marriage_certificate"]["used_by_plan_ids"]) == {p1["id"], p2["id"]}
    for p in (p1, p2):
        refs = {r["document_type"]: r for r in plan(client, p["id"])["document_refs"]}
        assert refs["marriage_certificate"]["vault_document_ids"] == [cert["id"]]
    assert len(client.get("/api/me/documents", headers=HA).json()["documents"]) == 3  # no copies


def test_document_status_change_recalculates_every_affected_plan(client: TestClient) -> None:
    base_docs(client)
    cert = add_doc(client, "marriage_certificate").json()["document"]
    p1 = new_plan(client, [AADHAAR_NAME])
    p2 = new_plan(client, [PASSPORT_NAME])
    assert steps(p1)[AADHAAR_NAME] == "ready" and steps(p2)[PASSPORT_NAME] == "ready"
    assert MARRIAGE_REG not in steps(p1)

    r = client.patch(f"/api/me/documents/{cert['id']}", headers=HA, json={"status": "expired"})
    changed = {c["plan_id"]: c for c in r.json()["plan_changes"]}
    assert set(changed) == {p1["id"], p2["id"]}
    for p, sid in ((p1, AADHAAR_NAME), (p2, PASSPORT_NAME)):
        now = steps(plan(client, p["id"]))
        assert now[sid] != "ready"  # waits for (or is blocked on) a new marriage certificate
        assert MARRIAGE_REG in now  # the planner routes to the issuing service
        assert any(
            s["service_id"] == sid and s["before"] == "ready" for s in changed[p["id"]]["steps"]
        )
    # Valid again: both unblock.
    client.patch(f"/api/me/documents/{cert['id']}", headers=HA, json={"status": "valid"})
    assert steps(plan(client, p1["id"]))[AADHAAR_NAME] == "ready"
    assert steps(plan(client, p2["id"]))[PASSPORT_NAME] == "ready"
    # Removing it blocks again; logged per plan with the cause.
    r = client.delete(f"/api/me/documents/{cert['id']}", headers=HA)
    assert {c["plan_id"] for c in r.json()["plan_changes"]} == {p1["id"], p2["id"]}
    recalcs = [e for e in activity(client) if e["event_type"] == "plan_recalculated"]
    assert recalcs[0]["details"]["cause"]["type"] == "document_removed"
    assert recalcs[0]["details"]["cause"]["document_type"] == "marriage_certificate"


def test_alternative_documents_still_satisfy_requirements(client: TestClient) -> None:
    base_docs(client)
    cert = add_doc(client, "marriage_certificate", status="expired").json()["document"]
    add_doc(client, "joint_photo_declaration")
    p_aadhaar = new_plan(client, [AADHAAR_NAME])
    p_passport = new_plan(client, [PASSPORT_NAME])
    # The passport accepts the joint declaration (OR group); Aadhaar does not.
    assert steps(p_passport)[PASSPORT_NAME] == "ready"
    assert steps(p_aadhaar)[AADHAAR_NAME] != "ready"
    req = next(
        r for s in p_passport["plan"]["steps"] if s["service_id"] == PASSPORT_NAME
        for r in s["requirements"] if "joint_photo_declaration" in r["document_options"]
    )  # fmt: skip
    assert req["satisfied_by_document_id"] == "joint_photo_declaration"
    assert req["is_alternative_group"] is True
    assert "marriage_certificate" in req["unusable_document_ids"]
    # A second, valid copy of the certificate satisfies Aadhaar too.
    add_doc(client, "marriage_certificate", label="Certified copy")
    assert steps(plan(client, p_aadhaar["id"]))[AADHAAR_NAME] == "ready"
    client.delete(f"/api/me/documents/{cert['id']}", headers=HA)
    assert steps(plan(client, p_aadhaar["id"]))[AADHAAR_NAME] == "ready"  # the copy remains


def test_document_changes_never_alter_reported_progress(client: TestClient, seeded_factory) -> None:
    base_docs(client)
    cert = add_doc(client, "marriage_certificate").json()["document"]
    p = new_plan(client, [AADHAAR_NAME, PASSPORT_NAME])
    client.put(f"/api/me/progress/{AADHAAR_NAME}", headers=HA, json={"state": "submitted"})
    client.put(f"/api/me/progress/{PASSPORT_NAME}", headers=HA, json={"state": "completed"})
    before = client.get("/api/me/progress", headers=HA).json()["progress"]
    for change in (
        {"status": "expired"},
        {"status": "invalid"},
        {"status": "unsure"},
        {"status": "valid"},
    ):
        client.patch(f"/api/me/documents/{cert['id']}", headers=HA, json=change)
    client.delete(f"/api/me/documents/{cert['id']}", headers=HA)
    add_doc(client, "marriage_certificate")
    assert client.get("/api/me/progress", headers=HA).json()["progress"] == before
    now = plan(client, p["id"])["plan"]
    assert PASSPORT_NAME in now["completed_service_ids"]  # still reported completed
    step = next(s for s in now["steps"] if s["service_id"] == AADHAAR_NAME)
    assert step["process_state"] == "submitted"
    progress_events = [e for e in activity(client) if e["event_type"] == "progress_changed"]
    assert len(progress_events) == 2  # only the two explicit reports


def test_progress_updates_are_explicit_and_shared_by_plans(client: TestClient) -> None:
    base_docs(client)
    add_doc(client, "marriage_certificate")
    p1 = new_plan(client, [AADHAAR_NAME])
    p2 = new_plan(client, [AADHAAR_NAME, PASSPORT_NAME])
    r = client.put(f"/api/me/progress/{AADHAAR_NAME}", headers=HA, json={"state": "completed"})
    assert r.json()["progress"] == {AADHAAR_NAME: "completed"}
    assert {c["plan_id"] for c in r.json()["plan_changes"]} == {p1["id"], p2["id"]}
    assert steps(plan(client, p1["id"]))[AADHAAR_NAME] == "completed"
    r = client.put(f"/api/me/progress/{AADHAAR_NAME}", headers=HA, json={"state": "not_started"})
    assert r.json()["progress"] == {}
    assert (
        client.put(
            "/api/me/progress/no-such-service", headers=HA, json={"state": "started"}
        ).status_code
        == 422
    )
    assert (
        client.put(
            f"/api/me/progress/{AADHAAR_NAME}", headers=HA, json={"state": "done"}
        ).status_code
        == 422
    )


def test_import_never_overwrites_account_progress(client: TestClient) -> None:
    client.put(f"/api/me/progress/{AADHAAR_NAME}", headers=HA, json={"state": "submitted"})
    p = new_plan(
        client,
        [AADHAAR_NAME, PASSPORT_NAME],
        source="import",
        progress={AADHAAR_NAME: "started", PASSPORT_NAME: "started"},
        held_documents=[{"document_type": "passport_existing", "status": "valid"}],
    )
    assert client.get("/api/me/progress", headers=HA).json()["progress"] == {
        AADHAAR_NAME: "submitted",
        PASSPORT_NAME: "started",
    }
    created = next(e for e in activity(client) if e["event_type"] == "plan_created")
    assert created["details"]["source"] == "import"
    assert created["details"]["progress_imported"] == [PASSPORT_NAME]
    assert p["created_document_ids"]


def test_archived_plans_are_frozen_until_restored(client: TestClient) -> None:
    base_docs(client)
    cert = add_doc(client, "marriage_certificate").json()["document"]
    p = new_plan(client, [AADHAAR_NAME])
    client.post(f"/api/me/plans/{p['id']}/archive", headers=HA)
    r = client.patch(f"/api/me/documents/{cert['id']}", headers=HA, json={"status": "expired"})
    assert r.json()["plan_changes"] == []
    assert steps(plan(client, p["id"]))[AADHAAR_NAME] == "ready"  # snapshot frozen
    restored = client.post(f"/api/me/plans/{p['id']}/restore", headers=HA).json()
    assert steps(restored)[AADHAAR_NAME] != "ready"  # caught up on restore


# ---------------------------------------------------------------- history


def test_history_records_meaningful_changes_without_sensitive_text(client: TestClient) -> None:
    doc = add_doc(client, "passport_existing", label="Mine", note="in the blue folder").json()[
        "document"
    ]
    client.patch(
        f"/api/me/documents/{doc['id']}", headers=HA, json={"note": "drawer", "status": "expired"}
    )
    client.delete(f"/api/me/documents/{doc['id']}", headers=HA)
    events = activity(client)
    assert [e["event_type"] for e in events[:3]] == [
        "document_removed",
        "document_updated",
        "document_added",
    ]
    updated = events[1]["details"]
    assert updated["changes"]["status"] == ["valid", "expired"]
    assert updated["changes"]["note"] == "changed"
    raw = str(events)
    assert "blue folder" not in raw and "drawer" not in raw and "Mine" not in raw


def test_history_is_read_only_through_the_api(client: TestClient) -> None:
    add_doc(client, "pan_card")
    event = activity(client)[0]
    for method in ("put", "patch", "delete", "post"):
        r = getattr(client, method)(f"/api/me/activity/{event['id']}", headers=HA)
        assert r.status_code in (404, 405)
    for method in ("put", "patch", "delete", "post"):
        assert getattr(client, method)("/api/me/activity", headers=HA).status_code == 405
    assert activity(client)[0] == event


def test_history_pagination(client: TestClient) -> None:
    for d in ("pan_card", "aadhaar_number", "passport_existing"):
        add_doc(client, d)
    first = client.get("/api/me/activity", headers=HA, params={"limit": 2}).json()
    assert len(first["events"]) == 2 and first["next_before_id"]
    rest = client.get(
        "/api/me/activity", headers=HA, params={"limit": 2, "before_id": first["next_before_id"]}
    ).json()
    assert len(rest["events"]) == 1 and rest["next_before_id"] is None


async def test_progress_rows_are_per_user(seeded_factory) -> None:
    async with seeded_factory() as s:
        s.add(ServiceProgress(user_id=A, service_id=AADHAAR_NAME, state="started"))
        s.add(ServiceProgress(user_id=B, service_id=AADHAAR_NAME, state="completed"))
        await s.commit()
        rows = (await s.execute(select(ServiceProgress))).scalars().all()
        assert {(r.user_id, r.state.value) for r in rows} == {(A, "started"), (B, "completed")}
        assert (await s.execute(select(ActivityEvent))).first() is None
