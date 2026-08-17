"""Phase 8.3 - the Discovery ranking explanation is true, and stays true.

Three things could go wrong with an explanation of an ordering, and every test here
defends one of them.

1. **It could describe an ordering the database does not apply.** Guarded twice over.
   Structurally, by compiling the real ``ORDER BY`` and asserting the declared key
   sequence appears in it, in the declared order, one fragment per key - and by
   mutating a spec and proving BOTH the SQL and the explanation move with it. A second
   hand-written description map would fail that test immediately. Behaviourally, by an
   INDEPENDENT oracle: `expected_order` is a transcription of the documented ordering
   contract, written from the contract, over the SERIALIZED CARD FIELDS, which never
   imports or calls `discovery_sort`. Every mode's whole returned page is differenced
   against it.
2. **It could say something false about what ordered the page.** The role context
   names the rating every result displays; only under the RoleFit modes did that
   rating also order anything, and the Age, Expected Asking and Name modes must say so
   rather than implying RoleFit ranked them.
3. **It could cost something.** Guarded by the same statement counting Phase 8.1B
   uses: a request with a full explanation still issues four statements, none of which
   mentions a single player id.

The cohort is `discovery_cohort.build_cohort`, which deliberately contains a tie at
every level: equal scores with different confidence, equal score AND confidence with
different names, different names that lowercase to the same key so only the player id
can separate them, unrated players, unknown ages, unknown asking endpoints, and a
duplicated name/score/confidence triple.
"""

from __future__ import annotations

import re

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.orm import Base, Player
from app.repositories import discovery_repo, discovery_sort
from app.services import players_service

from .discovery_cohort import (
    OTHER_ROLE,
    SELECTED_ROLE,
    SORTS,
    UNICODE_LOWER_COLLISIONS,
    build_cohort,
)

#: Same ceiling Phase 8.1B documents: room for one extra lookup, no room for
#: per-player work.
MAX_STATEMENTS_PER_SEARCH = 8

#: The modes that genuinely order by a stored RoleFit rating. Written out here rather
#: than derived, so a specification that quietly stopped ordering by RoleFit - or
#: started - is caught rather than accommodated.
ROLEFIT_SORTS = ("rolefit_desc", "rolefit_asc")
NON_ROLEFIT_SORTS = ("age_asc", "age_desc", "value_desc", "value_asc", "name_asc")


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------
class _StatementLog:
    def __init__(self, engine):
        self.statements: list = []
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

    def dump(self) -> str:
        return "\n---\n".join(self.statements)


