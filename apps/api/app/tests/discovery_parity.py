"""Dialect-agnostic Discovery assertions, run on SQLite and on PostgreSQL.

Phase 8.1B moved Discovery's candidate selection, predicates, ordering, counting and
pagination into SQL. ADR 0001 keeps SQLite for local development and tests and
PostgreSQL for the full stack and production, so every semantic this phase relies on
has to hold on both. `assert_discovery_parity` is the single body of assertions; the
SQLite suite and the PostgreSQL smoke both call it, so a divergence fails one of them
rather than reaching production.

The caller owns the transaction: this function writes a cohort and flips the current
season, and expects to be rolled back.
"""

from __future__ import annotations

from scoutboy_shared import POSITIONS, position_group_for
from sqlalchemy import literal, select

from app.models.orm import Player
from app.repositories import discovery_repo
from app.services import players_service

from .discovery_cohort import (
    FILTER_CASES,
    OTHER_ROLE,
    SELECTED_ROLE,
    SORTS,
    UNICODE_LOWER_COLLISIONS,
    build_cohort,
    load_reference_rows,
    reference_search,
)

#: Large enough to hold the whole characterization cohort on one page, so an ordering
#: assertion sees the complete sequence rather than a window of it.
WHOLE_COHORT = 100


def _search(session, **kwargs):
    return players_service.search_players(session, page_size=WHOLE_COHORT, **kwargs)


def _ids(body):
    return [item.id for item in body.items]


def assert_discovery_parity(session) -> dict:
    """Assert every Discovery semantic this phase depends on. Returns a summary."""
    cohort = build_cohort(session)
    reference_rows = load_reference_rows(session, cohort.season_id, cohort.season_end)
    summary = {
        "dialect": session.get_bind().dialect.name,
        "cohort_players": len(reference_rows),
        "matrix_cases": 0,
    }

    _assert_rounded_age_matches_python(session, cohort)
    _assert_position_group_case_matches_domain(session, cohort)
    _assert_unicode_lower_matches_python(session)
    summary["matrix_cases"] = _assert_matches_reference(session, reference_rows)
    _assert_unicode_search_matches_python(session, cohort)
    _assert_like_metacharacters_stay_literal(session, cohort)
    _assert_context_search_semantics(session, cohort)
    _assert_name_ordering_matches_python(session, reference_rows)
    _assert_selected_role_ordering(session, cohort)
    _assert_unknowns_sort_last(session)
    _assert_counting_is_per_player(session, cohort, reference_rows)
    _assert_pagination(session)
    _assert_tie_breaks(session, cohort)
    _assert_ranking_explanation_matches_the_page(session, cohort)
    _assert_season_without_an_end_date_is_answerable(session, cohort)
    return summary


# ---------------------------------------------------------------------------
# portable expressions
# ---------------------------------------------------------------------------
def _assert_rounded_age_matches_python(session, cohort):
    """The SQL age ordering key equals Python's `round(days / 365.25, 1)`.

    This is the one place Discovery does date arithmetic in the database, so it is
    checked directly against the Python expression that produces the displayed age,
    for every birth date in the cohort, on whichever dialect is running.
    """
    age = discovery_repo.rounded_age_expr(Player.birth_date, cohort.season_end)
    rows = session.execute(select(Player.id, Player.birth_date, age)).all()
    checked = 0
    for player_id, birth_date, sql_age in rows:
        if birth_date is None:
            assert sql_age is None, f"player {player_id}: unknown birth date must stay unknown"
            continue
        expected = round((cohort.season_end - birth_date).days / 365.25, 1)
        assert float(sql_age) == expected, f"player {player_id}: {sql_age} != {expected}"
        checked += 1
    assert checked > 10, "cohort no longer exercises the age expression"

    # A NULL season end makes every age unknown, exactly as `age_for` does. The NULL
    # has to be explicitly typed: sent as a bare parameter, PostgreSQL infers `text`
    # and then refuses to return it through a numeric result processor.
    null_age = discovery_repo.rounded_age_expr(Player.birth_date, None)
    assert session.scalar(select(null_age).limit(1)) is None


