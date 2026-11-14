"""REST API: services, documents and workflow planning (isolated SQLite, seeded)."""

AADHAAR = "aadhaar-address-update"
DL = "driving-licence-address-change"


def test_list_services(api_client):
    res = api_client.get("/api/services")
    assert res.status_code == 200
    services = res.json()
    assert len(services) == 10
    assert all(s["life_events"] for s in services)
    aadhaar = next(s for s in services if s["id"] == AADHAAR)
    assert aadhaar["authority"].startswith("Unique Identification Authority")
    assert aadhaar["last_verified_at"].startswith("2026-11-14")
    assert aadhaar["mandatory_requirement_count"] == 2
    assert aadhaar["requirement_count"] == aadhaar["verified_requirement_count"] == 3
    assert all(s["name_hi"] and s["description_hi"] for s in services)
    assert "id" in aadhaar and not any(
        k.endswith("_id") and isinstance(v, int) for k, v in aadhaar.items()
    )


def test_service_detail_includes_requirements_and_evidence(api_client):
    res = api_client.get(f"/api/services/{AADHAAR}")
    assert res.status_code == 200
    body = res.json()
    poa = next(r for r in body["requirements"] if r["id"] == f"{AADHAAR}.proof-of-address")
    assert poa["requirement_type"] == "mandatory" and poa["is_alternative_group"] is True
    assert poa["verification_status"] == "verified"
    passport = next(o for o in poa["options"] if o["document_id"] == "passport_current_address")
    assert passport["evidence"]["source_url"].startswith("https://backend.uidai.gov.in/")
    assert passport["evidence"]["excerpt"] == "1. Valid Indian Passport"  # quotes stay verbatim
    assert passport["document_name_hi"] == "वर्तमान पते वाला भारतीय पासपोर्ट"
    assert poa["name_hi"] == "नए पते का प्रमाण (कोई एक)"
    assert body["outputs"][0]["document_id"] == "aadhaar_current_address"
    assert body["prerequisites"] == []


def test_service_detail_not_found_and_invalid_id(api_client):
    assert api_client.get("/api/services/no-such-service").status_code == 404
    assert api_client.get("/api/services/Bad_ID!").status_code == 422


def test_list_documents(api_client):
    res = api_client.get("/api/documents")
    assert res.status_code == 200
    docs = {d["id"]: d for d in res.json()}
    assert len(docs) == 55
    assert all(d["name_hi"] for d in docs.values())
    assert docs["aadhaar_current_address"]["issued_by_service_ids"] == [AADHAAR]
    assert DL in docs["aadhaar_current_address"]["accepted_by_service_ids"]
    assert docs["electricity_bill"]["issued_by_service_ids"] == []


