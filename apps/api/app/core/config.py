from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SCOUTBOY_", env_file=".env", extra="ignore")

    # Default to a local SQLite file so the MVP runs with zero external services.
    # Override with a Postgres URL for the docker-compose path.
    database_url: str = "sqlite:///./db/scoutboy.db"
    min_minutes: int = 450
    admin_token: str = ""  # empty => admin endpoints are open locally
    web_origin: str = "http://localhost:3000"
    default_season: str = "2023/24"

    # allow DATABASE_URL (no prefix) as an override, matching the Makefile/env.
    def __init__(self, **kwargs):
        import os

        if "SCOUTBOY_DATABASE_URL" not in os.environ and os.environ.get("DATABASE_URL"):
            kwargs.setdefault("database_url", os.environ["DATABASE_URL"])
        super().__init__(**kwargs)


@lru_cache
def get_settings() -> Settings:
    return Settings()