@pytest.fixture(scope="module")
def cohort_db():
    engine = create_engine(
        "sqlite://",
        future=True,
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    session = factory()
    cohort = build_cohort(session)
    session.commit()
    log = _StatementLog(engine)
    yield session, cohort, log
    session.close()
    engine.dispose()


@pytest.fixture()
def empty_db():
    """A migrated but completely empty database: no season, no players."""
    engine = create_engine(
        "sqlite://",
        future=True,
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, future=True)()
    yield session
    session.close()
    engine.dispose()


def _search(session, **kwargs):
    kwargs.setdefault("scope", "all_records")
    kwargs.setdefault("page_size", 100)
    return players_service.search_players(session, **kwargs)


# ---------------------------------------------------------------------------
# 1. the declared key sequence
#
# Written out longhand from the documented contract rather than read back out of
# SORT_SPECS, so the specification itself is pinned to what was signed off.
# ---------------------------------------------------------------------------
_NAME_THEN_ID = ("canonical_name", "player_id")

EXPECTED_KEY_SEQUENCE = {
    "rolefit_desc": ("rated_first", "result_role_score", "result_role_confidence", *_NAME_THEN_ID),
    "rolefit_asc": ("rated_first", "result_role_score", "result_role_confidence", *_NAME_THEN_ID),
    "age_asc": ("age", *_NAME_THEN_ID),
    "age_desc": ("age", *_NAME_THEN_ID),
    "value_desc": ("asking_low_known_first", "expected_asking_low_eur", *_NAME_THEN_ID),
    "value_asc": ("asking_low_known_first", "expected_asking_low_eur", *_NAME_THEN_ID),
    "name_asc": ("canonical_name", "player_id"),
}

EXPECTED_DIRECTIONS = {
    "rolefit_desc": ("ascending", "descending", "descending", "ascending", "ascending"),
    "rolefit_asc": ("ascending", "ascending", "descending", "ascending", "ascending"),
    "age_asc": ("ascending", "ascending", "ascending"),
    "age_desc": ("descending", "ascending", "ascending"),
    "value_desc": ("ascending", "descending", "ascending", "ascending"),
    "value_asc": ("ascending", "ascending", "ascending", "ascending"),
    "name_asc": ("ascending", "ascending"),
}


def test_every_api_sort_mode_has_a_specification():
    """No accepted sort may be unexplainable, and none may be explainable-only."""
    assert set(discovery_sort.SORT_SPECS) == set(players_service.SEARCH_SORTS)
    assert set(EXPECTED_KEY_SEQUENCE) == set(players_service.SEARCH_SORTS)
    assert set(ROLEFIT_SORTS) | set(NON_ROLEFIT_SORTS) == set(players_service.SEARCH_SORTS)


@pytest.mark.parametrize("sort", SORTS)
def test_the_reported_key_sequence_is_the_documented_one(cohort_db, sort):
    session, _, _ = cohort_db
    ranking = _search(session, sort=sort).ranking

    assert tuple(k.key for k in ranking.keys) == EXPECTED_KEY_SEQUENCE[sort]
    assert tuple(k.position for k in ranking.keys) == tuple(range(1, len(ranking.keys) + 1))
    assert tuple(k.direction for k in ranking.keys) == EXPECTED_DIRECTIONS[sort]
    # Every mode ends with canonical name then player id, and those two are the
    # reported tie-breakers... except name_asc, where the name IS the ordering.
    assert tuple(k.key for k in ranking.keys)[-1] == "player_id"
    expected_tie_breakers = ("player_id",) if sort == "name_asc" else _NAME_THEN_ID
    assert tuple(k.key for k in ranking.tie_breakers) == expected_tie_breakers


@pytest.mark.parametrize("sort", SORTS)
def test_confidence_is_a_key_only_in_the_rolefit_modes(cohort_db, sort):
    """It is an ordering key nowhere else, and never before the score."""
    session, _, _ = cohort_db
    keys = [k.key for k in _search(session, sort=sort).ranking.keys]
    if sort in ROLEFIT_SORTS:
        assert keys.index("result_role_confidence") > keys.index("result_role_score")
    else:
        assert "result_role_confidence" not in keys


@pytest.mark.parametrize("sort", ("value_desc", "value_asc"))
def test_the_asking_modes_name_the_lower_endpoint_and_only_it(cohort_db, sort):
    session, _, _ = cohort_db
    ranking = _search(session, sort=sort).ranking
    measure = next(k for k in ranking.keys if k.unit == "eur")
    assert measure.key == "expected_asking_low_eur"
    assert measure.label == "Expected Asking (Lower Endpoint)"
    assert "low endpoint" in measure.rule.lower()
    # The other two readings a scout might assume are ruled out in so many words.
    assert "never the high endpoint" in measure.rule.lower()
    assert "never a midpoint" in measure.rule.lower()
    assert not any("high" in k.key for k in ranking.keys)


# ---------------------------------------------------------------------------
# 2. the specification drives the SQL, structurally
# ---------------------------------------------------------------------------
def _candidates_for(session, **filter_kwargs):
    """A real `_Candidates` over the cohort's own season, and its sort context."""
    from app.repositories.players_repo import get_current_season

    current = get_current_season(session)
    filters = discovery_repo.DiscoveryFilters(
        season_id=current.id,
        universe_key="mvp_u23_att_mid_eu",
        scope="all_records",
        season_end=current.end_date,
        **filter_kwargs,
    )
    candidates = discovery_repo._Candidates(filters)
    collation = discovery_repo.code_point_collation(session)
    return candidates, candidates.sort_context(collation), collation


def _compiled_order_by(session, sort, **filter_kwargs) -> str:
    """The ORDER BY text of a real Discovery page statement."""
    candidates, _, collation = _candidates_for(session, **filter_kwargs)
    stmt = candidates.select_from(select(Player.id)).order_by(*candidates.order_by(sort, collation))
    compiled = str(stmt.compile(session.get_bind()))
    return re.sub(r"\s+", " ", compiled[compiled.rindex("ORDER BY") :]).strip()


@pytest.mark.parametrize("sort", SORTS)
def test_the_sql_order_by_is_exactly_the_declared_key_sequence(cohort_db, sort):
    """The SQL is the specification, not a parallel copy of it.

    The executed ORDER BY is consumed one declared key at a time: each key's own
    compiled expression must be the next thing in it, and when the last key has been
    consumed nothing may remain. A key dropped from the SQL, reordered, duplicated,
    described-but-never-applied, or applied-but-never-described all fail here.
    """
    session, _, _ = cohort_db
    order_by = _compiled_order_by(session, sort)
    _, context, _ = _candidates_for(session)
    spec = discovery_sort.spec_for(sort)

    remainder = order_by[len("ORDER BY ") :]
    for index, key in enumerate(spec.keys):
        fragment = re.sub(r"\s+", " ", str(key.order(context).compile(session.get_bind()))).strip()
        separator = "" if index == 0 else ", "
        assert remainder.startswith(separator + fragment), (
            f"{sort}: key {index + 1} ({key.key}) is not the next ORDER BY clause.\n"
            f"expected: {fragment}\nremaining: {remainder}"
        )
        remainder = remainder[len(separator + fragment) :]
    assert remainder == "", f"{sort}: ORDER BY carries clauses no key declares: {remainder}"


def test_changing_the_specification_moves_the_sql_and_the_explanation_together(
    cohort_db, monkeypatch
):
    """The drift test.

    Remove the final tie-break from ONE mode's specification and both consumers must
    notice: the compiled ORDER BY loses a clause and the reported key sequence loses
    an entry. If the explanation were a second hand-written map, only the SQL would
    move here and this test would fail.
    """
    session, _, _ = cohort_db
    original = discovery_sort.spec_for("name_asc")
    before_sql = _compiled_order_by(session, "name_asc")
    before_keys = [k.key for k in _search(session, sort="name_asc").ranking.keys]

    shortened = discovery_sort.SortSpec(
        sort=original.sort,
        label=original.label,
        direction=original.direction,
        direction_label=original.direction_label,
        summary=original.summary,
        missing_values=original.missing_values,
        keys=original.keys[:-1],
    )
    monkeypatch.setitem(discovery_sort.SORT_SPECS, "name_asc", shortened)

    after_sql = _compiled_order_by(session, "name_asc")
    after_keys = [k.key for k in _search(session, sort="name_asc").ranking.keys]

    assert before_keys == ["canonical_name", "player_id"]
    assert after_keys == ["canonical_name"]
    assert after_sql.count(",") == before_sql.count(",") - 1
    assert "players.id ASC" in before_sql and "players.id ASC" not in after_sql


# ---------------------------------------------------------------------------
# 3. an INDEPENDENT oracle for the ordering itself
#
# Transcribed from the documented ordering contract, over the SERIALIZED CARD
# fields. It does not import, call or mirror `discovery_sort`, so a specification
# that drifted from the signed-off contract cannot satisfy both this and section 2.
# ---------------------------------------------------------------------------
_CONFIDENCE_ORDER = {"unknown": 0, "low": 1, "medium": 2, "high": 3}


def expected_order(sort: str, cards: list) -> list:
    """The card ids in the order the written contract says they must be served in.

    RoleFit: rated before unrated, then score, then confidence DESCENDING in both
    directions, then the lowercased name, then the id. Age: displayed rounded age with
    unknowns last in both directions, then name, then id. Expected Asking: known lower
    endpoint first in both directions, then that endpoint, then name, then id. Name:
    the lowercased name, then the id.
    """

    def name_then_id(card):
        return (card.canonical_name.lower(), card.id)

    def confidence(card):
        return _CONFIDENCE_ORDER.get(card.result_role_confidence or "unknown", 0)

    if sort in ROLEFIT_SORTS:
        sign = -1.0 if sort == "rolefit_desc" else 1.0

        def key(card):
            return (
                card.result_role_score is None,
                sign * (card.result_role_score or 0.0),
                -confidence(card),
                *name_then_id(card),
            )

    elif sort in ("age_asc", "age_desc"):
        sign = 1.0 if sort == "age_asc" else -1.0

        def key(card):
            return (card.age is None, sign * (card.age or 0.0), *name_then_id(card))

    elif sort in ("value_desc", "value_asc"):
        sign = -1.0 if sort == "value_desc" else 1.0

        def key(card):
            return (
                card.expected_asking_low_eur is None,
                sign * (card.expected_asking_low_eur or 0.0),
                *name_then_id(card),
            )

    elif sort == "name_asc":
        key = name_then_id
    else:  # pragma: no cover - a new sort must be transcribed into this oracle
        raise AssertionError(f"unhandled sort {sort}")

    return [card.id for card in sorted(cards, key=key)]


@pytest.mark.parametrize("sort", SORTS)
@pytest.mark.parametrize("role", (None, SELECTED_ROLE, OTHER_ROLE))
def test_the_served_order_is_the_documented_one(cohort_db, sort, role):
    """Every mode, every role context, the whole cohort, against the contract.

    This is what makes the reported key sequence meaningful: the database really does
    order by those keys, in that order, including every tie-break the cohort forces.
    """
    session, _, _ = cohort_db
    body = _search(session, sort=sort, role=role)
    # `OTHER_ROLE` is rated for only a handful of the cohort, which is the point of
    # including it; the unfiltered contexts are the ones that must stay broad enough
    # to reach every tie-break.
    floor = 3 if role == OTHER_ROLE else 10
    assert len(body.items) > floor, "the cohort stopped exercising the tie-breaks"
    assert [item.id for item in body.items] == expected_order(
        sort, body.items
    ), f"{sort} role={role}: served order is not the documented ordering"


@pytest.mark.parametrize("sort", SORTS)
def test_the_order_survives_paging(cohort_db, sort):
    """Paging is a window onto the same ordering, not a re-ordering per page."""
    session, _, _ = cohort_db
    whole = [item.id for item in _search(session, sort=sort, page_size=100).items]
    paged: list = []
    for page in range(1, 6):
        paged += [item.id for item in _search(session, sort=sort, page=page, page_size=5).items]
    assert paged == whole[: len(paged)]


# ---------------------------------------------------------------------------
# 4. the specific ties the cohort was built to force
# ---------------------------------------------------------------------------
def _position_of(body, player_id: int) -> int:
    return [item.id for item in body.items].index(player_id)


def test_equal_scores_are_separated_by_confidence(cohort_db):
    """Zzz-High must precede Aaa-Low: on an equal score the confidence decides.

    And it decides DESCENDING, which is why the alphabetically later name wins here -
    the name never gets to speak.
    """
    session, cohort, _ = cohort_db
    high = cohort.id_of("Cohort Zzz Tie High Confidence")
    low = cohort.id_of("Cohort Aaa Tie Low Confidence")
    body = _search(session, sort="rolefit_desc", role=SELECTED_ROLE)
    assert _position_of(body, high) + 1 == _position_of(body, low)

    high_card = next(item for item in body.items if item.id == high)
    low_card = next(item for item in body.items if item.id == low)
    assert high_card.result_role_score == low_card.result_role_score
    assert high_card.result_role_confidence == "high"
    # The reported sequence is what says confidence may speak at all, and only after
    # the score.
    keys = [k.key for k in body.ranking.keys]
    assert keys.index("result_role_confidence") == keys.index("result_role_score") + 1


@pytest.mark.parametrize("sort", ROLEFIT_SORTS)
def test_confidence_breaks_ties_downward_in_both_rolefit_directions(cohort_db, sort):
    """Ascending RoleFit still puts High Confidence first on an equal score."""
    session, cohort, _ = cohort_db
    high = cohort.id_of("Cohort Zzz Tie High Confidence")
    low = cohort.id_of("Cohort Aaa Tie Low Confidence")
    body = _search(session, sort=sort, role=SELECTED_ROLE)
    assert _position_of(body, high) < _position_of(body, low)
    confidence_key = next(k for k in body.ranking.keys if k.key == "result_role_confidence")
    assert confidence_key.direction == "descending"
    assert "equal score" in confidence_key.rule.lower()


def test_a_shared_name_score_and_confidence_falls_through_to_the_player_id(cohort_db):
    session, cohort, _ = cohort_db
    first, second = cohort.ids_of("Cohort Identical Twin")
    body = _search(session, sort="rolefit_desc", role=SELECTED_ROLE)
    assert _position_of(body, first) + 1 == _position_of(body, second)
    assert first < second, "the lower id must be served first"
    assert body.ranking.tie_breakers[-1].key == "player_id"


@pytest.mark.parametrize("first,second", UNICODE_LOWER_COLLISIONS)
def test_names_that_lowercase_to_the_same_key_fall_through_to_the_player_id(
    cohort_db, first, second
):
    """Different stored spellings, one lowered key: only the id can order them."""
    session, cohort, _ = cohort_db
    ids = sorted(cohort.ids_of(first) + ([] if first == second else cohort.ids_of(second)))
    body = _search(session, sort="name_asc")
    assert _position_of(body, ids[0]) + 1 == _position_of(body, ids[1])


def test_unrated_players_are_placed_last_and_the_explanation_says_so(cohort_db):
    session, _, _ = cohort_db
    body = _search(session, sort="rolefit_desc")
    rated = [item.has_rolefit_analysis for item in body.items]
    assert rated == sorted(rated, reverse=True)
    assert False in rated, "the cohort stopped containing an unrated player"

    placement = next(k for k in body.ranking.keys if k.unit == "rating_status")
    assert placement.position == 1
    assert placement.role == "placement"
    assert "before players without one" in placement.rule
    assert "never read as zero" in placement.rule
    assert "after every rated player" in body.ranking.missing_values


@pytest.mark.parametrize("sort", ("age_asc", "age_desc"))
def test_unknown_ages_are_placed_last_in_both_directions_and_said_out_loud(cohort_db, sort):
    session, _, _ = cohort_db
    body = _search(session, sort=sort)
    known = [item.age is not None for item in body.items]
    assert known == sorted(known, reverse=True), "an unknown age escaped the tail"
    assert False in known, "the cohort stopped containing an unknown age"

    measure = next(k for k in body.ranking.keys if k.unit == "age_years")
    assert "unknown ages are placed last" in measure.rule
    assert "unknown age" in body.ranking.missing_values.lower()
    assert "after every known age" in body.ranking.missing_values


@pytest.mark.parametrize("sort", ("value_desc", "value_asc"))
def test_unknown_asking_endpoints_are_placed_last_in_both_directions(cohort_db, sort):
    session, _, _ = cohort_db
    body = _search(session, sort=sort)
    priced = [item.expected_asking_low_eur is not None for item in body.items]
    assert priced == sorted(priced, reverse=True)
    assert False in priced, "the cohort stopped containing an unpriced player"

    placement = next(k for k in body.ranking.keys if k.unit == "price_status")
    assert placement.position == 1
    assert "never read as €0" in placement.rule
    assert "after every priced player" in body.ranking.missing_values


def test_two_players_of_the_same_rounded_age_fall_through_to_the_name(cohort_db):
    """Equal DISPLAYED age must tie even when the birth dates differ."""
    session, cohort, _ = cohort_db
    younger = cohort.id_of("Cohort Aaa Same Rounded Age")
    older = cohort.id_of("Cohort Zzz Same Rounded Age")
    # Narrowed to exactly these two, so nothing else can be interleaved between them.
    body = _search(session, sort="age_asc", q="Same Rounded Age")
    assert [item.id for item in body.items] == [younger, older]
    assert body.items[0].age == body.items[1].age
    assert [k.key for k in body.ranking.tie_breakers] == ["canonical_name", "player_id"]


# ---------------------------------------------------------------------------
# 5. role context: which rating is shown, and whether it ordered anything
# ---------------------------------------------------------------------------
def test_a_selected_role_is_reported_as_the_role_context(cohort_db):
    session, _, _ = cohort_db
    ranking = _search(session, sort="rolefit_desc", role=SELECTED_ROLE).ranking
    assert ranking.role_context.source == "selected_role"
    assert ranking.role_context.role_key == SELECTED_ROLE
    assert ranking.role_context.role_display == "Touchline Winger"
    assert "Touchline Winger" in ranking.role_context.label
    assert "Touchline Winger" in ranking.role_context.detail


def test_no_selected_role_is_reported_as_the_best_role_context(cohort_db):
    session, _, _ = cohort_db
    ranking = _search(session, sort="rolefit_desc").ranking
    assert ranking.role_context.source == "best_role"
    assert ranking.role_context.role_key is None
    assert ranking.role_context.role_display is None
    assert "best role" in ranking.role_context.detail.lower()


@pytest.mark.parametrize("sort", SORTS)
def test_a_selected_role_context_never_mentions_the_best_role(cohort_db, sort):
    """Rule 8: `result_role*` is the selected role, and `best_role*` is not read."""
    session, _, _ = cohort_db
    ranking = _search(session, sort=sort, role=SELECTED_ROLE).ranking
    assert ranking.role_context.source == "selected_role"
    assert "best role" not in ranking.role_context.detail.lower()
    assert "best role" not in ranking.role_context.label.lower()
    assert "no other role" in ranking.role_context.detail.lower()


@pytest.mark.parametrize("sort", ROLEFIT_SORTS)
@pytest.mark.parametrize("role", (None, SELECTED_ROLE))
def test_the_rolefit_modes_say_the_applicable_rating_ordered_the_page(cohort_db, sort, role):
    """Under RoleFit the stored score and confidence really are ordering keys."""
    session, _, _ = cohort_db
    ranking = _search(session, sort=sort, role=role).ranking
    detail = ranking.role_context.detail
    assert "ordering keys" in detail
    assert "score and confidence" in detail
    assert "did not order" not in detail
    # And the claim is true of the sequence actually applied.
    units = [k.unit for k in ranking.keys]
    assert "rolefit_score" in units and "confidence" in units
    assert discovery_sort.spec_for(sort).orders_by_rolefit is True


@pytest.mark.parametrize("sort", NON_ROLEFIT_SORTS)
@pytest.mark.parametrize("role", (None, SELECTED_ROLE))
def test_the_other_modes_never_claim_rolefit_ordered_the_page(cohort_db, sort, role):
    """The correctness fix.

    Age, Expected Asking and Name order by something else entirely. The role context
    still names the rating each result DISPLAYS - that is real and useful - but must
    attribute the ordering to the active sort, and must not read as though a role
    filter ranked the ledger.
    """
    session, _, _ = cohort_db
    ranking = _search(session, sort=sort, role=role).ranking
    detail = ranking.role_context.detail
    spec = discovery_sort.spec_for(sort)

    assert spec.orders_by_rolefit is False
    assert "rolefit_score" not in [k.unit for k in ranking.keys]
    assert "did not order this page" in detail
    assert "ordering keys" not in detail
    # The active sort is named, so the sentence says what DID order the page.
    assert f"{spec.label} sort" in detail
    assert spec.direction_label in detail


@pytest.mark.parametrize("sort", SORTS)
def test_the_role_context_never_credits_a_filter_with_rank(cohort_db, sort):
    """Rule 7: a filter narrows the cohort; it never explains order."""
    session, _, _ = cohort_db
    ranking = _search(
        session, sort=sort, role=SELECTED_ROLE, league="cohort", min_minutes=100
    ).ranking
    lowered = ranking.role_context.detail.lower()
    for word in ("boost", "promot", "rank higher", "because of the filter"):
        assert word not in lowered, ranking.role_context.detail


def test_the_reported_scores_are_the_selected_role_never_the_best_role(cohort_db):
    """The Phase 8.1A defect, restated for the explanation.

    `Cohort Conflicted Winger` is rated 42.0 as the selected role and 88.0 as another.
    Under `role=<selected>` the page is ordered by 42.0 - proven by the independent
    oracle above, which reads `result_role_score` - and the role context names the
    selected role rather than a best role.
    """
    session, cohort, _ = cohort_db
    conflicted = cohort.id_of("Cohort Conflicted Winger")
    body = _search(session, sort="rolefit_desc", role=SELECTED_ROLE)
    card = next(item for item in body.items if item.id == conflicted)
    assert card.result_role_score == 42.0
    assert card.best_role_score == 88.0
    assert body.ranking.role_context.role_key == SELECTED_ROLE
    assert [item.id for item in body.items] == expected_order("rolefit_desc", body.items)


def test_profile_only_players_stay_visibly_unrated(cohort_db):
    """`scope=all_records` admits profile-only players; it never scores them 0."""
    session, cohort, _ = cohort_db
    unrated = cohort.id_of("Cohort Unrated Defender")
    body = _search(session, sort="rolefit_desc")
    card = next(item for item in body.items if item.id == unrated)
    assert card.analysis_status == "profile_only"
    assert card.result_role_score is None
    assert card.has_rolefit_analysis is False
    # And the explanation says why it is where it is, without inventing a score.
    assert "never receives a placeholder score" in body.ranking.missing_values


# ---------------------------------------------------------------------------
# 6. page boundaries, single results and empties
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("page", (1, 2, 3))
def test_every_page_carries_the_same_page_level_explanation(cohort_db, page):
    """The explanation describes the ordering, so it does not vary by page."""
    session, _, _ = cohort_db
    first = _search(session, sort="name_asc", page=1, page_size=5).ranking
    other = _search(session, sort="name_asc", page=page, page_size=5).ranking
    assert other.model_dump() == first.model_dump()


def test_a_page_of_one_visible_result_still_explains_the_active_ordering(cohort_db):
    session, _, _ = cohort_db
    body = _search(session, sort="name_asc", page=1, page_size=1)
    assert len(body.items) == 1
    assert body.ranking.keys and body.ranking.tie_breakers and body.ranking.limitation


def test_a_zero_result_page_still_explains_the_active_ordering(cohort_db):
    session, _, _ = cohort_db
    body = _search(session, sort="rolefit_asc", q="no-such-player-anywhere")
    assert body.items == [] and body.total == 0
    assert body.ranking.summary == "Ordered by RoleFit, lowest first."
    assert [k.key for k in body.ranking.keys] == list(EXPECTED_KEY_SEQUENCE["rolefit_asc"])
    assert body.ranking.limitation


def test_a_page_past_the_end_explains_the_page_it_actually_served(cohort_db):
    session, _, _ = cohort_db
    body = _search(session, sort="name_asc", page=999, page_size=5)
    assert body.page == body.total_pages
    assert body.ranking.sort == "name_asc"
    assert [k.key for k in body.ranking.keys] == list(EXPECTED_KEY_SEQUENCE["name_asc"])


def test_a_database_with_no_season_at_all_still_explains_the_active_ordering(empty_db):
    """The seasonless short-circuit answers "what ordering is this?" too."""
    body = players_service.search_players(empty_db, sort="age_desc", role=SELECTED_ROLE)
    assert body.total == 0 and body.items == [] and body.total_pages == 0
    assert body.ranking.summary == "Ordered by age, oldest first."
    assert [k.key for k in body.ranking.keys] == list(EXPECTED_KEY_SEQUENCE["age_desc"])
    assert body.ranking.role_context.source == "selected_role"
    assert "did not order this page" in body.ranking.role_context.detail


# ---------------------------------------------------------------------------
# 7. determinism and cost
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("sort", SORTS)
def test_the_explanation_is_byte_identical_on_repeat(cohort_db, sort):
    session, _, _ = cohort_db
    first = _search(session, sort=sort).model_dump_json()
    second = _search(session, sort=sort).model_dump_json()
    assert first == second


@pytest.mark.parametrize("sort", SORTS)
@pytest.mark.parametrize("role", (None, SELECTED_ROLE))
def test_a_request_with_a_full_explanation_still_costs_four_statements(cohort_db, sort, role):
    session, _, log = cohort_db
    with log:
        body = _search(session, sort=sort, role=role, page_size=100)
    assert body.ranking.keys, "the explanation was not built"
    assert log.count == 4, log.dump()
    assert log.count <= MAX_STATEMENTS_PER_SEARCH


def test_the_explanation_issues_no_per_player_statement(cohort_db):
    """The N+1 gate: no statement may mention a single player id.

    That is what the removed `session.get(Player, pid)` pattern looked like, and it is
    what any per-row explanation would have to look like.
    """
    session, _, log = cohort_db
    with log:
        body = _search(session, sort="rolefit_desc", page_size=100)
    assert len(body.items) > 10
    for statement in log.statements:
        assert not re.search(r"players\.id\s*=\s*\d", statement), statement
    assert log.count == 4, log.dump()


def test_a_deeper_page_costs_the_same_as_the_first(cohort_db):
    session, _, log = cohort_db
    with log:
        _search(session, sort="value_asc", page=1, page_size=5)
    first = log.count
    with log:
        _search(session, sort="value_asc", page=4, page_size=5)
    assert log.count == first == 4


def test_the_explanation_needs_no_session_at_all(cohort_db):
    """It is built from the specification alone - not from rows, and not from a query.

    Calling the builder with no database in reach at all is the strongest available
    statement that it cannot cost a statement or read a player.
    """
    from app.services import _common, discovery_explanation

    session, _, _ = cohort_db
    served = _search(session, sort="value_desc", role=SELECTED_ROLE).ranking
    standalone = discovery_explanation.build(
        sort="value_desc",
        role_key=SELECTED_ROLE,
        role_display_map=_common.role_display_map(),
    )
    assert standalone.model_dump() == served.model_dump()


# ---------------------------------------------------------------------------
# 8. the copy contract
# ---------------------------------------------------------------------------
_FORBIDDEN_WORDS = (
    "recommend",
    "suitab",
    "priority",
    "best signing",
    "should sign",
    "target",
    "verdict",
    "boost",
)


@pytest.mark.parametrize("sort", SORTS)
def test_no_sentence_recommends_rates_or_credits_a_filter(cohort_db, sort):
    """The explanation describes ordering and nothing else.

    "suitability" is allowed in exactly one place - the limitation sentence, which
    exists to deny it.
    """
    session, _, _ = cohort_db
    ranking = _search(session, sort=sort, league="cohort", min_minutes=100).ranking
    sentences = [
        ranking.summary,
        ranking.missing_values,
        ranking.role_context.detail,
        ranking.role_context.label,
    ] + [k.rule for k in ranking.keys]
    for sentence in sentences:
        lowered = sentence.lower()
        for word in _FORBIDDEN_WORDS:
            assert word not in lowered, f"{sort}: {sentence!r} contains {word!r}"
    assert "ordering, not recruitment suitability" in ranking.limitation


@pytest.mark.parametrize("sort", SORTS)
def test_every_sentence_is_bounded_and_terminated(cohort_db, sort):
    session, _, _ = cohort_db
    ranking = _search(session, sort=sort, role=SELECTED_ROLE).ranking
    for sentence in [ranking.summary, ranking.missing_values] + [k.rule for k in ranking.keys]:
        assert sentence.endswith(".")
        assert len(sentence) <= 240, sentence
    # The role context carries two facts - which rating, and whether it ordered - so
    # it is allowed to be longer, but it is still bounded and still a sentence.
    assert ranking.role_context.detail.endswith(".")
    assert len(ranking.role_context.detail) <= 400, ranking.role_context.detail


def test_the_summary_states_the_active_mode_and_direction(cohort_db):
    session, _, _ = cohort_db
    expected = {
        "rolefit_desc": "Ordered by RoleFit, highest first.",
        "rolefit_asc": "Ordered by RoleFit, lowest first.",
        "age_asc": "Ordered by age, youngest first.",
        "age_desc": "Ordered by age, oldest first.",
        "value_desc": "Ordered by Expected Asking, highest first.",
        "value_asc": "Ordered by Expected Asking, lowest first.",
        "name_asc": "Ordered by name, A to Z.",
    }
    for sort, summary in expected.items():
        assert _search(session, sort=sort).ranking.summary == summary


@pytest.mark.parametrize("sort", SORTS)
def test_the_response_carries_no_per_player_ordering_claim(cohort_db, sort):
    """Phase 8.3 is page-level: no field may name or compare an individual result."""
    session, cohort, _ = cohort_db
    body = _search(session, sort=sort, role=SELECTED_ROLE)
    serialized = body.ranking.model_dump_json()
    for name in ("Cohort Zzz Tie High Confidence", "Cohort Identical Twin", "Cohort Conflicted"):
        assert name not in serialized
    assert " appears above " not in serialized
    assert "adjacent" not in serialized.lower()