def test_plan_success(api_client):
    res = api_client.post(
        "/api/workflows/plan",
        json={
            "target_service_ids": [AADHAAR, DL],
            "owned_document_ids": [
                "aadhaar_number",
                "driving_licence_existing",
                "electricity_bill",
            ],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["generated_by"] == "deterministic-planner"
    assert [s["service_id"] for s in body["steps"]] == [AADHAAR, DL]
    assert body["steps"][1]["status"] == "waiting"
    assert body["next_action"]["type"] == "start_service"
    assert body["next_action"]["service_id"] == AADHAAR
    assert body["next_action"]["reason"]["code"] == "unblocks_downstream"
    assert body["acquisition_routes"][0]["document_id"] == "aadhaar_current_address"
    assert body["documents"]["electricity_bill"]["name"].startswith("Electricity bill")
    assert body["documents"]["electricity_bill"]["name_hi"] == "वर्तमान पते का बिजली बिल"
    assert body["services"][AADHAAR]["name_hi"] == "आधार में पता अपडेट"
    req_ids = {r["requirement_id"] for s in body["steps"] for r in s["requirements"]}
    assert req_ids == set(body["requirements"]) and all(
        v["name_hi"] for v in body["requirements"].values()
    )
    assert body["evidence"] and all(
        e["source_url"].startswith("https://") for e in body["evidence"]
    )


def test_plan_replanning_with_completed_service(api_client):
    res = api_client.post(
        "/api/workflows/plan",
        json={
            "target_service_ids": [AADHAAR, DL],
            "owned_document_ids": [
                "aadhaar_number",
                "driving_licence_existing",
                "electricity_bill",
            ],
            "completed_service_ids": [AADHAAR],
        },
    )
    assert res.status_code == 200
    assert [s["service_id"] for s in res.json()["steps"]] == [DL]
    assert res.json()["steps"][0]["status"] == "ready"


def test_plan_unknown_ids(api_client):
    res = api_client.post(
        "/api/workflows/plan",
        json={"target_service_ids": ["nope"], "owned_document_ids": ["ghost"]},
    )
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["code"] == "unknown_ids"
    assert detail["unknown_service_ids"] == ["nope"]
    assert detail["unknown_document_ids"] == ["ghost"]


def test_plan_validation_errors(api_client):
    for body in (
        {"target_service_ids": []},
        {"target_service_ids": [""]},
        {"owned_document_ids": ["x"]},
        {"target_service_ids": [AADHAAR], "unexpected": True},
        {"target_service_ids": "not-a-list"},
    ):
        assert api_client.post("/api/workflows/plan", json=body).status_code == 422, body


def test_endpoints_return_503_without_database(client):
    assert client.get("/api/services").status_code == 503
    res = client.post("/api/workflows/plan", json={"target_service_ids": [AADHAAR]})
    assert res.status_code == 503


def test_plan_with_progress_document_states_and_state(api_client):
    body = {
        "target_service_ids": ["driving-licence-address-change"],
        "owned_document_ids": ["driving_licence_existing", "aadhaar_number", "electricity_bill"],
        "progress": {"aadhaar-address-update": "submitted"},
        "document_states": {"electricity_bill": "available"},
        "state": "Maharashtra",
    }
    r = api_client.post("/api/workflows/plan", json=body)
    assert r.status_code == 200
    data = r.json()
    statuses = {s["service_id"]: s["status"] for s in data["steps"]}
    assert statuses == {
        "aadhaar-address-update": "in_progress",
        "driving-licence-address-change": "waiting",
    }
    assert data["next_action"]["type"] == "follow_up"
    assert data["progress"]["in_progress"] == 1 and data["progress"]["completed_verified"] == 0
    assert data["citizen_state"] == "Maharashtra"
    step = data["steps"][0]
    assert step["authority"] and step["completion_document_ids"] == ["aadhaar_current_address"]
    assert "aadhaar_current_address" in data["documents"]


def test_plan_rejects_bad_progress_values(api_client):
    body = {"target_service_ids": ["instant-e-pan"], "progress": {"instant-e-pan": "approved"}}
    assert api_client.post("/api/workflows/plan", json=body).status_code == 422
    body = {"target_service_ids": ["instant-e-pan"], "progress": {"nope": "started"}}
    assert (
        api_client.post("/api/workflows/plan", json=body).json()["detail"]["code"] == "unknown_ids"
    )


def test_discover_endpoint(api_client):
    r = api_client.post(
        "/api/workflows/discover",
        json={"goals": ["update-name-after-marriage"], "state": "delhi",
              "held_document_ids": ["aadhaar_number", "passport_existing"]},
    )  # fmt: skip
    assert r.status_code == 200
    data = r.json()
    assert data["generated_by"] == "deterministic-discovery" and data["state"] == "Delhi"
    assert set(data["recommended_target_ids"]) == {
        "aadhaar-name-update",
        "passport-reissue-name-change-marriage",
    }
    assert data["services"]["aadhaar-name-update"]["name_hi"]
    bad = api_client.post("/api/workflows/discover", json={"goals": ["win-lottery"]})
    assert bad.status_code == 422


def test_vocabulary_endpoint(client):
    data = client.get("/api/workflows/vocabulary").json()
    assert "update-address" in data["goals"] and "Delhi" in data["states"]
    assert len(data["states"]) == 36
