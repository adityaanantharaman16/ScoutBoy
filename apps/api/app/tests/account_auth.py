"""Deterministic, offline identity fixtures for the `/api/me/*` suite.

No live Clerk tenant, no network, and — importantly — no bypass. The tests below
generate a real RSA key pair in-process, publish it as a real JWKS document, mint
real RS256 tokens and hand the API a real `ClerkTokenVerifier` pointed at that
key set. Signature checking, `exp`/`nbf`, issuer matching and `azp` matching are
all genuinely exercised; the only thing replaced is *where the public key comes
from*, which is exactly the seam a production deployment fills with Clerk's
published JWKS URL.

That matters because the alternative — overriding `get_current_user` to return a
canned account — would leave every claim check untested, and a regression that
stopped verifying signatures would pass a green suite.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

from app.core.auth import ClerkTokenVerifier

ISSUER = "https://scoutboy-test-tenant.clerk.accounts.dev"
AUTHORIZED_PARTY = "http://localhost:3000"
KEY_ID = "test-signing-key"

#: Distinguishes "caller passed nothing" from "caller passed an empty key".
_UNSET = object()


def _generate_key() -> rsa.RSAPrivateKey:
    # 2048 is the smallest size Clerk-grade RS256 is used at, and generating it
    # once per session keeps the suite fast without weakening what is verified.
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


class IdentityHarness:
    """One in-process Clerk stand-in: a signing key, a JWKS, and a token minter."""

    def __init__(self) -> None:
        self.private_key = _generate_key()
        # A second, unrelated key that is never published. Tokens signed with it
        # are structurally perfect and must still be rejected.
        self.attacker_key = _generate_key()

    def jwks(self) -> dict:
        jwk = json.loads(RSAAlgorithm.to_jwk(self.private_key.public_key()))
        jwk.update({"kid": KEY_ID, "use": "sig", "alg": "RS256"})
        return {"keys": [jwk]}

    def token(
        self,
        subject: str,
        *,
        issuer: str = ISSUER,
        azp: Optional[str] = AUTHORIZED_PARTY,
        expires_in: int = 3600,
        not_before: Optional[int] = None,
        audience: Optional[str] = None,
        key: Any = _UNSET,
        kid: str = KEY_ID,
        algorithm: str = "RS256",
        omit_subject: bool = False,
    ) -> str:
        # `_UNSET` rather than `None`, so a caller can deliberately pass the empty
        # key an `alg: none` token requires without it being read as "use the
        # default signing key".
        signing_key = self.private_key if key is _UNSET else key
        now = datetime.now(timezone.utc)
        claims: dict[str, Any] = {
            "iss": issuer,
            "exp": now + timedelta(seconds=expires_in),
            "iat": now,
            # Mirrors a real Clerk session token's shape closely enough that the
            # verifier is doing the same work it will do in production.
            "sid": f"sess_{subject}",
        }
        if not omit_subject:
            claims["sub"] = subject
        if azp is not None:
            claims["azp"] = azp
        if audience is not None:
            claims["aud"] = audience
        if not_before is not None:
            claims["nbf"] = now + timedelta(seconds=not_before)
        return jwt.encode(claims, signing_key, algorithm=algorithm, headers={"kid": kid})


class LocalJwksResolver:
    """Resolves a signing key from a locally held JWKS, by `kid`, without network.

    Mirrors what `PyJWKClient` does against Clerk's published key set, so the
    unknown-key path is a real failure mode here rather than a mocked one.
    """

    def __init__(self, jwks: dict) -> None:
        self._key_set = jwt.PyJWKSet.from_dict(jwks)

    def get_signing_key_from_jwt(self, token: str) -> Any:
        kid = jwt.get_unverified_header(token).get("kid")
        for key in self._key_set.keys:
            if key.key_id == kid:
                return key
        raise jwt.exceptions.PyJWKClientError(f"No signing key for kid {kid!r}")


def build_test_verifier(
    harness: IdentityHarness,
    *,
    issuer: str = ISSUER,
    authorized_parties: Optional[list] = None,
    audience: Optional[str] = None,
) -> ClerkTokenVerifier:
    return ClerkTokenVerifier(
        issuer=issuer,
        authorized_parties=(
            [AUTHORIZED_PARTY] if authorized_parties is None else list(authorized_parties)
        ),
        resolver=LocalJwksResolver(harness.jwks()),
        audience=audience,
        leeway_seconds=0,
    )


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
