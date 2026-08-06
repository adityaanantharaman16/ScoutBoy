"""Phase 8.1A - the Discovery contract's internal truthfulness.

The invariant every test here defends:

    the role, score and confidence shown on a Discovery result are the SAME stored
    role rating that filtered and ordered that result.

Before this phase the service ordered by the selected role's score while
serializing the player's best-role score and confidence, so a role-filtered ledger
looked mis-sorted. Fixtures below deliberately make the two disagree - a player
whose best role is NOT the selected role, and by a wide margin - so no assertion
can pass by accident.
"""

from __future__ import annotations

import pytest
from scoutboy_shared import DISPLAY_SCALE_MAX, MINUTES_FILTER_MAX

SELECTED_ROLE = "touchline_winger"
OTHER_ROLE = "inside_forward"


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------
def _season_team_comp(db_session):
    from sqlalchemy import select

    from app.models.orm import Competition, Season, Team

    return (
        db_session.scalar(select(Season).where(Season.is_current.is_(True))),
        db_session.scalar(select(Team)),
        db_session.scalar(select(Competition)),
    )


def _insert_rated_player(
    db_session,
    *,
    name,
    ratings,
    minutes=1800,
    position_group="ATT",
    asking=None,
    birth_date=None,
):
    """A player-season with explicit stored role ratings.

    `ratings` maps role_key -> (final_score, confidence). `asking` is an
    (low, high) expected-asking pair, or None for no market record at all -
    which is how "market information is unknown" is represented, never as 0.
    """
    from app.models.orm import Appearance, MarketValue, Player, RoleRating

    season, team, comp = _season_team_comp(db_session)
    player = Player(
        canonical_name=name,
        birth_date=birth_date,
        nationality="Testland",
        primary_position="RW",
        secondary_positions=[],
    )
    db_session.add(player)
    db_session.flush()
    db_session.add(
        Appearance(
            player_id=player.id,
            team_id=team.id,
            competition_id=comp.id,
            season_id=season.id,
            minutes=minutes,
            appearances=20,
            starts=18,
            position_group=position_group,
        )
    )
    for role_key, (score, confidence) in ratings.items():
        db_session.add(
            RoleRating(
                player_id=player.id,
                role_key=role_key,
                season_id=season.id,
                version="test",
                raw_score=score,
                context_adjusted_score=score,
                final_score=score,
                confidence=confidence,
            )
        )
    if asking is not None:
        low, high = asking
        db_session.add(
            MarketValue(
                player_id=player.id,
                season_id=season.id,
                expected_asking_low_eur=low,
                expected_asking_high_eur=high,
                confidence="medium",
                label="fair",
                version="test",
            )
        )
    db_session.commit()
    return player.id


def _item(body, player_id):
    return next(i for i in body["items"] if i["id"] == player_id)


def _get(client, query):
    r = client.get(f"/api/players?{query}")
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Scope 1 - the result's role context is the one that filtered and ordered it
# ---------------------------------------------------------------------------
def test_selected_role_result_reports_the_selected_rating_not_the_best_one(client, db_session):
    """The exact defect: best role and selected role differ by 40 points."""
    pid = _insert_rated_player(
        db_session,
        name="Context Mismatch Winger",
        ratings={SELECTED_ROLE: (44.0, "low"), OTHER_ROLE: (84.0, "high")},
    )

    item = _item(_get(client, f"role={SELECTED_ROLE}&page_size=100"), pid)

    # the result context IS the selected role, with its own stored figures
    assert item["result_role"] == SELECTED_ROLE
    assert item["result_role_display"] == "Touchline Winger"
    assert item["result_role_score"] == 44.0
    assert item["result_role_confidence"] == "low"
    assert item["result_role_source"] == "selected_role"
    # the headline confidence follows the applicable context, not the best role
    assert item["confidence"] == "low"
    # ...and the best role stays independently truthful rather than being relabelled
    assert item["best_role"] == OTHER_ROLE
    assert item["best_role_score"] == 84.0
    assert item["best_role_confidence"] == "high"