def _assert_position_group_case_matches_domain(session, cohort):
    """The SQL position-group fallback agrees with `position_group_for`.

    Evaluated with the appearance's stored group forced to NULL, so the CASE is the
    only thing deciding, and against real stored rows rather than literals.
    """
    expr = discovery_repo.position_group_case(
        literal(None, type_=Player.primary_position.type), Player.primary_position
    )
    rows = session.execute(
        select(Player.id, Player.primary_position, expr).where(Player.id.in_(_cohort_ids(cohort)))
    ).all()
    seen = set()
    for player_id, primary_position, group in rows:
        assert group == position_group_for(primary_position or ""), (
            f"player {player_id}: SQL fallback {group!r} disagrees with the domain "
            f"mapping for {primary_position!r}"
        )
        seen.add(primary_position)
    # Both a mapped and an unmapped position must be present, or the CASE is untested.
    assert seen & set(POSITIONS), "cohort has no position the domain maps"
    assert seen - set(POSITIONS), "cohort has no position the domain leaves unmapped"


def _cohort_ids(cohort):
    return [pid for ids in cohort.ids_by_name.values() for pid in ids]


#: Characters whose Python lowercase an inverse-`.upper()` fold cannot reach, plus a
#: control that it can. Every one is evaluated by the database, on both dialects.
_LOWER_PROBES = (
    ("ASCII control", "ABC"),
    ("acute", "ÉTIENNE"),
    ("acute mixed", "Étienne"),
    ("dotted capital i", "İPEK"),
    ("dotless i", "ıpek"),
    ("capital sharp s", "ẞETA"),
    ("small sharp s", "ßeta"),
    ("kelvin sign", "KELVIN"),
    ("ohm sign", "ΩHM"),
    ("long s", "ſoft"),
    ("greek final sigma", "ΟΔΟΣ"),
    ("greek medial sigma", "ΣΑΣ"),
    ("greek tonos", "ΨΥΧΉ"),
    ("cyrillic", "ЖУК"),
    ("mixed script", "Cohort ЖУК Étienne İ"),
    ("empty", ""),
)


def _assert_unicode_lower_matches_python(session):
    """The database's lowercase expression IS Python's `str.lower()`.

    Asserted directly against the expression the query builder uses, before any of the
    predicates that depend on it, so a dialect that lowercases differently fails here
    with the offending string rather than as a mysteriously missing search result.
    """
    from app.core.text_search import unicode_lower

    for label, value in _LOWER_PROBES:
        got = session.scalar(select(unicode_lower(literal(value))))
        assert (
            got == value.lower()
        ), f"{label}: database lowered {value!r} to {got!r}, Python gives {value.lower()!r}"
    # NULL in, NULL out - the ordering key relies on this for a nullable column.
    assert (
        session.scalar(select(unicode_lower(literal(None, type_=Player.canonical_name.type))))
        is None
    )


# ---------------------------------------------------------------------------
# differential: SQL against the pre-8.1B Python implementation
# ---------------------------------------------------------------------------
def _assert_matches_reference(session, reference_rows) -> int:
    """Every filter combination, under every sort, matches the Python reference."""
    cases = 0
    non_empty = 0
    for label, criteria in FILTER_CASES:
        for sort in SORTS:
            body = _search(session, sort=sort, **criteria)
            expected_ids, expected_total, expected_page, expected_pages = reference_search(
                reference_rows, sort=sort, page_size=WHOLE_COHORT, **criteria
            )
            context = f"{label} / {sort}"
            assert body.total == expected_total, f"{context}: total"
            assert body.page == expected_page, f"{context}: page"
            assert body.total_pages == expected_pages, f"{context}: total_pages"
            assert _ids(body) == expected_ids, f"{context}: order"
            cases += 1
            if expected_total:
                non_empty += 1
    assert non_empty > len(FILTER_CASES), "the matrix has collapsed to mostly empty results"
    return cases


