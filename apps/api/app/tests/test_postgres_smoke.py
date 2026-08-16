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


def test_discovery_semantics_hold_on_postgresql():
    """Phase 8.1B: the Discovery query runs in SQL, so PostgreSQL has to agree.

    Discovery's candidate selection, predicates, ordering, counting and pagination
    are now database work, and several of the pieces are exactly where two dialects
    diverge by default: NULL placement in an ORDER BY, locale collation for the
    canonical-name tie-break, `lower()` on non-ASCII text, and date arithmetic for
    the age ordering key. The same assertion body runs on SQLite in
    `test_discovery_sql.py`, so a divergence fails one run or the other rather than
    reaching production.

    A representative cohort is written inside a transaction and rolled back, so this
    leaves the smoke database exactly as it found it.
    """
    from app.core.db import SessionLocal

    from .discovery_parity import assert_discovery_parity

    with SessionLocal() as session:
        try:
            summary = assert_discovery_parity(session)
        finally:
            session.rollback()

    assert summary["dialect"] == "postgresql"
    assert summary["cohort_players"] > 20, summary
    assert summary["matrix_cases"] > 200, summary


def test_the_icu_collation_the_text_predicates_depend_on_is_available():
    """PostgreSQL reaches Python's `str.lower()` through its ICU root collation.

    `lower()` on its own follows the database's LC_CTYPE, so on this project's own
    cluster - initdb'd with `LC_CTYPE=C` - it is ASCII-only and cannot fold "Étienne",
    let alone the `İ` expansion or the final-sigma rule. `app.core.text_search` therefore
    compiles to `lower(x COLLATE "unicode")`, which is PostgreSQL 16's built-in ICU root
    collation and applies Unicode full case mapping regardless of the database locale.

    Asserted separately from the semantics so a server built without ICU fails here,
    saying what is missing, rather than surfacing as an unexplained SQL error.
    """
    from sqlalchemy import text

    from app.core.db import engine
    from app.core.text_search import POSTGRESQL_ICU_COLLATION

    collation = POSTGRESQL_ICU_COLLATION.strip('"')
    with engine.connect() as connection:
        available = connection.scalar(
            text("SELECT count(*) FROM pg_collation WHERE collname = :name"), {"name": collation}
        )
        assert available, (
            f'collation "{collation}" is not present: this PostgreSQL was built without '
            "ICU, and Discovery's Unicode text matching cannot be served correctly"
        )
        # The one case that proves it is full case mapping rather than the simple one.
        assert (
            connection.scalar(text(f"""SELECT lower('İ' COLLATE "{collation}")""")) == "İ".lower()
        )


#: Where names are written. A divergence between ICU's case tables and CPython's is
#: tolerable in a script no player, club or competition name uses; inside these ranges it
#: would be a real behaviour difference and is not tolerated.
_NAME_BEARING_RANGES = (
    (0x0000, 0x024F),  # ASCII, Latin-1 Supplement, Latin Extended-A and -B
    (0x0370, 0x03FF),  # Greek and Coptic
    (0x0400, 0x052F),  # Cyrillic and Cyrillic Supplement
    (0x1E00, 0x1EFF),  # Latin Extended Additional
    (0x1F00, 0x1FFF),  # Greek Extended
    (0x2100, 0x214F),  # Letterlike Symbols: the Kelvin and Ohm signs live here
)


def test_the_postgres_lowercase_does_not_diverge_from_python_inside_name_scripts():
    """A drift monitor over the whole repertoire, strict where it matters.

    PostgreSQL reaches Unicode full case mapping through ICU, and ICU carries its own
    Unicode tables, which can lag CPython's. That is the one residual this mechanism
    has, so it is measured rather than assumed: every code point CPython lowercases is
    pushed through the real expression and compared to `str.lower()`.

    The assertion is strict for the scripts names are actually written in - any
    divergence there is a genuine behaviour difference and fails. Outside them a lag is
    reported in the failure message of the strict assertion only, so an ICU or Python
    upgrade that widens the gap into real names cannot pass quietly.
    """
    from sqlalchemy import literal, select

    from app.core.db import SessionLocal
    from app.core.text_search import unicode_lower

    cased = [
        cp for cp in range(0x110000) if not (0xD800 <= cp <= 0xDFFF) and chr(cp).lower() != chr(cp)
    ]
    assert len(cased) > 1_000, "the repertoire sweep collapsed"

    diverging = []
    with SessionLocal() as session:
        for start in range(0, len(cased), 500):
            chunk = cased[start : start + 500]
            row = session.execute(select(*[unicode_lower(literal(chr(cp))) for cp in chunk])).one()
            diverging.extend(cp for cp, got in zip(chunk, row) if got != chr(cp).lower())

    in_names = [
        cp for cp in diverging if any(low <= cp <= high for low, high in _NAME_BEARING_RANGES)
    ]
    assert not in_names, (
        f"PostgreSQL's ICU lowercase disagrees with Python for {len(in_names)} code "
        f"point(s) inside the scripts names are written in: "
        f"{[f'U+{cp:04X}' for cp in in_names[:10]]}. "
        f"(Total divergence across the whole repertoire: {len(diverging)} of {len(cased)}.)"
    )


def test_discovery_indexes_exist_on_postgresql():
    """The Phase 8.1B composite indexes arrived through the migration, not the ORM."""
    from app.core.db import engine

    inspector = inspect(engine)
    for table in ("appearances", "role_ratings", "market_values", "player_playstyles"):
        names = {index["name"] for index in inspector.get_indexes(table)}
        expected = f"ix_{table}_season_player"
        assert expected in names, f"{expected} missing from {table}: {sorted(names)}"
