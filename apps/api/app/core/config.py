from __future__ import annotations

from functools import lru_cache
from typing import Literal

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