# ---------------------------------------------------------------------------
# Unicode text matching, stated as itself
# ---------------------------------------------------------------------------
#: `(query, cohort key, should the player be returned)`. The expectation is not a
#: hand-guess: each is Python's own `needle.lower() in stored.lower()`, restated so the
#: intent of the case is readable, and the assertion recomputes it from `str.lower()`.
_SEARCH_CASES = (
    ("Étienne", "acute", True),
    ("étienne", "acute", True),
    ("ÉTIENNE", "acute", True),
    ("İpek", "dotted_i", True),
    ("i̇pek", "dotted_i", True),  # i + U+0307, which is what "İ".lower() produces
    ("ipek", "dotted_i", False),  # the combining dot is part of the stored key
    ("ẞeta", "sharp_s", True),
    ("ßeta", "sharp_s", True),
    ("sseta", "sharp_s", False),  # `.lower()` never expands ẞ to "ss"
    # U+212A KELVIN SIGN as stored, its Python lowercase, and the ordinary ASCII
    # "K" that shares that lowercase. The first is written as an escape because it
    # is indistinguishable from the third on screen.
    ("Kelvin Sign", "kelvin", True),
    ("kelvin sign", "kelvin", True),
    ("Kelvin Sign", "kelvin", True),
    ("ſoft", "long_s", True),
    ("soft long", "long_s", False),  # ſ is already lowercase; it is not an "s"
    ("ΟΔΟΣ", "final_sigma", True),
    ("οδος", "final_sigma", True),  # final sigma, which is what Python produces
    ("οδοσ", "final_sigma", False),  # medial sigma is a different character
    ("ΨΥΧΉ", "greek_pair", True),
    ("ψυχή", "greek_pair", True),
    ("ЖУК", "cyrillic", True),
    ("жук", "cyrillic", True),
    ("Ωhm", "ohm", True),
    ("ωhm", "ohm", True),
)


def _assert_unicode_search_matches_python(session, cohort):
    """Free text, club, league and nationality all case-fold like `str.lower()`."""
    from .discovery_cohort import UNICODE_NAMES

    for needle, key, expected in _SEARCH_CASES:
        stored = UNICODE_NAMES[key]
        # The expectation is Python's, recomputed rather than trusted from the table.
        assert (
            needle.lower() in stored.lower()
        ) is expected, f"case table is wrong for {needle!r} against {stored!r}"
        found = cohort.id_of(stored) in _ids(_search(session, scope="all_records", q=needle))
        assert (
            found is expected
        ), f"q={needle!r} against stored {stored!r}: expected {expected}, got {found}"

    # The same folding on the club, league and nationality predicates, and across the
    # boundary between two joined haystack fields.
    sharp = cohort.id_of(UNICODE_NAMES["sharp_s"])
    for club in ("straße", "STRAẞE", "Straße FC"):
        assert sharp in _ids(_search(session, scope="all_records", club=club)), club
    sigma = cohort.id_of(UNICODE_NAMES["final_sigma"])
    for league in ("ελλάς", "ΕΛΛΆΣ", "cohort ελλάς"):
        assert sigma in _ids(_search(session, scope="all_records", league=league)), league
    # Nationality is a case-insensitive SUBSTRING since Phase 8.2, and it folds case
    # exactly like the other predicates. The stored "TÜRKİYE" lowercases to a key
    # carrying the combining dot, so a naive "türkiye" still finds nothing - the
    # substring change did not weaken the Unicode rule, it only widened the match.
    dotted = cohort.id_of(UNICODE_NAMES["dotted_i"])
    assert dotted in _ids(_search(session, scope="all_records", nationality="TÜRKİYE"))
    assert dotted in _ids(_search(session, scope="all_records", nationality="türki̇ye"))
    assert dotted in _ids(_search(session, scope="all_records", nationality="TÜRKİ"))  # partial
    assert dotted not in _ids(_search(session, scope="all_records", nationality="türkiye"))
    assert cohort.id_of(UNICODE_NAMES["sharp_s"]) in _ids(
        _search(session, scope="all_records", nationality="großland")
    )
    assert cohort.id_of(UNICODE_NAMES["sharp_s"]) in _ids(
        _search(session, scope="all_records", nationality="GROẞ")  # partial, stored case
    )
    # A needle that spans the name/club boundary of the joined haystack.
    assert sharp in _ids(_search(session, scope="all_records", q="Sharp Cohort straße"))


