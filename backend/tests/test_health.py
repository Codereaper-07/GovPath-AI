from fastapi.testclient import TestClient


def test_health_ok(client: TestClient) -> None:
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["app"] == "GovPath AI"


def test_db_health_reports_unconfigured(client: TestClient) -> None:
    res = client.get("/api/health/db")
    assert res.status_code == 200
    assert res.json()["status"] == "unconfigured"
    assert res.json()["pgvector"] is None


def test_cors_allows_frontend_origin(client: TestClient) -> None:
    res = client.options(
        "/api/health",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert res.headers.get("access-control-allow-origin") == "http://localhost:5173"
