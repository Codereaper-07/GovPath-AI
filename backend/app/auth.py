"""Supabase Auth access-token verification and the `get_current_user` dependency.

The user's identity comes only from a verified access token (`sub` claim), never from anything
the client sends in a body or query string. Tokens are verified locally against the project's
public signing keys (JWKS, asymmetric ES256/RS256), with signature, expiry, issuer, audience and
role checks. Symmetric (HS256, legacy shared-secret) tokens are rejected: the project publishes
asymmetric keys, and no secret is ever configured here.
"""

import asyncio
import logging
import ssl
import time
import uuid
from dataclasses import dataclass
from typing import Annotated

import certifi
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings

logger = logging.getLogger(__name__)

ALLOWED_ALGORITHMS = ("ES256", "RS256")
LEEWAY_SECONDS = 30
KEY_REFRESH_SECONDS = 60


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    id: uuid.UUID
    email: str | None
    full_name: str | None  # from sign-up metadata; only used to seed a new profile


class AuthError(Exception):
    """Token rejected. `code` is a stable machine-readable reason."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class AuthUnavailableError(Exception):
    """The signing keys could not be fetched (network / Supabase outage)."""


class TokenVerifier:
    """Verifies Supabase access tokens. Keys are fetched lazily (never at startup) and cached."""

    def __init__(self, settings: Settings, jwks_client: jwt.PyJWKClient | None = None) -> None:
        if not settings.supabase_url:
            raise ValueError("SUPABASE_URL is not configured")
        base = settings.supabase_url.rstrip("/")
        self.issuer = f"{base}/auth/v1"
        self.audience = settings.supabase_jwt_audience
        self._jwks = jwks_client or jwt.PyJWKClient(
            f"{self.issuer}/.well-known/jwks.json",
            cache_keys=True,
            lifespan=settings.supabase_jwks_cache_seconds,
            timeout=10,
            # Some Python builds (e.g. python.org macOS) ship without CA certificates.
            ssl_context=ssl.create_default_context(cafile=certifi.where()),
        )
        self._last_refresh = float("-inf")

    def _signing_key(self, token: str) -> jwt.PyJWK:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise AuthError("invalid_token", "Malformed access token.") from exc
        if header.get("alg") not in ALLOWED_ALGORITHMS:
            raise AuthError("invalid_token", "Unsupported token signing algorithm.")
        kid = header.get("kid")
        try:
            keys = {k.key_id: k for k in self._jwks.get_signing_keys()}  # cached
            # An unknown kid may mean the project rotated its keys: refetch, but at most once
            # per KEY_REFRESH_SECONDS, so junk tokens cannot trigger a fetch per request.
            now = time.monotonic()
            if kid not in keys and now - self._last_refresh >= KEY_REFRESH_SECONDS:
                self._last_refresh = now
                keys = {k.key_id: k for k in self._jwks.get_signing_keys(refresh=True)}
        except jwt.PyJWKClientConnectionError as exc:
            logger.warning("Could not fetch Supabase signing keys: %s", exc)
            raise AuthUnavailableError("Signing keys unavailable") from exc
        except jwt.PyJWKClientError as exc:  # e.g. an empty key set
            raise AuthError("invalid_token", "No usable signing key.") from exc
        jwk = keys.get(kid)
        if jwk is None:
            raise AuthError("invalid_token", "Unknown signing key.")
        # Only the published key's own algorithm is accepted (no algorithm confusion).
        if jwk.algorithm_name not in ALLOWED_ALGORITHMS or header.get("alg") != jwk.algorithm_name:
            raise AuthError("invalid_token", "Token algorithm does not match the signing key.")
        return jwk

    def verify_sync(self, token: str) -> AuthenticatedUser:
        jwk = self._signing_key(token)
        try:
            claims = jwt.decode(
                token,
                jwk.key,
                algorithms=[jwk.algorithm_name],
                audience=self.audience,
                issuer=self.issuer,
                leeway=LEEWAY_SECONDS,
                options={"require": ["exp", "iat", "sub", "iss", "aud"]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise AuthError("token_expired", "The session has expired.") from exc
        except jwt.PyJWTError as exc:
            raise AuthError("invalid_token", "Invalid access token.") from exc
        # The anon/publishable key and service tokens are JWTs too; only signed-in users pass.
        if claims.get("role") != "authenticated":
            raise AuthError("invalid_token", "Not a signed-in user token.")
        try:
            user_id = uuid.UUID(str(claims["sub"]))
        except ValueError as exc:
            raise AuthError("invalid_token", "Invalid subject.") from exc
        meta = claims.get("user_metadata") or {}
        name = meta.get("full_name") if isinstance(meta, dict) else None
        email = claims.get("email")
        return AuthenticatedUser(
            id=user_id,
            email=email if isinstance(email, str) else None,
            full_name=(name.strip()[:120] or None) if isinstance(name, str) else None,
        )

    async def verify(self, token: str) -> AuthenticatedUser:
        # Key fetching is blocking I/O (urllib); keep it off the event loop.
        return await asyncio.to_thread(self.verify_sync, token)


def build_token_verifier(settings: Settings) -> TokenVerifier | None:
    return TokenVerifier(settings) if settings.auth_configured else None


def get_token_verifier(request: Request) -> TokenVerifier | None:
    return request.app.state.token_verifier


_bearer = HTTPBearer(auto_error=False)


def _unauthorized(code: str, message: str) -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        {"code": code, "message": message},
        headers={"WWW-Authenticate": f'Bearer error="{code}"'},
    )


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    verifier: Annotated[TokenVerifier | None, Depends(get_token_verifier)],
) -> AuthenticatedUser:
    """FastAPI dependency: the signed-in user, or 401. 503 when auth is not configured."""
    if verifier is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            {"code": "auth_not_configured", "message": "Sign-in is not configured."},
        )
    if credentials is None or credentials.scheme.lower() != "bearer" or not credentials.credentials:
        raise _unauthorized("missing_token", "Sign in to continue.")
    try:
        return await verifier.verify(credentials.credentials)
    except AuthError as exc:
        raise _unauthorized(exc.code, str(exc)) from exc
    except AuthUnavailableError as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            {"code": "auth_unavailable", "message": "Sign-in is temporarily unavailable."},
        ) from exc


CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]
