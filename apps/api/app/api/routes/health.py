from __future__ import annotations

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from fastapi import APIRouter, HTTPException, status
from rolefit.paths import repo_root
from sqlalchemy import text

from app.core.db import engine

router = APIRouter(tags=["health"])


def check_database_readiness() -> dict[str, str]:
    """Check connectivity and verify that the database is at an Alembic head revision."""
    alembic_config = Config(str(repo_root() / "alembic.ini"))
    expected_heads = set(ScriptDirectory.from_config(alembic_config).get_heads())
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
        current_heads = set(MigrationContext.configure(connection).get_current_heads())

    if not current_heads or current_heads != expected_heads:
        raise RuntimeError("database schema is not at the expected migration revision")
    return {"status": "ready", "database": "ready"}


@router.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
def readyz() -> dict[str, str]:
    try:
        return check_database_readiness()
    except Exception as exc:
        # Do not expose connection strings, driver errors, or database internals to callers.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"status": "not_ready", "database": "unavailable"},
        ) from exc
