"""Supabase access-token verification and the signed-in citizen's profile API (offline)."""

import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.auth import AuthError, AuthUnavailableError, TokenVerifier, get_token_verifier
from app.config import get_settings
from app.db import get_session
from app.main import create_app
from tests.auth_fakes import (
    AUTH_SETTINGS,
    ISSUER,
    OTHER_KEY,
    bearer,
    make_token,
    make_verifier,
)

USER_A = uuid.UUID("11111111-1111-4111-8111-111111111111")
USER_B = uuid.UUID("22222222-2222-4222-8222-222222222222")


# ---- token verification -------------------------------------------------------------------


def test_valid_token_gives_identity_from_sub() -> None:
    token = make_token(USER_A, user_metadata={"full_name": "  Asha Verma "})
    user = make_verifier().verify_sync(token)
    assert user.id == USER_A
    assert user.email == "citizen@example.com"
    assert user.full_name == "Asha Verma"


@pytest.mark.parametrize(
    ("token_kwargs", "code"),
    [
        ({"expires_in": -120}, "token_expired"),
        ({"aud": "anon"}, "invalid_token"),
        ({"iss": "https://evil.example.com/auth/v1"}, "invalid_token"),
        ({"key": OTHER_KEY}, "invalid_token"),  # signed by a key not in the JWKS
        ({"kid": "unknown-kid"}, "invalid_token"),
        ({"role": "anon"}, "invalid_token"),  # the publishable/anon key is a JWT too
        ({"role": "service_role"}, "invalid_token"),
        ({"drop": ("sub",)}, "invalid_token"),
        ({"drop": ("exp",)}, "invalid_token"),
        ({"user_id": "not-a-uuid"}, "invalid_token"),
    ],
)
def test_rejected_tokens(token_kwargs: dict, code: str) -> None:
    with pytest.raises(AuthError) as err:
        make_verifier().verify_sync(make_token(**token_kwargs))
    assert err.value.code == code


def test_symmetric_and_unsigned_tokens_are_rejected() -> None:
    now = int(time.time())
    claims = {
        "sub": str(USER_A),
        "aud": "authenticated",
        "iss": ISSUER,
        "role": "authenticated",
        "iat": now,
        "exp": now + 600,
    }
    hs = jwt.encode(claims, "a-shared-secret-of-at-least-32-bytes!!", algorithm="HS256")
    unsigned = jwt.encode(claims, None, algorithm="none")
    for token in (hs, unsigned, "not.a.jwt", "garbage"):
        with pytest.raises(AuthError):
            make_verifier().verify_sync(token)


def test_algorithm_not_matching_the_published_key_is_rejected() -> None:
    rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(AuthError):
        make_verifier().verify_sync(make_token(key=rsa_key, algorithm="RS256"))


def test_jwks_outage_is_unavailable_not_unauthorised() -> None:
    client = jwt.PyJWKClient(f"{ISSUER}/.well-known/jwks.json")

    def _down():
        raise jwt.PyJWKClientConnectionError("down")

    client.fetch_data = _down  # type: ignore[method-assign]
    with pytest.raises(AuthUnavailableError):
        TokenVerifier(AUTH_SETTINGS, jwks_client=client).verify_sync(make_token())


def test_unknown_key_ids_refetch_keys_at_most_once_per_interval() -> None:
    verifier = make_verifier()
    calls = 0
    original = verifier._jwks.fetch_data

    def _counting():
        nonlocal calls
        calls += 1
        return original()

    verifier._jwks.fetch_data = _counting  # type: ignore[method-assign]
    for _ in range(5):
        with pytest.raises(AuthError):
            verifier.verify_sync(make_token(kid="junk"))
    assert calls == 2  # the first load + one refresh for the unknown kid
    assert verifier.verify_sync(make_token(USER_A)).id == USER_A  # known kid: cached
    assert calls == 2


def test_real_jwks_is_never_fetched_in_tests() -> None:
    verifier = TokenVerifier(AUTH_SETTINGS)  # real PyJWKClient, network blocked by conftest
    with pytest.raises(RuntimeError, match="must not contact Supabase"):
        verifier.verify_sync(make_token())


def test_issuer_is_derived_from_project_url() -> None:
    assert make_verifier().issuer == ISSUER
    assert make_verifier().audience == "authenticated"


# ---- profile API --------------------------------------------------------------------------


@pytest.fixture
def auth_client(session_factory) -> TestClient:
    application = create_app()

    async def _session():
        async with session_factory() as s:
            yield s

    verifier = make_verifier()
    application.dependency_overrides[get_session] = _session
    application.dependency_overrides[get_settings] = lambda: AUTH_SETTINGS
    application.dependency_overrides[get_token_verifier] = lambda: verifier
    return TestClient(application)


def _get(client: TestClient, user: uuid.UUID, **claims):
    return client.get("/api/me/profile", headers=bearer(make_token(user, **claims)))


def test_profile_requires_a_token(auth_client: TestClient) -> None:
    r = auth_client.get("/api/me/profile")
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "missing_token"
    assert r.headers["www-authenticate"].startswith("Bearer")
    r = auth_client.patch("/api/me/profile", json={"city": "Pune"})
    assert r.status_code == 401