def test_no_role_selected_keeps_the_best_role_as_the_result_context(client, db_session):
    pid = _insert_rated_player(
        db_session,
        name="Best Role Default Winger",
        ratings={SELECTED_ROLE: (41.0, "low"), OTHER_ROLE: (81.0, "high")},
    )

    item = _item(_get(client, "page_size=100"), pid)

    assert item["result_role_source"] == "best_role"
    assert item["result_role"] == item["best_role"] == OTHER_ROLE
    assert item["result_role_score"] == item["best_role_score"] == 81.0
    assert item["result_role_confidence"] == item["best_role_confidence"] == "high"
    assert item["confidence"] == "high"


def test_best_and_selected_role_fields_are_never_conflated(client, db_session):
    """Across a whole role-filtered page, the two contexts stay distinguishable."""
    _insert_rated_player(
        db_session,
        name="Conflation Guard Winger",
        ratings={SELECTED_ROLE: (38.0, "low"), OTHER_ROLE: (88.0, "high")},
    )
    body = _get(client, f"role={SELECTED_ROLE}&page_size=100")

    assert body["items"]
    assert all(i["result_role"] == SELECTED_ROLE for i in body["items"])
    # at least one row where the two genuinely differ, so the page cannot be passing
    # merely because the selected role happens to be everybody's best role
    differing = [i for i in body["items"] if i["best_role"] != SELECTED_ROLE]
    assert differing, "fixture cohort no longer exercises a best/selected mismatch"
    for i in differing:
        assert i["result_role_score"] != i["best_role_score"]


def test_a_player_without_the_selected_stored_role_does_not_qualify(client, db_session):
    only_other = _insert_rated_player(
        db_session,
        name="Single Role Forward",
        ratings={OTHER_ROLE: (77.0, "high")},
    )
    body = _get(client, f"scope=all_records&role={SELECTED_ROLE}&page_size=100")
    assert only_other not in [i["id"] for i in body["items"]]


def test_profile_only_players_stay_unrated_with_no_placeholder_score(client, db_session):
    from app.tests.test_api import _insert_profile_only_player

    pid = _insert_profile_only_player(db_session, name="Unrated Contract Keeper")
    item = _item(_get(client, "scope=all_records&page_size=100"), pid)

    assert item["has_rolefit_analysis"] is False
    assert item["result_role"] is None
    assert item["result_role_score"] is None
    assert item["result_role_confidence"] == "unknown"
    assert item["best_role"] is None
    assert item["best_role_score"] is None
    assert item["result_role_source"] == "best_role"


# ---------------------------------------------------------------------------
# Scope 1/4 - RoleFit bounds and ordering use the applicable role context
# ---------------------------------------------------------------------------
def test_rolefit_bounds_use_the_selected_role_rating(client, db_session):
    """A high best role must not smuggle a player past a selected-role floor."""
    pid = _insert_rated_player(
        db_session,
        name="Bounds Mismatch Winger",
        ratings={SELECTED_ROLE: (30.0, "medium"), OTHER_ROLE: (90.0, "high")},
    )

    # the selected-role score (30) is below the floor, even though best role is 90
    above = _get(client, f"role={SELECTED_ROLE}&rolefit_min=50&page_size=100")
    assert pid not in [i["id"] for i in above["items"]]

    # and it is inside a band that only the selected-role score satisfies
    inside = _get(client, f"role={SELECTED_ROLE}&rolefit_min=25&rolefit_max=35&page_size=100")
    assert pid in [i["id"] for i in inside["items"]]

    # with no role selected the same player is judged on the best role instead
    by_best = _get(client, "rolefit_min=85&page_size=100")
    assert pid in [i["id"] for i in by_best["items"]]


@pytest.mark.parametrize("direction", ["desc", "asc"])
def test_selected_role_ordering_uses_the_selected_score(client, db_session, direction):
    low = _insert_rated_player(
        db_session,
        name="Order Selected Low",
        ratings={SELECTED_ROLE: (20.0, "high"), OTHER_ROLE: (95.0, "high")},
    )
    high = _insert_rated_player(
        db_session,
        name="Order Selected High",
        ratings={SELECTED_ROLE: (70.0, "high"), OTHER_ROLE: (71.0, "high")},
    )
    body = _get(client, f"role={SELECTED_ROLE}&sort=rolefit_{direction}&page_size=100")
    ids = [i["id"] for i in body["items"]]

    # ordered by the SELECTED score (20 vs 70), not the best-role score (95 vs 71)
    if direction == "desc":
        assert ids.index(high) < ids.index(low)
    else:
        assert ids.index(low) < ids.index(high)

    # and the displayed sequence is monotonic in the displayed score, which is what
    # made the old behaviour visible as an apparently mis-sorted ledger
    scores = [i["result_role_score"] for i in body["items"]]
    assert scores == sorted(scores, reverse=(direction == "desc"))