def _assert_like_metacharacters_stay_literal(session, cohort):
    """`%`, `_` and the escape character are text, not pattern syntax.

    Each needle has a decoy in the cohort that a wildcard reading would also return, so
    these fail loudly if the needle is ever interpolated into a LIKE pattern.
    """
    from .discovery_cohort import LITERAL_PATTERN_NAMES

    for key, decoy_key, needle in (
        ("percent", "percent_decoy", "100% Effort"),
        ("underscore", "underscore_decoy", "A_B"),
        ("escape", "escape_decoy", "Sla/sh"),
    ):
        wanted = cohort.id_of(LITERAL_PATTERN_NAMES[key])
        decoy = cohort.id_of(LITERAL_PATTERN_NAMES[decoy_key])
        found = _ids(_search(session, scope="all_records", q=needle))
        assert wanted in found, f"{needle!r} did not match its own literal record"
        assert decoy not in found, f"{needle!r} matched {LITERAL_PATTERN_NAMES[decoy_key]!r}"

    # `_` in the needle must not match the literal `/` record either.
    assert cohort.id_of(LITERAL_PATTERN_NAMES["escape"]) not in _ids(
        _search(session, scope="all_records", q="Sla_sh")
    )
    # ...and the same holds for the nationality predicate, which became a SUBSTRING in
    # Phase 8.2 and so is now a second place a needle could have been interpolated into
    # a LIKE pattern. Both the whole stored value and a partial one stay literal.
    percent = cohort.id_of(LITERAL_PATTERN_NAMES["percent"])
    underscore = cohort.id_of(LITERAL_PATTERN_NAMES["underscore"])
    assert percent in _ids(_search(session, scope="all_records", nationality="cohort 100% effort"))
    assert percent in _ids(_search(session, scope="all_records", nationality="100%"))
    assert underscore not in _ids(_search(session, scope="all_records", nationality="100%"))
    assert underscore in _ids(_search(session, scope="all_records", nationality="A_B"))
    assert percent not in _ids(_search(session, scope="all_records", nationality="A_B"))


def _assert_context_search_semantics(session, cohort):
    """Phase 8.2 Context behaviour, on whichever dialect is running.

    Nationality is a substring, league also searches the stored country, and the club
    field resolves configured abbreviations. Every case here is written so it can only
    pass for the intended reason: the alias clubs' stored text contains none of the
    abbreviations that must find them, and the England league mentions its country
    nowhere except in the country column.
    """
    from .discovery_cohort import ALIAS_CLUB_PLAYERS

    paris = cohort.id_of(ALIAS_CLUB_PLAYERS["paris"])
    spurs = cohort.id_of(ALIAS_CLUB_PLAYERS["spurs"])

    # -- nationality: partial, mixed case, and still missing-safe ---------------
    for needle in ("England", "eng", "ENG", "gland"):
        assert spurs in _ids(_search(session, scope="all_records", nationality=needle)), needle
    assert paris not in _ids(_search(session, scope="all_records", nationality="England"))
    # A player with no stored nationality never satisfies an active predicate, however
    # short the needle is.
    no_nationality = cohort.id_of("Cohort Unrated No Birth Date")
    assert no_nationality in _ids(_search(session, scope="all_records"))
    for needle in ("a", "e", "land"):
        assert no_nationality not in _ids(
            _search(session, scope="all_records", nationality=needle)
        ), needle

    # -- league: name, slug code and country all reach the same competition -----
    country_only = _ids(_search(session, scope="all_records", league="England"))
    assert {paris, spurs} <= set(country_only), "league did not search the stored country"
    for needle in ("eng", "ENGLAND", "cohort-eng-flight", "Island Flight"):
        assert paris in _ids(_search(session, scope="all_records", league=needle)), needle
    # ...and the deterministic misspelling resolves to the same set as the country.
    portugal = _ids(_search(session, scope="all_records", league="Portugal"))
    assert portugal
    assert _ids(_search(session, scope="all_records", league="portgual")) == portugal
    assert _ids(_search(session, scope="all_records", league="por")) == portugal
    # A league with a NULL country is still searchable by its other parts.
    assert _ids(_search(session, scope="all_records", league="ελλάς"))

    # -- club: aliases resolve, punctuation and case are tolerated --------------
    for needle in ("psg", "PSG", " P.S.G. ", "Paris SG", "paris  sg"):
        assert _ids(_search(session, scope="all_records", club=needle)) == [paris], needle
    for needle in ("spurs", "SPURS", "thfc", "T.H.F.C."):
        assert _ids(_search(session, scope="all_records", club=needle)) == [spurs], needle
    # A non-alias needle is still an ordinary substring, over slug and name alike.
    assert _ids(_search(session, scope="all_records", club="Tottenham")) == [spurs]
    assert _ids(_search(session, scope="all_records", club="cohort-paris_sg")) == [paris]
    # ...and an alias target reaches the SLUG, not only the canonical name: `psg`'s
    # `paris_sg` target is a substring of this cohort's prefixed slug.
    assert _ids(_search(session, scope="all_records", club="Saint-Germain")) == [paris]
    assert paris not in _ids(_search(session, scope="all_records", club="cohort-home"))
    assert not _ids(_search(session, scope="all_records", club="no-such-club"))

    # -- whole-input club aliases also work in the main search ------------------
    for needle in ("psg", "P.S.G."):
        assert paris in _ids(_search(session, scope="all_records", q=needle)), needle
    assert spurs in _ids(_search(session, scope="all_records", q="Spurs"))
    # ...and `q` keeps its ordinary free-text reach at the same time.
    assert spurs in _ids(_search(session, scope="all_records", q="Tottenham"))

    # -- aliases still compose with AND -----------------------------------------
    assert _ids(_search(session, scope="all_records", club="psg", position_group="ATT")) == [paris]
    assert not _ids(_search(session, scope="all_records", club="psg", position_group="MID"))
    assert not _ids(_search(session, scope="all_records", club="psg", nationality="England"))
    assert _ids(
        _search(session, scope="all_records", club="psg", league="England", min_minutes=1000)
    ) == [paris]

    # -- the count agrees with the rows an alias returns ------------------------
    body = _search(session, scope="all_records", club="psg")
    assert body.total == len(body.items) == 1


