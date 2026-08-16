"""Phase 8.1B - Discovery query execution happens in the database.

Phase 8.1A made the Discovery contract internally truthful while the read model was
still assembled in Python: every player-season of the current season was loaded, a
predicate ran per row, the list was sorted with a tuple key and a page was sliced out
of it. This phase moves candidate selection, the predicates, the ordering, the count
and the pagination into SQL, and these tests defend the three things that could go
wrong in that move:

1. **The semantics changed.** Guarded by a differential suite: a purpose-built cohort
   is queried through both the SQL implementation and a transcription of the previous
   Python one, across every filter combination and every sort mode.
2. **The work is still O(cohort).** Guarded by counting the statements a request
   issues and proving the count does not move with cohort size, page size or the
   number of returned players, and by proving the page restriction is a database
   LIMIT/OFFSET rather than a Python slice.
3. **It only holds at fixture scale.** Guarded by a five-thousand-record cohort with
   real ratings, markets, playstyles, ties and missing values.

Everything here runs against its own engine or inside a rolled-back transaction, so
no test leaves data behind for another to trip over.
"""

from __future__ import annotations

import re

import pytest
from sqlalchemy import create_engine, event, func, literal, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import text_search
from app.core.text_search import unicode_lower
from app.models.orm import Base, Player
from app.repositories import discovery_repo
from app.services import players_service

from . import discovery_cohort
from .discovery_cohort import (
    OTHER_ROLE,
    SELECTED_ROLE,
    SORTS,
    build_cohort,
    load_reference_rows,
    reference_search,
)
from .discovery_parity import assert_discovery_parity

#: The scale cohort. Large enough that an O(cohort) implementation would show up in
#: the statement count and the materialized row count, small enough to stay practical
#: in the regular suite.
SCALE_SIZE = 5_000

#: A generous but meaningful ceiling on the statements one Discovery request may
#: issue: current season, count, page, page playstyles. Four is what the
#: implementation does; the ceiling leaves room for an extra lookup without leaving
#: room for per-player work.
MAX_STATEMENTS_PER_SEARCH = 8


# ---------------------------------------------------------------------------
# isolated engines
# ---------------------------------------------------------------------------
class _StatementLog:
    """Every SQL statement executed on one engine, for counting and inspection."""

    def __init__(self, engine):
        self.statements: list = []
        self._engine = engine
        self._recording = False

        @event.listens_for(engine, "before_cursor_execute")
        def _record(conn, cursor, statement, parameters, context, executemany):
            if self._recording:
                self.statements.append(statement)

        self._listener = _record

    def __enter__(self):
        self.statements.clear()
        self._recording = True
        return self

    def __exit__(self, *exc):
        self._recording = False
        return False

    @property
    def count(self) -> int:
        return len(self.statements)

    def limited(self) -> list:
        return [s for s in self.statements if re.search(r"\bLIMIT\b", s, re.IGNORECASE)]

    def dump(self) -> str:
        return "\n---\n".join(self.statements)


