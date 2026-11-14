"""POST /api/assistant/query: validation, success shape, failure mapping (fake Gemini)."""

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import get_session
from app.llm.client import GeminiClient
from app.main import create_app
from app.rag.assistant import Assistant
from tests.conftest import RAG_SETTINGS
from tests.rag_fakes import api_error, fake_gemini, quota_error, rate_limit_error

URL = "/api/assistant/query"


@pytest.fixture
def assistant_api(rag_factory):
    app = create_app()

    async def _session():
        async with rag_factory() as s:
            yield s

    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_settings] = lambda: RAG_SETTINGS
    client, models = fake_gemini(RAG_SETTINGS)
    app.state.assistant = Assistant(RAG_SETTINGS, client)
    return TestClient(app), models


def test_success_response_shape(assistant_api):
    api, models = assistant_api
    res = api.post(
        URL, json={"question": "Which proof of address for passport reissue?", "language": "en"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["generated_by"] == "ai" and body["label"].startswith("AI-generated")
    assert body["citations"][0]["id"] == "S1" and body["citations"][0]["source_url"].startswith(
        "https://"
    )
    assert body["evidence_status"] == "sufficient" and body["workflow"] is None


def test_workflow_context_echoes_planner_output(assistant_api):
    api, _ = assistant_api
    res = api.post(
        URL,
        json={
            "question": "What next?",
            "workflow": {
                "target_service_ids": ["aadhaar-address-update", "driving-licence-address-change"],
                "owned_document_ids": [
                    "aadhaar_number",
                    "driving_licence_existing",
                    "electricity_bill",
                ],
            },
        },
    )
    wf = res.json()["workflow"]
    assert wf["generated_by"] == "deterministic-planner"
    assert wf["next_action"]["service_id"] == "aadhaar-address-update"
    assert {s["service_id"]: s["status"] for s in wf["steps"]}[
        "driving-licence-address-change"
    ] == "waiting"


@pytest.mark.parametrize(
    "body",
    [
        {"question": ""},
        {"question": "  a "},
        {"question": "x" * 1001},
        {"question": "Passport?", "language": "fr"},
        {"question": "Passport?", "extra": 1},
        {"question": "Passport?", "workflow": {"target_service_ids": []}},
    ],
)
def test_validation_errors(assistant_api, body):
    api, models = assistant_api
    assert api.post(URL, json=body).status_code == 422
    assert models.generate_calls == [] and models.embed_calls == []


def test_unknown_workflow_ids(assistant_api):
    api, _ = assistant_api
    res = api.post(
        URL, json={"question": "What next?", "workflow": {"target_service_ids": ["nope"]}}
    )
    assert res.status_code == 422 and res.json()["detail"]["code"] == "unknown_ids"


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (quota_error(), 429, "quota_exhausted"),
        (rate_limit_error("120s"), 429, "rate_limited"),
        (api_error(503, "UNAVAILABLE"), 503, "model_unavailable"),
        (api_error(400, "INVALID_ARGUMENT"), 502, "model_error"),
    ],
)
def test_model_failures_are_mapped_without_leaking_details(assistant_api, error, status, code):
    api, models = assistant_api
    models.generate_errors = [error] * 5
    res = api.post(URL, json={"question": "Passport proof of address?", "language": "en"})
    assert res.status_code == status
    detail = res.json()["detail"]
    assert detail["code"] == code
    assert "RESOURCE_EXHAUSTED" not in res.text and "INVALID_ARGUMENT" not in res.text
    assert "You are GovPath AI" not in res.text  # prompts never leak


def test_rate_limit_includes_retry_after(assistant_api):
    api, models = assistant_api
    models.generate_errors = [rate_limit_error("120s")]
    res = api.post(URL, json={"question": "Passport proof of address?", "language": "en"})
    assert res.headers.get("retry-after") == "120"


def test_not_configured_and_index_not_built(seeded_factory):
    app = create_app()

    async def _session():
        async with seeded_factory() as s:  # no chunks
            yield s

    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_settings] = lambda: RAG_SETTINGS
    app.state.assistant = Assistant(RAG_SETTINGS, GeminiClient(RAG_SETTINGS))  # no API key
    api = TestClient(app)
    res = api.post(URL, json={"question": "Passport proof?"})
    assert res.status_code == 503 and res.json()["detail"]["code"] == "assistant_not_configured"

    client, _ = fake_gemini(RAG_SETTINGS)
    app.state.assistant = Assistant(RAG_SETTINGS, client)
    res = api.post(URL, json={"question": "Passport proof?"})
    assert res.status_code == 503 and res.json()["detail"]["code"] == "index_not_built"


def _assistant_plan(api, **workflow):
    body = {"target_service_ids": ["aadhaar-address-update"], **workflow}
    body.setdefault("owned_document_ids", ["aadhaar_number", "electricity_bill"])
    res = api.post(URL, json={"question": "What next?", "workflow": body})
    assert res.status_code == 200, res.text
    return {s["service_id"]: s["status"] for s in res.json()["workflow"]["steps"]}


def test_assistant_plans_with_reported_progress(assistant_api):
    api, _ = assistant_api
    assert _assistant_plan(api)["aadhaar-address-update"] == "ready"
    steps = _assistant_plan(api, progress={"aadhaar-address-update": "submitted"})
    assert steps["aadhaar-address-update"] == "in_progress"


def test_assistant_plans_with_document_states(assistant_api):
    api, _ = assistant_api
    steps = _assistant_plan(api, document_states={"electricity_bill": "expired"})
    assert steps["aadhaar-address-update"] == "blocked"


def test_assistant_plans_with_citizen_state(rag_factory, assistant_api):
    api, models = assistant_api
    wf = {
        "target_service_ids": ["aadhaar-name-update"],
        "owned_document_ids": ["aadhaar_number"],
    }
    res = api.post(URL, json={"question": "What next?", "workflow": {**wf, "state": "Delhi"}})
    delhi = {s["service_id"] for s in res.json()["workflow"]["steps"]}
    res = api.post(URL, json={"question": "What next?", "workflow": {**wf, "state": "Maharashtra"}})
    elsewhere = {s["service_id"] for s in res.json()["workflow"]["steps"]}
    assert "marriage-registration-delhi" in delhi and "marriage-registration-delhi" not in elsewhere
    prompt = models.generate_calls[-1]["contents"]
    assert "Citizen's state/UT: Maharashtra" in prompt