def _assert_name_ordering_matches_python(session, reference_rows):
    """`name_asc` is exactly `(canonical_name.lower(), player_id)`.

    Compared against the key computed in Python for the same cohort, so a database that
    lowercases differently - or collates the lowered values in a locale order rather
    than by code point - fails here rather than in a subtly reshuffled ledger.
    """
    items = _search(session, scope="all_records", sort="name_asc").items
    got = [(item.canonical_name, item.id) for item in items]
    expected = sorted(
        ((row.canonical_name, row.player_id) for row in reference_rows),
        key=lambda pair: (pair[0].lower(), pair[1]),
    )
    assert got == expected, "name_asc disagrees with (canonical_name.lower(), player_id)"

    # Distinct spellings that lowercase to the same key must be adjacent and ordered by
    # player id, which is the only thing left to separate them.
    from .discovery_cohort import UNICODE_LOWER_COLLISIONS

    ordered_ids = [item.id for item in items]
    for first, second in UNICODE_LOWER_COLLISIONS:
        assert (
            first != second and first.lower() == second.lower()
        ), f"{first!r}/{second!r} is no longer a lowercase collision"
        pair = sorted(
            session.scalars(
                select(Player.id).where(Player.canonical_name.in_([first, second]))
            ).all()
        )
        assert len(pair) == 2, f"{first!r}/{second!r} is not in the cohort"
        positions = [ordered_ids.index(player_id) for player_id in pair]
        assert positions == sorted(positions), f"{first!r}/{second!r} not ordered by player id"
        assert abs(positions[0] - positions[1]) == 1, f"{first!r}/{second!r} not adjacent"


