from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select

pytestmark = pytest.mark.skipif(
    os.environ.get("SCOUTBOY_POSTGRES_SMOKE") != "1",
    reason="requires the explicit PostgreSQL smoke environment",
)


def test_migrated_ingested_recomputed_postgres_api_path():
    """Exercise the real configured PostgreSQL engine; never substitute a SQLite session."""
    from app.core.db import SessionLocal, engine
    from app.main import app
    from app.models.orm import Player, RatingRun, RoleRating

    assert engine.dialect.name == "postgresql"
    assert "alembic_version" in inspect(engine).get_table_names()

    with SessionLocal() as session:
        assert session.scalar(select(Player.id).limit(1)) is not None
        assert session.scalar(select(RoleRating.id).limit(1)) is not None
        assert session.scalar(select(RatingRun.id).limit(1)) is not None

    with TestClient(app) as client:
        readiness = client.get("/readyz")
        assert readiness.status_code == 200
        players = client.get("/api/players?page_size=1")
        assert players.status_code == 200
        assert players.json()["total"] > 0
