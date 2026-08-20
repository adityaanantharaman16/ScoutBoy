from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, inspect, select

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


def test_account_tables_arrived_through_the_migration_on_postgresql():
    """Milestone 8.4A: `alembic upgrade head` built the account schema, not `create_all`.

    The smoke database is migrated rather than metadata-created, so this is the
    leg that proves migration 0007's DDL is genuinely portable: the composite
    unique constraints, the ordering index and both foreign keys have to exist as
    PostgreSQL objects, not merely as SQLAlchemy declarations.
    """
    from app.core.db import engine

    inspector = inspect(engine)
    assert {"app_users", "user_favorites"} <= set(inspector.get_table_names())

    assert "uq_app_user_identity" in {
        c["name"] for c in inspector.get_unique_constraints("app_users")
    }
    assert "uq_user_favorite" in {
        c["name"] for c in inspector.get_unique_constraints("user_favorites")
    }
    assert "ix_user_favorites_user_order" in {
        i["name"] for i in inspector.get_indexes("user_favorites")
    }

    cascades = {
        fk["referred_table"]: fk.get("options", {}).get("ondelete")
        for fk in inspector.get_foreign_keys("user_favorites")
    }
    assert set(cascades) == {"app_users", "players"}
    assert all(rule == "CASCADE" for rule in cascades.values()), cascades


def test_durable_favorites_round_trip_on_postgresql():
    """Ordering, isolation and idempotency on the real engine, then rolled back.

    Written inside a transaction that is explicitly rolled back, so the smoke
    database is left exactly as it was found — the same discipline the Discovery
    parity test above uses.
    """
    from app.core.auth import VerifiedIdentity, resolve_app_user
    from app.core.db import SessionLocal
    from app.models.orm import Player
    from app.services import favorites_service

    issuer = "https://postgres-smoke.clerk.accounts.dev"
    with SessionLocal() as session:
        player_ids = list(session.scalars(select(Player.id).order_by(Player.id).limit(4)))
        assert len(player_ids) == 4

        alice = resolve_app_user(session, VerifiedIdentity(issuer=issuer, subject="pg_alice"))
        bob = resolve_app_user(session, VerifiedIdentity(issuer=issuer, subject="pg_bob"))
        assert alice.id != bob.id

        # Saved out of id order, so the assertion is about save order.
        for player_id in (player_ids[2], player_ids[0]):
            assert favorites_service.add_favorite(session, alice, player_id) is True
        assert favorites_service.add_favorite(session, alice, player_ids[2]) is False

        # The same player on a second account is independent.
        assert favorites_service.add_favorite(session, bob, player_ids[2]) is True

        outcome = favorites_service.merge_favorites(
            session, alice, [player_ids[3], player_ids[0], player_ids[1], 9_876_543]
        )
        assert outcome.player_ids == [
            player_ids[2],
            player_ids[0],
            player_ids[3],
            player_ids[1],
        ]
        assert outcome.added == [player_ids[3], player_ids[1]]
        assert outcome.already_present == [player_ids[0]]
        assert outcome.unknown == [9_876_543]
        assert favorites_service.canonical_ids(session, bob) == [player_ids[2]]

        # `add_favorite`/`merge_favorites` commit internally, so undo explicitly.
        from app.models.orm import AppUser, UserFavorite

        session.execute(delete(UserFavorite).where(UserFavorite.user_id.in_([alice.id, bob.id])))
        session.execute(delete(AppUser).where(AppUser.id.in_([alice.id, bob.id])))
        session.commit()

    with SessionLocal() as verify:
        from app.models.orm import AppUser

        assert verify.scalars(select(AppUser).where(AppUser.auth_issuer == issuer)).all() == []


