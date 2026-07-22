"""Root pytest configuration.

Points the app at an isolated SQLite test DB *before* app modules import (so the
engine binds to it), then provides a session-scoped seeded database and a FastAPI
TestClient. Non-DB tests (rating engine, market model) simply ignore these fixtures.
"""

from __future__ import annotations

import os
import pathlib
import tempfile

# Must run before any `app.*` import so the engine binds to the test DB.
_POSTGRES_SMOKE = os.environ.get("SCOUTBOY_POSTGRES_SMOKE") == "1"
if _POSTGRES_SMOKE:
    if not os.environ.get("DATABASE_URL", "").startswith("postgresql"):
        raise RuntimeError("SCOUTBOY_POSTGRES_SMOKE requires a PostgreSQL DATABASE_URL")
else:
    _TESTDB = pathlib.Path(tempfile.gettempdir()) / "scoutboy_pytest.db"
    if _TESTDB.exists():
        _TESTDB.unlink()
    os.environ["DATABASE_URL"] = f"sqlite:///{_TESTDB}"
os.environ.setdefault("SCOUTBOY_ENVIRONMENT", "test")
os.environ.setdefault("SCOUTBOY_MIN_MINUTES", "450")
os.environ.setdefault("SCOUTBOY_ADMIN_TOKEN", "")

import pytest  # noqa: E402


@pytest.fixture(scope="session")
def _seeded():
    from app.core.db import SessionLocal, engine
    from app.models.orm import Base
    from data_pipeline.adapters import get_adapter
    from data_pipeline.jobs.ingest import ingest_bundle
    from data_pipeline.jobs.recompute import recompute

    Base.metadata.create_all(engine)
    with SessionLocal() as s:
        ingest_bundle(s, get_adapter("sample").fetch())
    with SessionLocal() as s:
        recompute(s)
    return True


@pytest.fixture()
def db_session(_seeded):
    from app.core.db import SessionLocal

    with SessionLocal() as s:
        yield s


@pytest.fixture()
def client(_seeded):
    from app.main import app
    from fastapi.testclient import TestClient

    return TestClient(app)