# ---------------------------------------------------------------------------
# the invariants stated as themselves, not only as "same as the reference"
# ---------------------------------------------------------------------------
def _assert_selected_role_ordering(session, cohort):
    """A role-filtered ledger reports and orders by the selected role."""
    conflicted = cohort.id_of("Cohort Conflicted Winger")
    for direction, reverse in (("rolefit_desc", True), ("rolefit_asc", False)):
        body = _search(session, role=SELECTED_ROLE, sort=direction)
        assert body.items, direction
        assert all(item.result_role == SELECTED_ROLE for item in body.items), direction
        assert all(item.result_role_source == "selected_role" for item in body.items), direction
        scores = [item.result_role_score for item in body.items]
        assert all(score is not None for score in scores), direction
        assert scores == sorted(scores, reverse=reverse), direction

        row = next(item for item in body.items if item.id == conflicted)
        assert row.result_role_score == 42.0
        assert row.result_role_confidence == "low"
        assert row.confidence == row.result_role_confidence
        # ...while the best role stays independently truthful
        assert row.best_role == OTHER_ROLE
        assert row.best_role_score == 88.0
        assert row.best_role_confidence == "high"

    # With no role the same player is judged on its own best rating instead.
    default_row = next(item for item in _search(session).items if item.id == conflicted)
    assert default_row.result_role == OTHER_ROLE
    assert default_row.result_role_score == 88.0
    assert default_row.result_role_source == "best_role"

    # A player without the selected rating does not qualify at all.
    midfielder = cohort.id_of("Cohort Midfield Anchor")
    assert midfielder not in _ids(_search(session, scope="all_records", role=SELECTED_ROLE))


def _assert_unknowns_sort_last(session):
    """Unrated, undated and unpriced records trail known values in both directions."""
    for direction in ("rolefit_desc", "rolefit_asc"):
        flags = [
            item.has_rolefit_analysis
            for item in _search(session, scope="all_records", sort=direction).items
        ]
        assert any(flags) and not all(flags), direction
        assert flags == sorted(flags, reverse=True), direction

    for direction in ("value_asc", "value_desc"):
        items = _search(session, scope="all_records", sort=direction).items
        known = [item.expected_asking_low_eur is not None for item in items]
        assert any(known) and not all(known), direction
        assert known == sorted(known, reverse=True), direction
        lows = [
            item.expected_asking_low_eur
            for item in items
            if item.expected_asking_low_eur is not None
        ]
        assert lows == sorted(lows, reverse=(direction == "value_desc")), direction
        # nothing unknown is reported as EUR 0
        assert all(
            item.expected_asking_low_eur is None or item.expected_asking_low_eur > 0
            for item in items
        ), direction

    for direction in ("age_asc", "age_desc"):
        items = _search(session, scope="all_records", sort=direction).items
        known = [item.age is not None for item in items]
        assert any(known) and not all(known), direction
        assert known == sorted(known, reverse=True), direction
        ages = [item.age for item in items if item.age is not None]
        assert ages == sorted(ages, reverse=(direction == "age_desc")), direction


def _assert_counting_is_per_player(session, cohort, reference_rows):
    """A player with several appearances, ratings, markets or playstyles counts once."""
    body = _search(session, scope="all_records")
    ids = _ids(body)
    assert len(ids) == len(set(ids)), "a player appeared twice on one page"
    assert body.total == len(reference_rows)

    for name, expected_minutes in (
        ("Cohort Multi Appearance", 2600),  # greatest-minutes appearance supplies the row
        ("Cohort Tied Appearance Minutes", 1500),
        ("Cohort Many Playstyles", 1800),
        ("Cohort High Coverage Member", 1800),
    ):
        player_id = cohort.id_of(name)
        matching = [item for item in body.items if item.id == player_id]
        assert len(matching) == 1, f"{name} contributed {len(matching)} rows"
        assert matching[0].minutes == expected_minutes, name
        assert matching[0].represented_minutes == expected_minutes, name

    # The playstyle predicate reads positives only, so a concern-only holder fails it.
    concerns_only = cohort.id_of("Cohort Concerns Only")
    positive = _ids(_search(session, scope="all_records", playstyle="volume_shooter"))
    assert concerns_only not in positive
    assert cohort.id_of("Cohort Many Playstyles") in positive
    assert positive == sorted(set(positive), key=positive.index)
    assert not _ids(_search(session, scope="all_records", playstyle="inflated_market"))

    # High coverage: eligible members only, and the evidence status follows.
    high = _search(session, scope="high_coverage_u23")
    assert cohort.id_of("Cohort High Coverage Member") in _ids(high)
    assert cohort.id_of("Cohort Ineligible Member") not in _ids(high)
    assert all(item.is_high_coverage for item in high.items)
    assert all(item.evidence_status == "high_coverage" for item in high.items)


