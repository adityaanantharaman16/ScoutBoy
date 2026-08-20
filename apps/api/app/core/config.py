from __future__ import annotations

from functools import lru_cache
from typing import Literal, Optional

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SCOUTBOY_", env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    # Default to a local SQLite file so the MVP runs with zero external services.
    # Override with a Postgres URL for the docker-compose path.
    database_url: str = "sqlite:///./db/scoutboy.db"
    min_minutes: int = 450
    admin_token: str = ""  # empty => admin endpoints are open locally
    web_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    default_season: str = "2023/24"

    # ---- Optional accounts (Milestone 8.4A) --------------------------------
    # OFF by default and off in every existing environment file, so the product
    # boots, tests and runs as the anonymous-only application it already is.
    # Turning it on requires a complete, internally consistent Clerk identity
    # configuration; a partial one raises here rather than starting a server that
    # would accept tokens it cannot properly verify.
    auth_enabled: bool = False
    # The Clerk instance's Frontend API origin, which is also the `iss` claim of
    # every session token it mints (e.g. https://your-app-42.clerk.accounts.dev).
    clerk_issuer: str = ""
    # Optional override. Empty => <issuer>/.well-known/jwks.json, the location
    # Clerk publishes verification keys at.
    clerk_jwks_url: str = ""
    # Comma-separated origins permitted to have requested the token (`azp`).
    # Clerk documents this as the CSRF defence for manual verification, so it is
    # required rather than optional.
    clerk_authorized_parties: str = ""
    # Only set when the Clerk JWT template actually mints an `aud`. Empty means
    # "no audience claim is expected", which is Clerk's default session token.
    clerk_jwt_audience: str = ""
    # Bounds on remote key retrieval: how long a fetched key set stays usable and
    # how many signing keys are retained at once.
    clerk_jwks_cache_seconds: int = 300
    clerk_jwks_max_keys: int = 8
    # Clock-skew tolerance applied to exp/nbf. Deliberately small.
    clerk_leeway_seconds: int = 10

    # allow DATABASE_URL (no prefix) as an override, matching the Makefile/env.
    def __init__(self, **kwargs):
        import os

        if "SCOUTBOY_DATABASE_URL" not in os.environ and os.environ.get("DATABASE_URL"):
            kwargs.setdefault("database_url", os.environ["DATABASE_URL"])
        # Keep the pre-Milestone-4 singular setting working as a migration aid.
        if "SCOUTBOY_WEB_ORIGINS" not in os.environ and os.environ.get("SCOUTBOY_WEB_ORIGIN"):
            kwargs.setdefault("web_origins", os.environ["SCOUTBOY_WEB_ORIGIN"])
        super().__init__(**kwargs)

    @property
    def allowed_web_origins(self) -> list[str]:
        return [
            origin.strip().rstrip("/") for origin in self.web_origins.split(",") if origin.strip()
        ]

    @property
    def clerk_issuer_url(self) -> str:
        """The issuer with any trailing slash removed, so `iss` compares exactly."""
        return self.clerk_issuer.strip().rstrip("/")

    @property
    def clerk_jwks_uri(self) -> str:
        """Where the instance's public verification keys are published."""
        override = self.clerk_jwks_url.strip()
        return override or f"{self.clerk_issuer_url}/.well-known/jwks.json"

    @property
    def clerk_authorized_party_list(self) -> list[str]:
        return [
            party.strip().rstrip("/")
            for party in self.clerk_authorized_parties.split(",")
            if party.strip()
        ]

    @property
    def clerk_expected_audience(self) -> Optional[str]:
        return self.clerk_jwt_audience.strip() or None

    @model_validator(mode="after")
    def validate_auth_configuration(self) -> Settings:
        """Fail loudly on a half-configured identity boundary.

        The alternative — booting with `auth_enabled` and an empty issuer — would
        produce a server that answers `/api/me/*` with a verifier it cannot
        actually anchor to a tenant. That is the silent insecure partial mode this
        phase is required not to have, so every inconsistency is raised at import
        time instead.
        """
        if not self.auth_enabled:
            return self

        if not self.clerk_issuer_url:
            raise ValueError("SCOUTBOY_CLERK_ISSUER is required when SCOUTBOY_AUTH_ENABLED is true")
        if not self.clerk_issuer_url.startswith("https://"):
            raise ValueError("SCOUTBOY_CLERK_ISSUER must be an https URL")
        if not self.clerk_authorized_party_list:
            raise ValueError(
                "SCOUTBOY_CLERK_AUTHORIZED_PARTIES is required when SCOUTBOY_AUTH_ENABLED is true"
            )
        if not self.clerk_jwks_uri.startswith("https://"):
            raise ValueError("SCOUTBOY_CLERK_JWKS_URL must be an https URL")
        if self.clerk_jwks_cache_seconds <= 0:
            raise ValueError("SCOUTBOY_CLERK_JWKS_CACHE_SECONDS must be positive")
        if self.clerk_jwks_max_keys <= 0:
            raise ValueError("SCOUTBOY_CLERK_JWKS_MAX_KEYS must be positive")
        if self.clerk_leeway_seconds < 0:
            raise ValueError("SCOUTBOY_CLERK_LEEWAY_SECONDS cannot be negative")
        return self

    @model_validator(mode="after")
    def validate_production_safety(self) -> Settings:
        if self.environment != "production":
            return self
        if not self.admin_token.strip():
            raise ValueError("SCOUTBOY_ADMIN_TOKEN must be set in production")
        if not self.allowed_web_origins:
            raise ValueError("SCOUTBOY_WEB_ORIGINS must contain at least one production origin")
        if any("*" in origin for origin in self.allowed_web_origins):
            raise ValueError("SCOUTBOY_WEB_ORIGINS cannot contain a wildcard in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