def test_a_real_concurrent_merge_loses_nothing_on_postgresql():
    """Two genuine sessions racing the same guest list, on the real engine.

    SQLite coverage simulates the race by injecting the IntegrityError. This does
    it for real: a second connection inserts one of the requested players between
    the first session's read and its commit, so PostgreSQL raises an actual
    `unique_violation` (SQLSTATE 23505) from an actual concurrent transaction.

    What must hold afterwards: every requested player persisted, dispositions
    exhaustive, ordering stable, and a repeat merge a no-op. Written inside its
    own account and cleaned up, so the smoke database is left as it was found.
    """
    from app.core.auth import VerifiedIdentity, resolve_app_user
    from app.core.db import SessionLocal
    from app.models.orm import AppUser, Player, UserFavorite
    from app.services import favorites_service

    issuer = "https://pg-race.clerk.accounts.dev"
    with SessionLocal() as session:
        player_ids = list(session.scalars(select(Player.id).order_by(Player.id).limit(4)))
        assert len(player_ids) == 4
        user = resolve_app_user(session, VerifiedIdentity(issuer=issuer, subject="pg_race"))
        contested = player_ids[1]

        raced = {"done": False}
        real_commit = session.commit

        def racing_commit():
            # Fires once, between this session's "what is missing" read and its
            # own insert landing.
            if not raced["done"]:
                raced["done"] = True
                with SessionLocal() as rival:
                    rival.add(UserFavorite(user_id=user.id, player_id=contested))
                    rival.commit()
            return real_commit()

        session.commit = racing_commit  # type: ignore[method-assign]
        try:
            outcome = favorites_service.merge_favorites(session, user, player_ids)
        finally:
            session.commit = real_commit  # type: ignore[method-assign]

        assert raced["done"] is True
        union = set(outcome.added) | set(outcome.already_present) | set(outcome.unknown)
        assert union == set(player_ids), "a requested player fell out of every disposition list"
        assert set(outcome.player_ids) == set(player_ids), "a valid player was not persisted"
        assert outcome.player_ids == favorites_service.canonical_ids(session, user)

        # Idempotent, and stably ordered, on a second run.
        again = favorites_service.merge_favorites(session, user, player_ids)
        assert again.player_ids == outcome.player_ids
        assert again.added == []
        assert set(again.already_present) == set(player_ids)

        session.execute(delete(UserFavorite).where(UserFavorite.user_id == user.id))
        session.execute(delete(AppUser).where(AppUser.id == user.id))
        session.commit()

    with SessionLocal() as verify:
        from app.models.orm import AppUser as VerifyUser

        assert (
            verify.scalars(select(VerifyUser).where(VerifyUser.auth_issuer == issuer)).all() == []
        )


def test_parallel_merges_of_the_same_list_converge_on_postgresql():
    """Four real threads, four real connections, one list, one correct outcome.

    The other race test injects the conflicting insert at a known point, which
    makes it deterministic. This one does not choreograph anything: it lets real
    concurrent transactions collide however PostgreSQL decides to schedule them,
    and asserts the properties that must hold regardless - every requested player
    persisted exactly once, no duplicates, and the canonical order stable across
    readers.

    Bounded to four workers and one small list, so it stays a smoke test rather
    than a load test.
    """
    import threading

    from app.core.auth import VerifiedIdentity, resolve_app_user
    from app.core.db import SessionLocal
    from app.models.orm import AppUser, Player, UserFavorite
    from app.services import favorites_service

    issuer = "https://pg-parallel.clerk.accounts.dev"
    with SessionLocal() as setup:
        player_ids = list(setup.scalars(select(Player.id).order_by(Player.id).limit(4)))
        assert len(player_ids) == 4
        user = resolve_app_user(setup, VerifiedIdentity(issuer=issuer, subject="pg_parallel"))
        user_id = user.id

    errors: list = []
    outcomes: list = []
    barrier = threading.Barrier(4)

    def worker():
        try:
            with SessionLocal() as session:
                mine = session.get(AppUser, user_id)
                assert mine is not None
                # Every thread starts its merge at the same instant.
                barrier.wait(timeout=20)
                outcomes.append(favorites_service.merge_favorites(session, mine, player_ids))
        except Exception as exc:  # recorded, not swallowed
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)

    assert errors == [], f"a concurrent merge failed: {errors!r}"
    assert len(outcomes) == 4

    with SessionLocal() as verify:
        rows = list(
            verify.scalars(
                select(UserFavorite.player_id)
                .where(UserFavorite.user_id == user_id)
                .order_by(UserFavorite.created_at.asc(), UserFavorite.id.asc())
            )
        )
        # Exactly once each: the unique constraint plus the bounded retry.
        assert sorted(rows) == sorted(player_ids), rows
        assert len(rows) == len(set(rows)), "a player was stored twice"

        # Every thread's disposition lists exhaust the request, and each thread's
        # returned canonical list agrees with what is actually stored.
        for outcome in outcomes:
            union = set(outcome.added) | set(outcome.already_present) | set(outcome.unknown)
            assert union == set(player_ids), union
            assert set(outcome.player_ids) == set(player_ids)

        # A later reader sees the same order every time.
        assert favorites_service.canonical_ids(verify, verify.get(AppUser, user_id)) == rows

        verify.execute(delete(UserFavorite).where(UserFavorite.user_id == user_id))
        verify.execute(delete(AppUser).where(AppUser.id == user_id))
        verify.commit()

    with SessionLocal() as final:
        assert final.scalars(select(AppUser).where(AppUser.auth_issuer == issuer)).all() == []