def _isolated_session_factory():
    """A private in-memory database, so volume tests cannot disturb the shared one."""
    engine = create_engine(
        "sqlite://",
        future=True,
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


@pytest.fixture(scope="module")
def characterization_db():
    """The hand-built characterization cohort on its own engine."""
    engine, factory = _isolated_session_factory()
    session = factory()
    cohort = build_cohort(session)
    session.commit()
    log = _StatementLog(engine)
    yield session, cohort, log
    session.close()
    engine.dispose()


@pytest.fixture(scope="module")
def scale_db():
    """The characterization cohort plus SCALE_SIZE generated player-seasons."""
    engine, factory = _isolated_session_factory()
    session = factory()
    cohort = build_cohort(session, scale=SCALE_SIZE)
    session.commit()
    log = _StatementLog(engine)
    yield session, cohort, log
    session.close()
    engine.dispose()


# ---------------------------------------------------------------------------
# 1. semantic equivalence with the pre-8.1B implementation
# ---------------------------------------------------------------------------
def test_sql_selection_matches_the_python_reference_across_the_matrix(db_session):
    """The differential suite: every filter case, every sort, against the oracle.

    Run on the ordinary seeded test database - the same entry point the PostgreSQL
    smoke uses - so both dialects are held to one body of assertions. The cohort is
    written inside a transaction and rolled back, so the seeded fixtures other tests
    depend on are untouched.
    """
    try:
        summary = assert_discovery_parity(db_session)
    finally:
        db_session.rollback()
    assert summary["dialect"] == "sqlite"
    assert summary["matrix_cases"] > 200, summary
    assert summary["cohort_players"] > 20, summary


# ---------------------------------------------------------------------------
# 1a. the lowercase the text predicates and the name ordering are defined by
#
# Discovery's case-insensitivity was Python's `str.lower()` before this phase, and
# neither database reproduces it: SQLite's `lower()` is ASCII-only and PostgreSQL's
# follows the database's LC_CTYPE. `app.core.text_search` supplies the mechanism; these
# tests hold it to `str.lower()` over the whole Unicode repertoire, prove it reaches
# every connection a pool can hand out, and pin the SQL each dialect emits.
# ---------------------------------------------------------------------------
#: Every code point CPython lowercases to something other than itself. Rebuilt from the
#: running interpreter rather than pinned, so a Python upgrade that adds mappings widens
#: the sweep instead of silently narrowing it.
_CASED_CODE_POINTS = [
    cp for cp in range(0x110000) if not (0xD800 <= cp <= 0xDFFF) and chr(cp).lower() != chr(cp)
]


def test_the_sqlite_lowercase_matches_python_for_every_cased_code_point():
    """The SQLite function is `str.lower()` across the entire repertoire.

    Not a sample: the audit's failures (`İ`, `ẞ`) were exactly the kind of case a
    hand-picked list misses, so the whole repertoire is swept in one statement per
    chunk. The Kelvin and Ohm signs, the Roman numerals, the circled letters and the
    one code point that lowercases to two (`İ`) are all in here by construction.
    """
    engine, factory = _isolated_session_factory()
    try:
        session = factory()
        assert len(_CASED_CODE_POINTS) > 1_000, "the repertoire sweep collapsed"
        mismatched = []
        for start in range(0, len(_CASED_CODE_POINTS), 500):
            chunk = _CASED_CODE_POINTS[start : start + 500]
            row = session.execute(select(*[unicode_lower(literal(chr(cp))) for cp in chunk])).one()
            mismatched.extend(
                (cp, chr(cp).lower(), got) for cp, got in zip(chunk, row) if got != chr(cp).lower()
            )
        assert not mismatched, (
            f"{len(mismatched)} code points disagree with str.lower(), " f"first: {mismatched[:5]}"
        )
        session.close()
    finally:
        engine.dispose()


def test_the_lowercase_function_reaches_every_pooled_connection():
    """A newly built engine, and every connection it hands out, carries the function.

    The registration is a listener on the `Engine` class rather than on one engine, so
    that an engine created later - which is what every isolated test here does, and what
    a reconnect after a dropped connection effectively is - is not left without it. This
    exercises a fresh engine, a second connection from its pool, and a connection taken
    after the pool has been emptied.
    """
    engine = create_engine("sqlite://", future=True)
    try:
        for _ in range(2):
            with engine.connect() as connection:
                assert connection.scalar(select(unicode_lower(literal("ẞÉ")))) == "ßé"
        engine.dispose()  # every pooled connection is discarded; the next one is new
        with engine.connect() as connection:
            assert connection.scalar(select(unicode_lower(literal("İ")))) == "i̇"
    finally:
        engine.dispose()

    # The registration helper reports honestly on a connection it does not handle, so
    # the listener stays a no-op for PostgreSQL rather than guessing.
    assert text_search.register_sqlite_functions(object()) is False


def test_each_dialect_emits_its_own_unicode_lowercase():
    """SQLite calls the registered function; PostgreSQL uses the ICU root collation.

    Pinned because these are the two supported execution paths (ADR 0001) and because a
    silent fall back to a plain `lower()` on either would reintroduce the defect while
    every SQLite test kept passing.
    """
    from sqlalchemy.dialects import postgresql, sqlite

    expression = unicode_lower(Player.canonical_name)
    rendered_sqlite = str(expression.compile(dialect=sqlite.dialect()))
    rendered_postgres = str(expression.compile(dialect=postgresql.dialect()))

    assert rendered_sqlite == f"{text_search.SQLITE_LOWER_FUNCTION}(players.canonical_name)"
    assert rendered_postgres == (
        f"lower((players.canonical_name) COLLATE {text_search.POSTGRESQL_ICU_COLLATION})"
    )
    # The needle stays literal: `contains` escapes rather than interpolating.
    assert "ESCAPE" in str(
        expression.contains("100%", autoescape=True).compile(dialect=sqlite.dialect())
    )


@pytest.mark.parametrize(
    "stored,needle",
    [
        ("İpek", "İpek"),  # str.lower() -> "i" + U+0307; SQL lower() left it alone
        ("İpek", "i̇pek"),  # ...so the lowered spelling did not match either
        ("ẞeta", "ẞeta"),  # str.lower() -> "ßeta"; "ß".upper() is "SS", so the
        ("ẞeta", "ßeta"),  # ...inverse-uppercase fold could not find it
    ],
)
def test_the_reported_unicode_search_failures(characterization_db, stored, needle):
    """The two failures the supervisory audit reproduced, as their own regression.

    Both are covered by the shared parity matrix as well; they are named here because
    they are the specific defect this correction exists for, and because they document
    *why* a fold built by inverting `.upper()` could never have handled them.
    """
    session, cohort, _ = characterization_db
    name = next(value for value in discovery_cohort.UNICODE_NAMES.values() if stored in value)
    assert needle.lower() in name.lower(), "the fixture no longer exercises this case"
    found = players_service.search_players(session, scope="all_records", q=needle, page_size=100)
    assert cohort.id_of(name) in [item.id for item in found.items]


def test_unicode_text_search_costs_no_extra_statements(characterization_db):
    """Correct Unicode casing must not have moved work back out of the query."""
    session, _, log = characterization_db
    for needle in ("İpek", "ẞeta", "οδος", "Kelvin"):
        with log:
            body = players_service.search_players(
                session, scope="all_records", q=needle, page_size=20
            )
        assert body.items, needle
        assert log.count <= MAX_STATEMENTS_PER_SEARCH, f"{needle}: {log.dump()}"
        assert log.limited(), f"{needle}: the page query lost its database LIMIT"


@pytest.mark.parametrize("sort", SORTS)
def test_every_sort_mode_matches_the_reference_page_by_page(characterization_db, sort):
    """Small pages, walked to the end, reproduce the reference ordering exactly."""
    session, cohort, _ = characterization_db
    reference_rows = load_reference_rows(session, cohort.season_id, cohort.season_end)
    expected, total, _, _ = reference_search(
        reference_rows, sort=sort, page_size=1000, scope="all_records"
    )
    walked: list = []
    page = 1
    while True:
        body = players_service.search_players(
            session, scope="all_records", sort=sort, page=page, page_size=3
        )
        walked.extend(item.id for item in body.items)
        if page >= body.total_pages:
            assert body.total == total
            break
        page += 1
    assert walked == expected, sort


def test_serialized_card_fields_match_the_reference_row(characterization_db):
    """The card still reports stored values, and the two role contexts stay distinct."""
    session, cohort, _ = characterization_db
    body = players_service.search_players(session, scope="all_records", page_size=100)
    by_id = {item.id: item for item in body.items}

    conflicted = by_id[cohort.id_of("Cohort Conflicted Winger")]
    assert (conflicted.best_role, conflicted.best_role_score) == (OTHER_ROLE, 88.0)
    assert conflicted.result_role_source == "best_role"
    assert conflicted.confidence == conflicted.result_role_confidence == "high"

    unrated = by_id[cohort.id_of("Cohort Unrated Defender")]
    assert unrated.has_rolefit_analysis is False
    assert unrated.analysis_status == "profile_only"
    assert unrated.evidence_status == "profile_only"
    assert (unrated.best_role, unrated.best_role_score, unrated.result_role_score) == (
        None,
        None,
        None,
    )
    assert unrated.best_role_confidence == unrated.result_role_confidence == "unknown"

    # A market row with only one endpoint keeps the other unknown, never zero.
    low_only = by_id[cohort.id_of("Cohort Low Endpoint Only")]
    assert (low_only.expected_asking_low_eur, low_only.expected_asking_high_eur) == (
        2_500_000,
        None,
    )
    assert low_only.market_label == "value"
    high_only = by_id[cohort.id_of("Cohort High Endpoint Only")]
    assert (high_only.expected_asking_low_eur, high_only.expected_asking_high_eur) == (
        None,
        40_000_000,
    )
    no_market = by_id[cohort.id_of("Cohort Aaa No Market Row")]
    assert no_market.expected_asking_low_eur is None
    assert no_market.market_label is None

    # Top playstyles keep their tier-then-name ordering and their limit of three.
    many = by_id[cohort.id_of("Cohort Many Playstyles")]
    assert many.top_playstyles == ["Dribble Carrier", "Press Resistant", "Progressive Passer"]
    assert by_id[cohort.id_of("Cohort Concerns Only")].top_playstyles == []

    # Position group falls back to the primary position, and stays unknown when the
    # domain does not map that position.
    assert by_id[cohort.id_of("Cohort Fallback Position Group")].position_group == "ATT"
    assert by_id[cohort.id_of("Cohort Unmapped Position")].position_group is None

    # The greatest-minutes appearance supplies the row, unaltered.
    assert by_id[cohort.id_of("Cohort Multi Appearance")].minutes == 2600


def test_unknown_birth_date_is_visible_unfiltered_and_fails_every_age_bound(
    characterization_db,
):
    session, cohort, _ = characterization_db
    undated = cohort.id_of("Cohort Rated No Birth Date")
    unfiltered = players_service.search_players(session, scope="all_records", page_size=100)
    assert undated in [item.id for item in unfiltered.items]
    assert next(i for i in unfiltered.items if i.id == undated).age is None

    for bounds in (
        {"age_min": 19},
        {"age_max": 40},
        {"age_min": 20, "age_max": 35},
        {"age_band": "u23"},
        {"age_band": "31_plus"},
    ):
        body = players_service.search_players(session, scope="all_records", page_size=100, **bounds)
        assert undated not in [item.id for item in body.items], bounds


@pytest.mark.parametrize(
    "age_bound",
    [
        {"age_min": float("inf")},
        {"age_max": float("-inf")},
        {"age_min": float("nan")},
        {"age_max": float("nan")},
        {"age_min": 1e12},
        {"age_max": -1e12},
        {"age_min": -1e12},
        {"age_max": 1e12},
    ],
)
def test_extreme_age_bounds_are_answered_rather_than_raising(characterization_db, age_bound):
    """An absurd or non-finite bound must behave like the previous comparison did.

    The previous implementation compared a rounded float, so infinity narrowed to
    nothing and NaN excluded only the unknown ages. Deriving a birth-date boundary
    must not turn either into a date-arithmetic overflow.
    """
    session, cohort, _ = characterization_db
    reference_rows = load_reference_rows(session, cohort.season_id, cohort.season_end)
    body = players_service.search_players(session, scope="all_records", page_size=100, **age_bound)
    expected, total, _, _ = reference_search(
        reference_rows, page_size=100, scope="all_records", **age_bound
    )
    assert body.total == total, age_bound
    assert [item.id for item in body.items] == expected, age_bound


def test_the_age_boundary_derivation_is_exact_at_every_stop(characterization_db):
    """A derived birth-date boundary keeps the rounded age's own inclusive behaviour."""
    session, _, _ = characterization_db
    for age in (19, 22, 23, 25, 28, 31, 23.5, 27.5):
        days = players_service._days_for_age_floor(float(age))
        assert players_service._rounded_age_for_days(days) >= age
        assert players_service._rounded_age_for_days(days - 1) < age
        days = players_service._days_for_age_ceiling(float(age))
        assert players_service._rounded_age_for_days(days) <= age
        assert players_service._rounded_age_for_days(days + 1) > age
    _ = session


# ---------------------------------------------------------------------------
# 2. query count
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("role", [None, SELECTED_ROLE])
@pytest.mark.parametrize("page_size", [1, 5, 25, 100])
def test_statement_count_is_constant_in_page_size_and_role(characterization_db, role, page_size):
    """One request, a handful of statements, whatever the page size or role context."""
    session, _, log = characterization_db
    with log:
        body = players_service.search_players(
            session, scope="all_records", role=role, page_size=page_size
        )
    assert body.items, "an empty page would not prove anything about enrichment"
    assert (
        log.count <= MAX_STATEMENTS_PER_SEARCH
    ), f"{log.count} statements for page_size={page_size} role={role}:\n{log.dump()}"
    # No statement mentions a single player id, which is what an N+1 card load or a
    # per-player `session.get(Player, pid)` would look like.
    assert not [s for s in log.statements if "players.id = ?" in s], log.dump()


def test_statement_count_does_not_grow_with_cohort_size(characterization_db, scale_db):
    """The same request costs the same number of statements at 25x the cohort."""
    small_session, _, small_log = characterization_db
    big_session, _, big_log = scale_db

    with small_log:
        small = players_service.search_players(small_session, scope="all_records", page_size=20)
    with big_log:
        big = players_service.search_players(big_session, scope="all_records", page_size=20)

    assert big.total > small.total * 10, (small.total, big.total)
    assert big_log.count == small_log.count, (
        f"cohort size changed the statement count: {small_log.count} -> {big_log.count}\n"
        f"{big_log.dump()}"
    )
    assert big_log.count <= MAX_STATEMENTS_PER_SEARCH, big_log.dump()


def test_statement_count_does_not_grow_with_returned_players(scale_db):
    """Ten times the returned rows, the same number of statements."""
    session, _, log = scale_db
    counts = {}
    for page_size in (10, 100):
        with log:
            body = players_service.search_players(session, scope="all_records", page_size=page_size)
        assert len(body.items) == page_size
        counts[page_size] = log.count
    assert counts[10] == counts[100], counts
    assert counts[100] <= MAX_STATEMENTS_PER_SEARCH, counts


def test_an_empty_result_costs_no_page_or_enrichment_statement(characterization_db):
    session, _, log = characterization_db
    with log:
        body = players_service.search_players(
            session, scope="all_records", q="no-such-player-anywhere", page_size=20
        )
    assert body.total == 0
    assert log.count <= 2, log.dump()


# ---------------------------------------------------------------------------
# 3. the page restriction is in the database
# ---------------------------------------------------------------------------
def test_the_candidate_query_carries_a_database_limit_and_offset(scale_db):
    session, _, log = scale_db
    with log:
        body = players_service.search_players(
            session, scope="all_records", sort="rolefit_desc", page=3, page_size=7
        )
    assert len(body.items) == 7
    limited = log.limited()
    assert limited, f"no statement carried a LIMIT:\n{log.dump()}"
    page_sql = limited[-1]
    assert re.search(r"\bOFFSET\b", page_sql, re.IGNORECASE), page_sql
    assert re.search(r"\bORDER BY\b", page_sql, re.IGNORECASE), page_sql
    # The count is a separate, unlimited statement, so the total is not derived from
    # a truncated page.
    assert any(
        "count(" in s.lower() and "limit" not in s.lower() for s in log.statements
    ), log.dump()


def test_only_the_page_is_materialized_for_enrichment(scale_db):
    """Rows leave the database at page size, and enrichment binds page ids only."""
    session, _, log = scale_db
    page_size = 6
    with log:
        body = players_service.search_players(
            session, scope="all_records", sort="name_asc", page=2, page_size=page_size
        )
    assert len(body.items) == page_size

    playstyle_statements = [s for s in log.statements if "player_playstyles" in s]
    assert len(playstyle_statements) == 1, log.dump()
    bound_ids = playstyle_statements[0].count("?")
    assert bound_ids <= page_size + 2, playstyle_statements[0]


def test_total_is_a_distinct_player_count_not_a_row_count(scale_db):
    """One-to-many joins cannot inflate the total."""
    session, cohort, _ = scale_db
    body = players_service.search_players(session, scope="all_records", page_size=100)
    distinct_players = session.scalar(
        select(func.count(func.distinct(Player.id))).select_from(Player)
    )
    assert body.total == distinct_players

    # The multi-appearance and multi-rating players are in the cohort, so a bare join
    # would have produced more rows than players.
    filters = discovery_repo.DiscoveryFilters(
        season_id=cohort.season_id,
        universe_key="mvp_u23_att_mid_eu",
        scope="all_records",
        season_end=cohort.season_end,
    )
    assert discovery_repo.count_players(session, filters) == body.total


def test_out_of_range_page_is_canonicalized_without_loading_every_candidate(scale_db):
    """The last page is served, and only that page's rows are fetched."""
    session, _, log = scale_db
    page_size = 9
    with log:
        body = players_service.search_players(
            session, scope="all_records", sort="rolefit_desc", page=10_000, page_size=page_size
        )
    assert body.page == body.total_pages
    assert body.total > page_size * 100
    assert 0 < len(body.items) <= page_size
    assert log.count <= MAX_STATEMENTS_PER_SEARCH, log.dump()
    # The correction is a count plus one LIMIT/OFFSET page, not a full scan that is
    # then sliced: the total came from an aggregate, and the only statement that
    # returned candidate rows was page-restricted in the database.
    assert any("count(" in s.lower() and "limit" not in s.lower() for s in log.statements)
    row_statements = [s for s in log.statements if "players.canonical_name" in s]
    assert row_statements, log.dump()
    assert all(re.search(r"\bLIMIT\b", s, re.IGNORECASE) for s in row_statements), log.dump()
    # The served page is the tail of the ordering, not the head.
    last = players_service.search_players(
        session,
        scope="all_records",
        sort="rolefit_desc",
        page=body.total_pages,
        page_size=page_size,
    )
    assert [item.id for item in body.items] == [item.id for item in last.items]


# ---------------------------------------------------------------------------
# 4. volume
# ---------------------------------------------------------------------------
def test_scale_cohort_is_populated_rather_than_empty_profiles(scale_db):
    """The volume fixture has to exercise the query, not count blank rows."""
    from app.models.orm import MarketValue, PlayerPlaystyle, RoleRating

    session, _, _ = scale_db
    assert session.scalar(select(func.count()).select_from(Player)) >= SCALE_SIZE
    assert session.scalar(select(func.count()).select_from(RoleRating)) > SCALE_SIZE * 0.9
    assert session.scalar(select(func.count()).select_from(MarketValue)) > SCALE_SIZE * 0.8
    assert session.scalar(select(func.count()).select_from(PlayerPlaystyle)) > SCALE_SIZE * 0.2
    # unknowns and ties are present in quantity
    assert (
        session.scalar(select(func.count()).select_from(Player).where(Player.birth_date.is_(None)))
        > SCALE_SIZE * 0.1
    )
    tied_scores = session.scalar(
        select(func.count()).select_from(
            select(RoleRating.final_score)
            .group_by(RoleRating.final_score)
            .having(func.count() > 5)
            .subquery()
        )
    )
    assert tied_scores > 10, tied_scores


@pytest.mark.parametrize("sort", SORTS)
def test_scale_results_are_correct_and_repeatable(scale_db, sort):
    """At volume: correct totals and pages, and byte-identical repeated output."""
    session, _, _ = scale_db
    first = players_service.search_players(
        session, scope="all_records", sort=sort, page=4, page_size=20
    )
    second = players_service.search_players(
        session, scope="all_records", sort=sort, page=4, page_size=20
    )
    assert [i.id for i in first.items] == [i.id for i in second.items], sort
    assert first.model_dump() == second.model_dump(), sort
    assert first.total > SCALE_SIZE
    assert first.total_pages == -(-first.total // 20)
    assert len(first.items) == 20


def test_scale_filtering_and_selected_role_stay_correct(scale_db):
    session, _, _ = scale_db
    everything = players_service.search_players(session, scope="all_records", page_size=1)
    role_filtered = players_service.search_players(
        session, scope="all_records", role=SELECTED_ROLE, page_size=50
    )
    assert 0 < role_filtered.total < everything.total
    assert all(item.result_role == SELECTED_ROLE for item in role_filtered.items)
    scores = [item.result_role_score for item in role_filtered.items]
    assert scores == sorted(scores, reverse=True)

    narrowed = players_service.search_players(
        session,
        scope="all_records",
        role=SELECTED_ROLE,
        rolefit_min=40,
        min_minutes=1500,
        page_size=50,
    )
    assert 0 < narrowed.total < role_filtered.total
    assert all(item.result_role_score >= 40 for item in narrowed.items)
    assert all(item.minutes >= 1500 for item in narrowed.items)


def test_scale_page_walk_visits_every_player_exactly_once(scale_db):
    """A full walk of a large ledger is a permutation of the cohort, not a resample."""
    session, _, _ = scale_db
    seen: list = []
    page = 1
    total_pages = None
    while True:
        body = players_service.search_players(
            session, scope="all_records", sort="rolefit_desc", page=page, page_size=250
        )
        total_pages = body.total_pages
        seen.extend(item.id for item in body.items)
        if page >= total_pages:
            assert len(seen) == body.total
            break
        page += 1
    assert len(set(seen)) == len(seen), "a player was served on two pages"
    assert total_pages is not None and total_pages > 15


def test_scale_statement_count_holds_for_the_deepest_page(scale_db):
    session, _, log = scale_db
    deepest = players_service.search_players(session, scope="all_records", page_size=50)
    with log:
        body = players_service.search_players(
            session, scope="all_records", page=deepest.total_pages, page_size=50
        )
    assert body.items
    assert log.count <= MAX_STATEMENTS_PER_SEARCH, log.dump()


# ---------------------------------------------------------------------------
# 5. the Discovery indexes are declared once and migrated
# ---------------------------------------------------------------------------
def test_discovery_indexes_are_in_both_the_metadata_and_a_migration():
    """A composite index added to the models must arrive through a migration too.

    The four `(season_id, player_id)` indexes are what turn Discovery's per-candidate
    correlated lookups into index seeks; a deployed database that never received them
    would fall back to repeated scans. Declaring them in only one of the two places
    is the way that happens quietly, so the two are compared here.
    """
    from importlib import util
    from pathlib import Path

    from app.models.orm import Base

    migration_path = (
        Path(__file__).resolve().parents[4]
        / "db"
        / "migrations"
        / "versions"
        / "0006_discovery_query_indexes.py"
    )
    assert migration_path.exists(), migration_path
    spec = util.spec_from_file_location("discovery_index_migration", migration_path)
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    declared = {
        index.name: (table.name, [column.name for column in index.columns])
        for table in Base.metadata.tables.values()
        for index in table.indexes
        if index.name.endswith("_season_player")
    }
    migrated = {name: (table, columns) for name, (table, columns) in migration.INDEXES.items()}
    assert declared == migrated, (declared, migrated)
    assert len(declared) == 4, declared


def test_the_discovery_query_plan_uses_the_composite_indexes(scale_db):
    """The candidate query seeks rather than scans, which is why the indexes exist."""
    session, cohort, _ = scale_db
    if session.get_bind().dialect.name != "sqlite":
        pytest.skip("EXPLAIN QUERY PLAN is SQLite's own format")

    filters = discovery_repo.DiscoveryFilters(
        season_id=cohort.season_id,
        universe_key="mvp_u23_att_mid_eu",
        scope="all_records",
        playstyle="volume_shooter",
        season_end=cohort.season_end,
    )
    candidates = discovery_repo._Candidates(filters)
    statement = candidates.select_from(select(func.count(func.distinct(Player.id))))
    engine = session.get_bind()
    sql = str(statement.compile(engine, compile_kwargs={"literal_binds": True}))
    with engine.connect() as connection:
        plan = [row[-1] for row in connection.exec_driver_sql("EXPLAIN QUERY PLAN " + sql)]

    joined = "\n".join(plan)
    for index in (
        "ix_appearances_season_player",
        "ix_role_ratings_season_player",
        "ix_market_values_season_player",
        "ix_player_playstyles_season_player",
    ):
        assert index in joined, f"{index} unused:\n{joined}"
    # No step re-scans a whole table for every candidate.
    offenders = [
        step
        for step in plan
        if step.startswith("SCAN ")
        and not step.startswith("SCAN CONSTANT")
        and "SUBQUERY" not in step
    ]
    assert not offenders, f"{offenders}\n{joined}"