def test_invalid_and_expired_tokens_are_401(auth_client: TestClient) -> None:
    r = auth_client.get("/api/me/profile", headers=bearer("garbage"))
    assert (r.status_code, r.json()["detail"]["code"]) == (401, "invalid_token")
    r = auth_client.get("/api/me/profile", headers=bearer(make_token(USER_A, expires_in=-120)))
    assert (r.status_code, r.json()["detail"]["code"]) == (401, "token_expired")
    r = auth_client.get("/api/me/profile", headers={"Authorization": "Basic abc"})
    assert r.status_code == 401


def test_auth_not_configured_is_503(session_factory) -> None:
    application = create_app()

    async def _session():
        async with session_factory() as s:
            yield s

    application.dependency_overrides[get_session] = _session
    application.dependency_overrides[get_token_verifier] = lambda: None
    r = TestClient(application).get("/api/me/profile", headers=bearer(make_token()))
    assert (r.status_code, r.json()["detail"]["code"]) == (503, "auth_not_configured")


def test_profile_created_on_first_access_with_signup_name(auth_client: TestClient) -> None:
    r = _get(auth_client, USER_A, user_metadata={"full_name": "Asha Verma"})
    assert r.status_code == 200
    body = r.json()
    assert body["user_id"] == str(USER_A)
    assert body["full_name"] == "Asha Verma"
    assert body["preferred_language"] == "en"
    assert body["state"] is None and body["city"] is None
    assert body["email"] == "citizen@example.com"
    # Second access returns the same row (no duplicate, metadata no longer overrides it).
    r2 = _get(auth_client, USER_A, user_metadata={"full_name": "Someone Else"})
    assert r2.json()["full_name"] == "Asha Verma"
    assert r2.json()["created_at"] == body["created_at"]


def test_profile_update_partial_and_validated(auth_client: TestClient) -> None:
    h = bearer(make_token(USER_A))
    r = auth_client.patch(
        "/api/me/profile",
        json={"full_name": " Asha  Verma ", "state": "new delhi", "city": "  South Delhi "},
    )
    assert r.status_code == 401  # no token
    r = auth_client.patch(
        "/api/me/profile",
        headers=h,
        json={"full_name": " Asha  Verma ", "state": "new delhi", "city": "  South Delhi "},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["full_name"], body["state"], body["city"]) == (
        "Asha Verma",
        "Delhi",
        "South Delhi",
    )
    # Only the fields sent change; blank clears.
    r = auth_client.patch("/api/me/profile", headers=h, json={"preferred_language": "hi"})
    assert r.json()["preferred_language"] == "hi" and r.json()["state"] == "Delhi"
    r = auth_client.patch("/api/me/profile", headers=h, json={"city": "   "})
    assert r.json()["city"] is None and r.json()["full_name"] == "Asha Verma"
    assert _get(auth_client, USER_A).json()["preferred_language"] == "hi"


@pytest.mark.parametrize(
    "payload",
    [
        {"state": "Atlantis"},
        {"preferred_language": "fr"},
        {"preferred_language": None},
        {"full_name": "x" * 121},
        {"city": "x" * 121},
        {"user_id": str(USER_B)},  # identity can never be chosen by the client
        {"id": str(USER_B), "city": "Pune"},
    ],
)
def test_profile_update_rejects_bad_input(auth_client: TestClient, payload: dict) -> None:
    r = auth_client.patch("/api/me/profile", headers=bearer(make_token(USER_A)), json=payload)
    assert r.status_code == 422


def test_users_cannot_read_or_modify_each_other(auth_client: TestClient) -> None:
    a, b = bearer(make_token(USER_A)), bearer(make_token(USER_B))
    auth_client.patch("/api/me/profile", headers=a, json={"full_name": "Asha", "city": "Pune"})
    # B sees only B's own (new, empty) profile, whatever B sends.
    r = auth_client.get("/api/me/profile", headers=b, params={"user_id": str(USER_A)})
    assert r.json()["user_id"] == str(USER_B)
    assert r.json()["full_name"] is None and r.json()["city"] is None
    r = auth_client.patch(
        "/api/me/profile", headers=b, json={"user_id": str(USER_A), "full_name": "Hacked"}
    )
    assert r.status_code == 422
    auth_client.patch("/api/me/profile", headers=b, json={"full_name": "Bala"})
    # A's profile is untouched; a token signed by an unpublished key cannot impersonate A.
    assert _get(auth_client, USER_A).json()["full_name"] == "Asha"
    forged = make_token(USER_A, key=OTHER_KEY)
    r = auth_client.patch("/api/me/profile", headers=bearer(forged), json={"full_name": "Hacked"})
    assert r.status_code == 401
    assert _get(auth_client, USER_A).json()["full_name"] == "Asha"


def test_public_endpoints_still_need_no_sign_in(api_client: TestClient) -> None:
    assert api_client.get("/api/services").status_code == 200
    r = api_client.post(
        "/api/workflows/plan", json={"target_service_ids": ["aadhaar-address-update"]}
    )
    assert r.status_code == 200