def _assert_pagination(session):
    """Paging through the ledger reproduces the single-page ordering exactly."""
    full = _ids(_search(session, scope="all_records", sort="rolefit_desc"))
    assert len(full) > 6

    page_size = 4
    walked: list = []
    page = 1
    while True:
        body = players_service.search_players(
            session, scope="all_records", sort="rolefit_desc", page=page, page_size=page_size
        )
        assert body.page == page
        assert len(body.items) <= page_size
        walked.extend(_ids(body))
        if page >= body.total_pages:
            assert body.total == len(full)
            break
        page += 1
    assert walked == full, "page-by-page order differs from the whole-ledger order"

    # A page past the end serves the last real page and says so.
    beyond = players_service.search_players(
        session, scope="all_records", sort="rolefit_desc", page=999, page_size=page_size
    )
    assert beyond.page == beyond.total_pages
    assert beyond.items
    assert _ids(beyond) == full[(beyond.total_pages - 1) * page_size :]

    # A genuinely empty result is page 1 with no pages.
    empty = players_service.search_players(
        session, scope="all_records", q="no-such-player-anywhere", page=7, page_size=page_size
    )
    assert (empty.items, empty.total, empty.page, empty.total_pages) == ([], 0, 1, 0)


def _assert_tie_breaks(session, cohort):
    """Confidence, then canonical name, then player id - in that order."""
    body = _search(session, role=SELECTED_ROLE, sort="rolefit_desc")
    ids = _ids(body)

    # Equal selected score: the higher SELECTED confidence wins, even though the
    # canonical-name tie-break alone would order these two the other way round.
    low_conf = cohort.id_of("Cohort Aaa Tie Low Confidence")
    high_conf = cohort.id_of("Cohort Zzz Tie High Confidence")
    assert ids.index(high_conf) < ids.index(low_conf)

    # Identical name, score and confidence: only the player id can separate them, and
    # it does so ascending and repeatably.
    twins = cohort.ids_of("Cohort Identical Twin")
    assert len(twins) == 2
    assert [i for i in ids if i in twins] == twins
    assert _ids(_search(session, role=SELECTED_ROLE, sort="rolefit_desc")) == ids

    # Same rounded age, different birth dates: the age sorts tie them and fall through
    # to canonical name, rather than ordering by the underlying date.
    early = cohort.id_of("Cohort Aaa Same Rounded Age")
    late = cohort.id_of("Cohort Zzz Same Rounded Age")
    for direction in ("age_asc", "age_desc"):
        aged = _ids(_search(session, scope="all_records", sort=direction))
        assert aged.index(early) < aged.index(late), direction

    # name_asc is canonical name then player id, nothing else.
    by_name = _search(session, scope="all_records", sort="name_asc").items
    keys = [(item.canonical_name.lower(), item.id) for item in by_name]
    assert keys == sorted(keys)


#: The documented key sequence per mode, written out here so both dialects are held
#: to the SAME contract rather than to whatever `discovery_sort` currently declares.
_RANKING_KEY_SEQUENCE = {
    "rolefit_desc": ["rated_first", "result_role_score", "result_role_confidence"],
    "rolefit_asc": ["rated_first", "result_role_score", "result_role_confidence"],
    "age_asc": ["age"],
    "age_desc": ["age"],
    "value_desc": ["asking_low_known_first", "expected_asking_low_eur"],
    "value_asc": ["asking_low_known_first", "expected_asking_low_eur"],
    "name_asc": [],
}

_CONFIDENCE_ORDER = {"unknown": 0, "low": 1, "medium": 2, "high": 3}