def test_confidence_tie_break_uses_the_selected_role_confidence(client, db_session):
    """Equal selected-role scores; only the selected-role confidence may decide."""
    weak_selected = _insert_rated_player(
        db_session,
        # named so the canonical-name tie-break would put it FIRST, proving the
        # confidence tie-break is what actually orders these two
        name="Aaa Tie Selected Low Conf",
        ratings={SELECTED_ROLE: (60.0, "low"), OTHER_ROLE: (99.0, "high")},
    )
    strong_selected = _insert_rated_player(
        db_session,
        name="Zzz Tie Selected High Conf",
        ratings={SELECTED_ROLE: (60.0, "high"), OTHER_ROLE: (61.0, "low")},
    )
    ids = [
        i["id"]
        for i in _get(client, f"role={SELECTED_ROLE}&sort=rolefit_desc&page_size=100")["items"]
    ]
    assert ids.index(strong_selected) < ids.index(weak_selected)


def test_unrated_players_stay_after_rated_in_both_rolefit_directions(client, db_session):
    from app.tests.test_api import _insert_profile_only_player

    _insert_profile_only_player(db_session, name="Unrated Both Directions")
    for direction in ("desc", "asc"):
        body = _get(client, f"scope=all_records&sort=rolefit_{direction}&page_size=100")
        flags = [i["has_rolefit_analysis"] for i in body["items"]]
        assert flags == sorted(flags, reverse=True), direction


def test_name_and_id_tie_breaks_are_stable(client, db_session):
    """Identical score and confidence: name then id, repeatably."""
    for suffix in ("Beta", "Alpha"):
        _insert_rated_player(
            db_session,
            name=f"Tiebreak Twin {suffix}",
            ratings={SELECTED_ROLE: (55.5, "medium")},
        )
    first = _get(client, f"role={SELECTED_ROLE}&sort=rolefit_desc&page_size=100")
    second = _get(client, f"role={SELECTED_ROLE}&sort=rolefit_desc&page_size=100")
    assert [i["id"] for i in first["items"]] == [i["id"] for i in second["items"]]

    twins = [i["canonical_name"] for i in first["items"] if "Tiebreak Twin" in i["canonical_name"]]
    assert twins == ["Tiebreak Twin Alpha", "Tiebreak Twin Beta"]


# ---------------------------------------------------------------------------
# Scope 2 - the minutes contract, separate from the RoleFit scale
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("value", [0, 450, 900, 1500, 2000, 10000])
def test_realistic_minute_thresholds_are_accepted(client, value):
    assert client.get(f"/api/players?min_minutes={value}&page_size=5").status_code == 200


@pytest.mark.parametrize("value", [-1, 10001])
def test_minute_thresholds_outside_the_documented_range_are_rejected(client, value):
    r = client.get(f"/api/players?min_minutes={value}")
    assert r.status_code == 422
    assert any("min_minutes" in str(e.get("loc", "")) for e in r.json()["detail"])


def test_a_realistic_minute_threshold_actually_narrows_the_result_set(client, db_session):
    """450 used to be a 422; it now has to reach the filter and mean something."""
    short = _insert_rated_player(
        db_session,
        name="Short Season Winger",
        ratings={SELECTED_ROLE: (70.0, "medium")},
        minutes=300,
    )
    long = _insert_rated_player(
        db_session,
        name="Full Season Winger",
        ratings={SELECTED_ROLE: (70.0, "medium")},
        minutes=2400,
    )
    ids = [i["id"] for i in _get(client, "min_minutes=450&page_size=100")["items"]]
    assert short not in ids
    assert long in ids


