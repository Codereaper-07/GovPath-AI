"""Offline Supabase Auth fakes: an ES256 key pair, its JWKS, and access-token minting."""

import json
import time
import uuid

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm

from app.auth import TokenVerifier
from app.config import Settings

SUPABASE_URL = "https://example-project.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"
KID = "test-key-1"
AUTH_SETTINGS = Settings(
    _env_file=None, database_url=None, gemini_api_key=None, supabase_url=SUPABASE_URL
)

PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_KEY = ec.generate_private_key(ec.SECP256R1())  # not published in the JWKS


def jwks() -> dict:
    jwk = json.loads(ECAlgorithm.to_jwk(PRIVATE_KEY.public_key()))
    return {"keys": [{**jwk, "kid": KID, "alg": "ES256", "use": "sig"}]}


def make_verifier() -> TokenVerifier:
    client = jwt.PyJWKClient(f"{ISSUER}/.well-known/jwks.json", cache_keys=True)
    client.fetch_data = jwks  # type: ignore[method-assign]  # never touches the network
    return TokenVerifier(AUTH_SETTINGS, jwks_client=client)


def make_token(
    user_id: uuid.UUID | str | None = None,
    *,
    key=PRIVATE_KEY,
    algorithm: str = "ES256",
    kid: str = KID,
    expires_in: int = 3600,
    drop: tuple[str, ...] = (),
    **claims,
) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user_id or uuid.uuid4()),
        "aud": "authenticated",
        "iss": ISSUER,
        "role": "authenticated",
        "email": "citizen@example.com",
        "iat": now,
        "exp": now + expires_in,
        **claims,
    }
    for k in drop:
        payload.pop(k, None)
    return jwt.encode(payload, key, algorithm=algorithm, headers={"kid": kid})


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