def _expected_order(sort, cards):
    """The served id order, transcribed from the contract over CARD fields.

    Deliberately independent of `discovery_sort`: if the specification and the
    contract ever disagree on either dialect, this is what notices.
    """

    def name_then_id(card):
        return (card.canonical_name.lower(), card.id)

    if sort in ("rolefit_desc", "rolefit_asc"):
        sign = -1.0 if sort == "rolefit_desc" else 1.0

        def key(card):
            return (
                card.result_role_score is None,
                sign * (card.result_role_score or 0.0),
                -_CONFIDENCE_ORDER.get(card.result_role_confidence or "unknown", 0),
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

    else:
        key = name_then_id
    return [card.id for card in sorted(cards, key=key)]


def _assert_ranking_explanation_matches_the_page(session, cohort):
    """Phase 8.3: the explanation describes the ordering BOTH databases apply.

    Three things are held identical across dialects:

    1. the reported key sequence per mode (the contract, written out above);
    2. the served order itself, against an independent transcription of that same
       contract over the serialized card fields;
    3. the name and player-id tie-breaks, which are where a dialect could most
       plausibly disagree - PostgreSQL lowercases through ICU and SQLite through a
       registered `str.lower()`, so two spellings that collapse to one key must land
       adjacent and in id order on both.
    """
    for sort in SORTS:
        body = _search(session, scope="all_records", sort=sort)
        ranking = body.ranking
        # Every mode ends with canonical name then player id. In `name_asc` the name
        # IS the ordering rather than a tie-break, so only the id is reported as one.
        expected = _RANKING_KEY_SEQUENCE[sort] + ["canonical_name", "player_id"]
        tie_breakers = ["player_id"] if sort == "name_asc" else ["canonical_name", "player_id"]
        assert [k.key for k in ranking.keys] == expected, sort
        assert [k.key for k in ranking.tie_breakers] == tie_breakers, sort
        assert ranking.limitation and ranking.summary.endswith("."), sort
        assert [item.id for item in body.items] == _expected_order(sort, body.items), sort

    # The role context tells the truth about what ordered each mode: RoleFit only
    # where RoleFit is a key, and the named sort everywhere else.
    for sort in SORTS:
        detail = _search(session, scope="all_records", sort=sort, role=SELECTED_ROLE).ranking
        detail = detail.role_context.detail
        if sort.startswith("rolefit_"):
            assert "ordering keys" in detail, sort
        else:
            assert "did not order this page" in detail, sort
        assert "best role" not in detail.lower(), sort

    # The tie-break tail, on the cohort rows built to force it: same name, same score,
    # same confidence, so only the id can separate them.
    twins = cohort.ids_of("Cohort Identical Twin")
    by_role = _search(session, role=SELECTED_ROLE, sort="rolefit_desc")
    served = [item.id for item in by_role.items]
    assert served.index(twins[0]) + 1 == served.index(twins[1])

    # Different stored spellings that lowercase to ONE key - `Cohort Kelvin Twin`
    # spelled with U+212A KELVIN SIGN and with an ASCII K. Nothing can sort between
    # them, so the id must decide. This is the assertion most exposed to a dialect
    # difference: the lowered key comes from ICU on PostgreSQL and from a registered
    # `str.lower()` on SQLite.
    by_name = [item.id for item in _search(session, scope="all_records", sort="name_asc").items]
    for first, second in UNICODE_LOWER_COLLISIONS:
        pair_ids = sorted(cohort.ids_of(first) + cohort.ids_of(second))
        assert len(pair_ids) == 2, (first, second)
        assert by_name.index(pair_ids[0]) + 1 == by_name.index(pair_ids[1]), (first, second)

    # The explanation of a one-row page is complete, because it describes the
    # ordering rather than the rows.
    one = players_service.search_players(
        session, scope="all_records", sort="name_asc", page=1, page_size=1
    )
    assert len(one.items) == 1
    assert one.ranking.keys and one.ranking.tie_breakers and one.ranking.limitation


def _assert_season_without_an_end_date_is_answerable(session, cohort):
    """A season with no end date makes every age unknown, and still serves a page.

    `Season.end_date` is nullable, so this is a reachable production state: the age
    ordering key becomes a typed NULL and every age bound excludes every record. It is
    asserted here rather than only in a unit test because the failure mode is
    dialect-specific - PostgreSQL rejects an untyped NULL in a numeric position that
    SQLite accepts silently.
    """
    from app.models.orm import Season

    season = session.get(Season, cohort.season_id)
    original = season.end_date
    season.end_date = None
    session.flush()
    try:
        for sort in ("age_asc", "age_desc", "rolefit_desc", "name_asc"):
            body = _search(session, scope="all_records", sort=sort)
            assert body.items, sort
            assert all(item.age is None for item in body.items), sort
        # Every age bound now excludes every record, exactly as an unknown age did.
        for bounds in ({"age_min": 19}, {"age_max": 40}, {"age_band": "u23"}):
            assert _search(session, scope="all_records", **bounds).total == 0, bounds
    finally:
        season.end_date = original
        session.flush()