def test_stored_minutes_are_never_capped_by_the_filter_ceiling(client, db_session):
    pid = _insert_rated_player(
        db_session,
        name="High Minutes Winger",
        ratings={SELECTED_ROLE: (70.0, "medium")},
        minutes=3400,
    )
    item = _item(_get(client, "min_minutes=1500&page_size=100"), pid)
    assert item["minutes"] == 3400
    assert item["represented_minutes"] == 3400


def test_the_two_ceilings_are_separate_constants_with_separate_meanings():
    from app.api.routes import players as players_route

    assert players_route.ROLEFIT_FILTER_MAX == int(DISPLAY_SCALE_MAX) == 99
    assert players_route.MIN_MINUTES_FILTER_MAX == MINUTES_FILTER_MAX == 10_000


def test_rolefit_bounds_remain_on_the_authoritative_zero_to_ninety_nine_scale(client):
    assert client.get("/api/players?rolefit_min=99&page_size=5").status_code == 200
    assert client.get("/api/players?rolefit_max=99&page_size=5").status_code == 200
    # the minutes ceiling must not have leaked into the RoleFit bounds
    assert client.get("/api/players?rolefit_min=100").status_code == 422
    assert client.get("/api/players?rolefit_max=10000").status_code == 422


# ---------------------------------------------------------------------------
# Scope 3 - deterministic, missing-safe asking-price ordering
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("direction", ["asc", "desc"])
def test_missing_asking_lower_bound_sorts_last_in_both_price_directions(
    client, db_session, direction
):
    unknown = _insert_rated_player(
        db_session,
        # a name that would win the canonical-name tie-break, so a "missing sorts
        # last" failure cannot hide behind alphabetical luck
        name="Aaa No Market Winger",
        ratings={SELECTED_ROLE: (65.0, "medium")},
        asking=None,
    )
    body = _get(client, f"role={SELECTED_ROLE}&sort=value_{direction}&page_size=100")
    known_flags = [i["expected_asking_low_eur"] is not None for i in body["items"]]
    assert any(known_flags) and not all(known_flags)
    # every known lower bound precedes every unknown one, in BOTH directions
    assert known_flags == sorted(known_flags, reverse=True), direction
    # and the alphabetically-first record is in that trailing unknown block rather
    # than at the head, so the ordering is not just alphabetical luck
    trailing = [i["id"] for i in body["items"] if i["expected_asking_low_eur"] is None]
    assert unknown in trailing
    assert body["items"][0]["id"] != unknown

    # ...and it is reported as unknown, never as EUR 0
    item = _item(body, unknown)
    assert item["expected_asking_low_eur"] is None
    assert item["expected_asking_high_eur"] is None


def test_price_sorts_order_by_the_known_lower_bound(client, db_session):
    cheap = _insert_rated_player(
        db_session,
        name="Price Order Cheap",
        ratings={SELECTED_ROLE: (50.0, "medium")},
        asking=(1_000_000, 90_000_000),
    )
    dear = _insert_rated_player(
        db_session,
        name="Price Order Dear",
        ratings={SELECTED_ROLE: (50.0, "medium")},
        asking=(80_000_000, 85_000_000),
    )
    asc = [i["id"] for i in _get(client, "sort=value_asc&page_size=100")["items"]]
    desc = [i["id"] for i in _get(client, "sort=value_desc&page_size=100")["items"]]

    # ordered by the LOW endpoint (1m < 80m), which the wide-range player wins on
    # ascending despite having the higher upper bound
    assert asc.index(cheap) < asc.index(dear)
    assert desc.index(dear) < desc.index(cheap)


def test_value_predicates_never_substitute_zero_for_a_missing_endpoint(client, db_session):
    unknown = _insert_rated_player(
        db_session,
        name="Value Predicate No Market",
        ratings={SELECTED_ROLE: (66.0, "medium")},
        asking=None,
    )
    # unknown is not "cheap": it fails an active ceiling instead of passing as 0
    assert unknown not in [
        i["id"] for i in _get(client, "value_max=5000000&page_size=100")["items"]
    ]
    # and it is not "expensive" either
    assert unknown not in [i["id"] for i in _get(client, "value_min=1&page_size=100")["items"]]


