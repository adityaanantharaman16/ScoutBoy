"""The authenticated-user boundary for private `/api/me/*` endpoints.

ScoutBoy does not implement identity. Clerk owns sign-up, sign-in, passwords,
password reset, email verification, session lifetime and key rotation. This
module owns exactly one question: *does this request carry a token that Clerk
really minted, for this instance, that has not expired, and whose subject is
therefore safe to attach a favourites list to?*

Why manual verification rather than Clerk's Python SDK
------------------------------------------------------
`clerk-backend-api` is the official SDK, but every release from 5.0.0 onward
requires Python >= 3.10, while this repository declares `requires-python =
">=3.9"` and CI runs a 3.9 matrix leg. Pinning the SDK back to the last 3.9-
compatible release (2.x, several majors behind) would be a worse security
posture than the alternative, and dropping 3.9 is a stack change this phase has
no mandate to make. So this uses Clerk's other documented backend mechanism:
manual JWT verification against the instance's published JWKS, checking the
claims Clerk's manual-verification guide names — signature (RS256), `exp`,
`nbf`, `iss` and `azp`. Clerk still mints and rotates the keys; nothing here is a
home-grown identity system, and no password or session material is handled.

What is deliberately NOT trusted
--------------------------------
The subject comes from the verified token and from nowhere else. No request
body, path parameter, query string or header outside `Authorization` can name a
user, so a caller cannot address another account by asking politely. CORS is not
part of this: it constrains which browser origins may *make* a request, and says
nothing about who the requester is.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any, Optional, Protocol

import jwt
from fastapi import Depends, Header
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.db import get_db
from app.core.errors import AuthDisabledError, AuthenticationError
from app.models.orm import AppUser

#: The only signing algorithm a Clerk session token is ever accepted under.
#: Pinned so a token presenting `alg: none`, or an HMAC token forged with a
#: public key as its secret, is rejected before any key lookup happens.
ALLOWED_ALGORITHMS = ["RS256"]

#: Advertised in OpenAPI so the contract states how `/api/me/*` is authenticated.
#: `auto_error=False` because a missing header must produce this module's own
#: 401 shape rather than HTTPBearer's, and because the auth-disabled deployment
#: has to answer 503 before authentication is even considered.
bearer_scheme = HTTPBearer(auto_error=False, description="Clerk session token")


@dataclass(frozen=True)
class VerifiedIdentity:
    """The only facts taken from a verified token."""

    issuer: str
    subject: str


class SigningKeyResolver(Protocol):
    """Supplies the public key a given token should be verified against.

    Narrow on purpose: production satisfies it with `jwt.PyJWKClient`, and tests
    satisfy it with a locally generated key pair, so the deterministic suite
    exercises the real signature/claim path rather than stubbing verification
    out. There is no code path that skips verification.
    """

    def get_signing_key_from_jwt(self, token: str) -> Any: ...


class CachedJwksResolver:
    """Bounded, cache-aware JWKS retrieval.

    `PyJWKClient` already caches, but its cache never expires on its own, so a
    long-lived process would keep serving a key set from whenever it first
    fetched. Wrapping it with an explicit TTL means key rotation is picked up
    within `clerk_jwks_cache_seconds`, and the client's own `max_cached_keys`
    bounds how much is retained. `lifespan` is passed where the installed PyJWT
    supports it and simply omitted where it does not, so the TTL below is the
    guarantee either way.
    """

    def __init__(self, uri: str, cache_seconds: int, max_keys: int) -> None:
        self._uri = uri
        self._cache_seconds = cache_seconds
        self._max_keys = max_keys
        self._lock = threading.Lock()
        self._client: Optional[Any] = None
        self._fetched_at = 0.0

    def _build_client(self) -> Any:
        kwargs: dict[str, Any] = {"cache_keys": True, "max_cached_keys": self._max_keys}
        try:
            return jwt.PyJWKClient(self._uri, lifespan=self._cache_seconds, **kwargs)
        except TypeError:  # pragma: no cover - depends on the installed PyJWT
            return jwt.PyJWKClient(self._uri, **kwargs)

    def get_signing_key_from_jwt(self, token: str) -> Any:
        with self._lock:
            expired = (time.monotonic() - self._fetched_at) > self._cache_seconds
            if self._client is None or expired:
                self._client = self._build_client()
                self._fetched_at = time.monotonic()
            client = self._client
        return client.get_signing_key_from_jwt(token)


class ClerkTokenVerifier:
    """Verifies a Clerk session token and returns the identity it proves."""

    def __init__(
        self,
        issuer: str,
        authorized_parties: list[str],
        resolver: SigningKeyResolver,
        audience: Optional[str] = None,
        leeway_seconds: int = 0,
    ) -> None:
        self._issuer = issuer
        self._authorized_parties = list(authorized_parties)
        self._resolver = resolver
        self._audience = audience
        self._leeway = leeway_seconds

    def verify(self, token: str) -> VerifiedIdentity:
        if not token or token.count(".") != 2:
            raise AuthenticationError("Malformed authentication token")

        try:
            signing_key = self._resolver.get_signing_key_from_jwt(token)
        except jwt.PyJWTError as exc:
            raise AuthenticationError("Authentication token key is unknown") from exc
        except Exception as exc:  # network failure, malformed JWKS document
            raise AuthenticationError("Authentication keys are unavailable") from exc

        try:
            claims = jwt.decode(
                token,
                key=getattr(signing_key, "key", signing_key),
                algorithms=ALLOWED_ALGORITHMS,
                issuer=self._issuer,
                audience=self._audience,
                leeway=self._leeway,
                options={
                    "require": ["exp", "iss", "sub"],
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_nbf": True,
                    "verify_iss": True,
                    # Only assert an audience when one is actually configured;
                    # a default Clerk session token carries no `aud`.
                    "verify_aud": self._audience is not None,
                },
            )
        except jwt.ExpiredSignatureError as exc:
            raise AuthenticationError("Authentication token has expired") from exc
        except jwt.ImmatureSignatureError as exc:
            raise AuthenticationError("Authentication token is not yet valid") from exc
        except jwt.InvalidIssuerError as exc:
            raise AuthenticationError("Authentication token issuer is not accepted") from exc
        except jwt.InvalidAudienceError as exc:
            raise AuthenticationError("Authentication token audience is not accepted") from exc
        except jwt.PyJWTError as exc:
            raise AuthenticationError("Authentication token is not valid") from exc

        # `azp` is Clerk's documented CSRF defence: it names the origin that
        # asked for the token. A token minted for somebody else's front end is
        # cryptographically perfect and still must not be honoured here.
        authorized_party = claims.get("azp")
        if self._authorized_parties:
            if not authorized_party:
                raise AuthenticationError("Authentication token has no authorized party")
            if str(authorized_party).rstrip("/") not in self._authorized_parties:
                raise AuthenticationError("Authentication token authorized party is not accepted")

        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject.strip():
            raise AuthenticationError("Authentication token has no subject")

        return VerifiedIdentity(issuer=str(claims["iss"]).rstrip("/"), subject=subject.strip())


_verifier_lock = threading.Lock()
_verifier: Optional[ClerkTokenVerifier] = None


def build_verifier(settings: Settings) -> ClerkTokenVerifier:
    return ClerkTokenVerifier(
        issuer=settings.clerk_issuer_url,
        authorized_parties=settings.clerk_authorized_party_list,
        resolver=CachedJwksResolver(
            settings.clerk_jwks_uri,
            settings.clerk_jwks_cache_seconds,
            settings.clerk_jwks_max_keys,
        ),
        audience=settings.clerk_expected_audience,
        leeway_seconds=settings.clerk_leeway_seconds,
    )


def get_token_verifier() -> ClerkTokenVerifier:
    """The configured verifier, built once and reused.

    A FastAPI dependency rather than a module constant so the deterministic test
    suite can supply a verifier anchored to a locally generated key pair through
    `app.dependency_overrides`. That is a test-harness seam, not a runtime one:
    it cannot be reached from a request, an environment variable or a header, so
    there is no production bypass here.
    """
    settings = get_settings()
    if not settings.auth_enabled:
        raise AuthDisabledError()

    global _verifier
    with _verifier_lock:
        if _verifier is None:
            _verifier = build_verifier(settings)
        return _verifier


def reset_verifier_cache() -> None:
    """Drops the memoized verifier. Used by tests that reconfigure settings."""
    global _verifier
    with _verifier_lock:
        _verifier = None


def _bearer_token(
    credentials: Optional[HTTPAuthorizationCredentials],
    authorization: Optional[str],
) -> str:
    """Extracts the bearer token, treating every malformed header as unauthenticated.

    `HTTPBearer` supplies the parse for a well-formed header; the raw header is
    read as well so a present-but-unusable `Authorization` is reported as such
    rather than as "missing".
    """
    if credentials is not None:
        if (credentials.scheme or "").lower() != "bearer":
            raise AuthenticationError("Authentication scheme must be Bearer")
        token = (credentials.credentials or "").strip()
        if not token:
            raise AuthenticationError("Authentication token is missing")
        return token

    if authorization and authorization.strip():
        raise AuthenticationError("Authorization header is malformed")
    raise AuthenticationError("Authentication is required")


def get_verified_identity(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    authorization: Optional[str] = Header(default=None, include_in_schema=False),
    verifier: ClerkTokenVerifier = Depends(get_token_verifier),
) -> VerifiedIdentity:
    """The verified `(issuer, subject)` pair, or a 401. No database access."""
    return verifier.verify(_bearer_token(credentials, authorization))


def find_app_user(db: Session, identity: VerifiedIdentity) -> Optional[AppUser]:
    """The account row for a verified identity, or None. READ ONLY.

    Separate from `resolve_app_user` so that reading somebody's favourites cannot
    write to the database. A verified identity with no row is not an error and not
    a reason to create one: it is an account that has never saved a player, whose
    canonical list is empty. Browsing signed-in therefore leaves no trace, which
    is what the milestone document promises.
    """
    return db.scalars(
        select(AppUser).where(
            AppUser.auth_issuer == identity.issuer,
            AppUser.external_subject == identity.subject,
        )
    ).first()


def resolve_app_user(db: Session, identity: VerifiedIdentity) -> AppUser:
    """Finds, or lazily creates, the account row for a verified identity.

    Called from MUTATION paths only, so a row appears exactly when there is
    something for it to own.

    Idempotent under concurrency by construction: two simultaneous first
    requests both miss the SELECT and both INSERT, the database rejects the
    loser via `uq_app_user_identity`, and the loser re-reads the winner's row.
    The alternative — a check-then-insert guarded only in Python — has a window
    that produces duplicate accounts for the same person under exactly the load
    where it matters least to notice.
    """
    statement = select(AppUser).where(
        AppUser.auth_issuer == identity.issuer,
        AppUser.external_subject == identity.subject,
    )
    user = db.scalars(statement).first()
    if user is not None:
        return user

    user = AppUser(
        auth_provider="clerk",
        auth_issuer=identity.issuer,
        external_subject=identity.subject,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalars(statement).first()
        if existing is None:  # pragma: no cover - only on a non-uniqueness failure
            raise
        return existing
    db.refresh(user)
    return user


def get_current_user(
    identity: VerifiedIdentity = Depends(get_verified_identity),
    db: Session = Depends(get_db),
) -> AppUser:
    """The authenticated-user dependency for endpoints that WRITE.

    Materializes the account row, because the caller is about to store something
    that has to belong to it.
    """
    return resolve_app_user(db, identity)


def get_optional_app_user(
    identity: VerifiedIdentity = Depends(get_verified_identity),
    db: Session = Depends(get_db),
) -> Optional[AppUser]:
    """The authenticated-user dependency for endpoints that only READ.

    Same verification, same subject derivation, same 401s - it simply does not
    create anything. An identity with no row yields None, which the route renders
    as the empty canonical list it truthfully is.
    """
    return find_app_user(db, identity)


#: Re-exported for route modules, so a private endpoint reads as one import.
__all__ = [
    "ALLOWED_ALGORITHMS",
    "CachedJwksResolver",
    "ClerkTokenVerifier",
    "VerifiedIdentity",
    "bearer_scheme",
    "build_verifier",
    "find_app_user",
    "get_current_user",
    "get_optional_app_user",
    "get_token_verifier",
    "get_verified_identity",
    "reset_verifier_cache",
    "resolve_app_user",
]