def test_value_range_requires_an_overlapping_known_interval(client, db_session):
    inside = _insert_rated_player(
        db_session,
        name="Value Range Overlapping",
        ratings={SELECTED_ROLE: (60.0, "medium")},
        asking=(20_000_000, 30_000_000),
    )
    below = _insert_rated_player(
        db_session,
        name="Value Range Below",
        ratings={SELECTED_ROLE: (60.0, "medium")},
        asking=(1_000_000, 2_000_000),
    )
    ids = [
        i["id"]
        for i in _get(client, "value_min=25000000&value_max=40000000&page_size=100")["items"]
    ]
    assert inside in ids
    assert below not in ids


@pytest.mark.parametrize(
    "query,field",
    [
        ("value_min=50&value_max=10", "value_min"),
        ("value_min=-1", "value_min"),
        ("value_max=-1", "value_max"),
    ],
)
def test_invalid_price_ranges_are_rejected(client, query, field):
    r = client.get(f"/api/players?{query}")
    assert r.status_code == 422
    assert any(field in str(e.get("loc", "")) for e in r.json()["detail"])


def test_an_equal_price_range_is_still_valid(client):
    assert client.get("/api/players?value_min=10&value_max=10&page_size=5").status_code == 200


# ---------------------------------------------------------------------------
# Scope 4 - validated sort / position group / role
# ---------------------------------------------------------------------------
def test_every_documented_sort_mode_is_accepted(client):
    from app.services.players_service import SEARCH_SORTS

    for sort in SEARCH_SORTS:
        assert client.get(f"/api/players?sort={sort}&page_size=5").status_code == 200, sort


def test_age_desc_remains_a_supported_api_only_sort(client):
    body = _get(client, "sort=age_desc&page_size=100")
    ages = [i["age"] for i in body["items"] if i["age"] is not None]
    assert ages == sorted(ages, reverse=True)


@pytest.mark.parametrize(
    "query,field",
    [
        ("sort=not_a_sort", "sort"),
        ("sort=rolefit", "sort"),
        ("position_group=STRIKER", "position_group"),
        ("position_group=att", "position_group"),
        ("role=not_a_role", "role"),
    ],
)
def test_unknown_enumerated_values_are_rejected_rather_than_silently_ignored(client, query, field):
    r = client.get(f"/api/players?{query}")
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert any(field in str(e.get("loc", "")) for e in detail)


@pytest.mark.parametrize("group", ["ATT", "MID", "DEF", "GK"])
def test_every_discoverable_position_group_is_accepted(client, group):
    assert client.get(f"/api/players?scope=all_records&position_group={group}").status_code == 200


def test_every_configured_role_key_is_accepted(client):
    roles = client.get("/api/methodology").json()["roles"]
    assert roles
    for role in roles:
        key = role["role_key"]
        assert client.get(f"/api/players?role={key}&page_size=5").status_code == 200, key


# ---------------------------------------------------------------------------
# Scope 5 - pagination correctness
# ---------------------------------------------------------------------------
def test_a_page_past_the_end_returns_the_last_available_page(client):
    first = _get(client, "page_size=5&page=1")
    assert first["total_pages"] >= 1

    beyond = _get(client, "page_size=5&page=999")
    assert beyond["page"] == beyond["total_pages"]
    # crucially NOT an empty ledger that would read as "no players match"
    assert beyond["items"]
    assert beyond["total"] == first["total"]


def test_a_genuinely_empty_result_reports_page_one(client):
    body = _get(client, "q=no-such-player-anywhere&page=7&page_size=5")
    assert body["items"] == []
    assert body["total"] == 0
    assert body["page"] == 1
    assert body["total_pages"] == 0


def test_an_in_range_page_is_served_unchanged(client):
    body = _get(client, "page_size=5&page=2")
    assert body["page"] == 2


def test_page_and_page_size_bounds_are_enforced(client):
    assert client.get("/api/players?page=0").status_code == 422
    assert client.get("/api/players?page=-1").status_code == 422
    assert client.get("/api/players?page_size=0").status_code == 422
    assert client.get("/api/players?page_size=101").status_code == 422
    assert client.get("/api/players?page_size=100&page=1").status_code == 200
