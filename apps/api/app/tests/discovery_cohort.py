"""Shared Discovery test material: a deterministic cohort, a Python reference
implementation of the Phase 8.1A semantics, and dialect-agnostic assertions.

This module is imported by the SQLite suite (`test_discovery_sql.py`) and by the
PostgreSQL smoke (`test_postgres_smoke.py`) so both make *the same* semantic
assertions against *the same* fixture. Nothing here is dialect-aware; if SQLite and
PostgreSQL disagree about anything Discovery relies on, one of the two runs fails.

`reference_search` is a transcription of the pre-8.1B in-Python implementation, kept
deliberately naive: it loads the whole cohort, filters with a predicate per row, sorts
with a tuple key and slices a page. It is the oracle the SQL rewrite is differenced
against, so it must not be re-derived from the SQL implementation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from scoutboy_shared import MVP_UNIVERSE_KEY, position_group_for
from sqlalchemy import insert, select, update

from app.models.orm import (
    Appearance,
    Competition,
    MarketValue,
    Player,
    PlayerPlaystyle,
    PlayerUniverseMembership,
    RoleRating,
    Season,
    Team,
)

SELECTED_ROLE = "touchline_winger"
OTHER_ROLE = "inside_forward"
THIRD_ROLE = "shadow_striker"

#: A season far outside anything the sample fixtures use, so a cohort built inside a
#: transaction on a seeded database cannot be confused with the seeded season.
COHORT_SEASON_LABEL = "2098/99"
COHORT_SEASON_END = date(2099, 5, 31)

_CONF_ORDER = {"unknown": 0, "low": 1, "medium": 2, "high": 3}


# ---------------------------------------------------------------------------
# cohort construction
# ---------------------------------------------------------------------------
@dataclass
class Cohort:
    season_id: int
    season_label: str
    season_end: date
    #: canonical name -> the player ids carrying it (a name may be shared on purpose).
    ids_by_name: dict = field(default_factory=dict)

    def id_of(self, name: str) -> int:
        ids = self.ids_by_name[name]
        assert len(ids) == 1, f"{name} is deliberately duplicated; use ids_of"
        return ids[0]

    def ids_of(self, name: str) -> list:
        return sorted(self.ids_by_name[name])


def _born(years_before_end: float, *, season_end: date) -> date:
    """A birth date whose rounded age is close to `years_before_end`."""
    return season_end - _timedelta_days(int(round(years_before_end * 365.25)))


def _timedelta_days(days: int):
    from datetime import timedelta

    return timedelta(days=days)


def build_cohort(session, *, scale: int = 0) -> Cohort:
    """Insert a deterministic Discovery cohort and make its season current.

    The cohort is designed so that no assertion can pass by accident: best and
    selected role ratings conflict, scores tie with differing confidence, two players
    share a name *and* a score *and* a confidence so only the player id can separate
    them, some players have no rating, no birth date, no market row or only one market
    endpoint, one player carries only concern playstyles, one has several appearance
    rows and one has two appearance rows with identical minutes.

    `scale` adds that many extra generated player-seasons with ratings, markets,
    playstyles, missing values and score ties, for the volume tests.

    Nothing is committed: callers run inside a transaction and roll back.
    """
    session.execute(update(Season).values(is_current=False))
    season = Season(
        label=COHORT_SEASON_LABEL,
        start_date=date(2098, 8, 1),
        end_date=COHORT_SEASON_END,
        is_current=True,
    )
    session.add(season)
    session.flush()

    league = Competition(slug="cohort-league", name="Cohort Premier League", is_european=True)
    other_league = Competition(slug="cohort-second", name="Cohort Second Division")
    # A league whose name only matches once the haystack has been lowercased the way
    # Python does it: the final sigma in "ΕΛΛΆΣ" is context-sensitive.
    greek_league = Competition(slug="cohort-ellas", name="Cohort ΕΛΛΆΣ Division")
    session.add_all([league, other_league, greek_league])
    session.flush()
    home = Team(slug="cohort-home", canonical_name="Cohort Home", league_id=league.id)
    away = Team(slug="cohort-away", canonical_name="Cohort Away", league_id=other_league.id)
    accented = Team(slug="cohort-saint", canonical_name="Cohort Saint-Étienne", league_id=league.id)
    # "ẞ" uppercases to "SS", so its lowercase cannot be found by inverting `.upper()`.
    sharp = Team(
        slug="cohort-strasse", canonical_name="Cohort STRAẞE FC", league_id=greek_league.id
    )
    session.add_all([home, away, accented, sharp])
    session.flush()

    cohort = Cohort(
        season_id=season.id,
        season_label=COHORT_SEASON_LABEL,
        season_end=COHORT_SEASON_END,
        ids_by_name={},
    )
    end = COHORT_SEASON_END

    def add(
        name,
        *,
        ratings=None,
        minutes=1800,
        position_group="ATT",
        primary_position="RW",
        nationality="Cohortia",
        birth_date=None,
        asking=None,
        market_label="fair",
        playstyles=(),
        universe=None,
        team=home,
        competition=league,
        extra_appearances=(),
    ):
        player = Player(
            canonical_name=name,
            birth_date=birth_date,
            nationality=nationality,
            primary_position=primary_position,
            secondary_positions=[],
        )
        session.add(player)
        session.flush()
        cohort.ids_by_name.setdefault(name, []).append(player.id)
        session.add(
            Appearance(
                player_id=player.id,
                team_id=team.id,
                competition_id=competition.id,
                season_id=season.id,
                minutes=minutes,
                appearances=20,
                starts=15,
                position_group=position_group,
            )
        )
        for extra_minutes, extra_team, extra_comp in extra_appearances:
            session.add(
                Appearance(
                    player_id=player.id,
                    team_id=extra_team.id,
                    competition_id=extra_comp.id,
                    season_id=season.id,
                    minutes=extra_minutes,
                    appearances=5,
                    starts=3,
                    position_group=position_group,
                )
            )
        for role_key, (score, confidence) in (ratings or {}).items():
            session.add(
                RoleRating(
                    player_id=player.id,
                    role_key=role_key,
                    season_id=season.id,
                    version="cohort",
                    raw_score=score,
                    context_adjusted_score=score,
                    final_score=score,
                    confidence=confidence,
                )
            )
        if asking is not None:
            low, high = asking
            session.add(
                MarketValue(
                    player_id=player.id,
                    season_id=season.id,
                    expected_asking_low_eur=low,
                    expected_asking_high_eur=high,
                    confidence="medium",
                    label=market_label,
                    version="cohort",
                )
            )
        for key, tier, is_concern in playstyles:
            session.add(
                PlayerPlaystyle(
                    player_id=player.id,
                    season_id=season.id,
                    playstyle_key=key,
                    tier=tier,
                    confidence="medium",
                    is_concern=is_concern,
                    why_applied_json={},
                    version="cohort",
                )
            )
        if universe is not None:
            session.add(
                PlayerUniverseMembership(
                    player_id=player.id,
                    season_id=season.id,
                    universe_key=MVP_UNIVERSE_KEY,
                    eligible=universe,
                    reasons_json={},
                )
            )
        return player.id

    # -- best vs selected role conflict, by a wide margin --------------------
    add(
        "Cohort Conflicted Winger",
        ratings={SELECTED_ROLE: (42.0, "low"), OTHER_ROLE: (88.0, "high")},
        birth_date=_born(24, season_end=end),
        asking=(12_000_000, 20_000_000),
        playstyles=(("volume_shooter", "elite", False), ("dribble_carrier", "base", False)),
        universe=True,
    )
    add(
        "Cohort Aligned Winger",
        ratings={SELECTED_ROLE: (71.0, "medium"), OTHER_ROLE: (55.0, "low")},
        birth_date=_born(22, season_end=end),
        asking=(30_000_000, 45_000_000),
        playstyles=(("dribble_carrier", "plus", False),),
        universe=True,
    )
    # -- equal selected score, different selected confidence ----------------
    # Named so the canonical-name tie-break would order them the other way round.
    add(
        "Cohort Aaa Tie Low Confidence",
        ratings={SELECTED_ROLE: (60.0, "low"), OTHER_ROLE: (95.0, "high")},
        birth_date=_born(27, season_end=end),
        asking=(5_000_000, 9_000_000),
    )
    add(
        "Cohort Zzz Tie High Confidence",
        ratings={SELECTED_ROLE: (60.0, "high"), OTHER_ROLE: (61.0, "low")},
        birth_date=_born(29, season_end=end),
        asking=(5_000_000, 9_000_000),
    )
    # -- identical name, score and confidence: only the player id separates them
    for _ in range(2):
        add(
            "Cohort Identical Twin",
            ratings={SELECTED_ROLE: (55.5, "medium")},
            birth_date=_born(25, season_end=end),
            asking=(7_000_000, 8_000_000),
        )
    # -- unrated, and unrated with no birth date ----------------------------
    add(
        "Cohort Unrated Defender",
        primary_position="CB",
        position_group="DEF",
        minutes=240,
        birth_date=_born(31, season_end=end),
        asking=(1_000_000, 2_000_000),
    )
    add(
        "Cohort Unrated No Birth Date",
        primary_position="GK",
        position_group="GK",
        minutes=90,
        birth_date=None,
    )
    add(
        "Cohort Rated No Birth Date",
        ratings={SELECTED_ROLE: (48.0, "medium")},
        birth_date=None,
        asking=(3_000_000, 4_000_000),
    )
    # -- market edge cases --------------------------------------------------
    add(
        "Cohort Aaa No Market Row",
        ratings={SELECTED_ROLE: (65.0, "medium")},
        birth_date=_born(23, season_end=end),
        asking=None,
    )
    add(
        "Cohort Low Endpoint Only",
        ratings={SELECTED_ROLE: (64.0, "medium")},
        birth_date=_born(26, season_end=end),
        asking=(2_500_000, None),
        market_label="value",
    )
    add(
        "Cohort High Endpoint Only",
        ratings={SELECTED_ROLE: (63.0, "medium")},
        birth_date=_born(28, season_end=end),
        asking=(None, 40_000_000),
        market_label="premium",
    )
    # -- playstyles: four positives across tiers, and concerns only ---------
    add(
        "Cohort Many Playstyles",
        ratings={SELECTED_ROLE: (58.0, "high")},
        birth_date=_born(21, season_end=end),
        asking=(15_000_000, 25_000_000),
        playstyles=(
            ("volume_shooter", "base", False),
            ("dribble_carrier", "elite", False),
            ("progressive_passer", "plus", False),
            ("press_resistant", "plus", False),
            ("inflated_market", None, True),
        ),
    )
    add(
        "Cohort Concerns Only",
        ratings={SELECTED_ROLE: (57.0, "low")},
        birth_date=_born(30, season_end=end),
        asking=(900_000, 1_100_000),
        playstyles=(("volume_shooter", None, True), ("inflated_market", None, True)),
    )
    # -- universe membership: eligible, explicitly not eligible, absent -----
    add(
        "Cohort High Coverage Member",
        ratings={SELECTED_ROLE: (69.0, "high"), THIRD_ROLE: (70.0, "medium")},
        birth_date=_born(20, season_end=end),
        asking=(50_000_000, 70_000_000),
        universe=True,
    )
    add(
        "Cohort Ineligible Member",
        ratings={SELECTED_ROLE: (44.0, "low")},
        birth_date=_born(33, season_end=end),
        asking=(400_000, 600_000),
        universe=False,
    )
    # -- several appearances, and two appearances with identical minutes ----
    add(
        "Cohort Multi Appearance",
        ratings={SELECTED_ROLE: (61.0, "medium")},
        birth_date=_born(24, season_end=end),
        minutes=2600,
        asking=(11_000_000, 13_000_000),
        extra_appearances=((400, away, other_league), (1200, accented, league)),
    )
    add(
        "Cohort Tied Appearance Minutes",
        ratings={SELECTED_ROLE: (62.0, "medium")},
        birth_date=_born(24, season_end=end),
        minutes=1500,
        asking=(6_000_000, 6_500_000),
        extra_appearances=((1500, away, other_league),),
    )
    # -- position-group fallback, and an unmapped position ------------------
    add(
        "Cohort Fallback Position Group",
        ratings={SELECTED_ROLE: (52.0, "medium")},
        birth_date=_born(25, season_end=end),
        position_group=None,
        primary_position="ST",
        asking=(8_000_000, 10_000_000),
    )
    add(
        "Cohort Unmapped Position",
        primary_position="CB",
        position_group=None,
        birth_date=_born(32, season_end=end),
        minutes=700,
    )
    # -- accented club name, for case-insensitive search --------------------
    add(
        "Cohort Accented Náme",
        ratings={SELECTED_ROLE: (53.0, "medium")},
        birth_date=_born(26, season_end=end),
        team=accented,
        nationality="Côte",
        asking=(3_500_000, 5_500_000),
    )
    # -- two players whose rounded age is identical but birth dates are not.
    # The age sorts must tie them and fall through to name, not order by date.
    same_age_days = int(round(24 * 365.25))
    add(
        "Cohort Zzz Same Rounded Age",
        ratings={SELECTED_ROLE: (46.0, "medium")},
        birth_date=end - _timedelta_days(same_age_days),
        asking=(2_000_000, 3_000_000),
    )
    add(
        "Cohort Aaa Same Rounded Age",
        ratings={SELECTED_ROLE: (47.0, "medium")},
        birth_date=end - _timedelta_days(same_age_days + 12),
        asking=(2_100_000, 3_100_000),
    )
    # -- a midfielder, so position-group filtering has something to exclude -
    add(
        "Cohort Midfield Anchor",
        ratings={OTHER_ROLE: (66.0, "medium")},
        birth_date=_born(27, season_end=end),
        position_group="MID",
        primary_position="CM",
        asking=(9_000_000, 12_000_000),
        nationality="Otherland",
    )
    _add_unicode_rows(add, season_end=end, sharp_club=sharp, greek_league=greek_league)
    _add_literal_pattern_rows(add, season_end=end)

    if scale:
        _add_scale_rows(session, season.id, cohort, home, league, scale)

    session.flush()
    return cohort


#: Names whose Python lowercase cannot be reached by inverting `.upper()`, keyed by the
#: property that breaks the inversion. `UNICODE_NAMES[key]` is the *stored* spelling; the
#: matching queries live in `FILTER_CASES` and the parity assertions.
#:
#: These are the cases that made Phase 8.1B's first text implementation wrong. It folded
#: a needle's uppercase forms into the haystack with `replace()`, which only works when
#: `c.upper().lower() == c`. That holds for "é" and for most of Greek and Cyrillic, and
#: fails here:
#:
#: * `İ` lowercases to TWO code points, `i` + U+0307. Nothing uppercases to it.
#: * `ẞ` lowercases to `ß`, but `ß`.upper() is `SS`, so the inverse lookup misses.
#: * The Kelvin and Ohm signs lowercase to `k` and `ω`, whose uppercase forms are the
#:   ordinary `K` and `Ω` at different code points.
#: * `ſ` is already lowercase; `.upper()` is `S`, which would wrongly fold `s` into it.
#: * Greek `Σ` lowercases to `ς` or `σ` depending on what follows it.
UNICODE_NAMES = {
    "acute": "Cohort Étienne Acute",
    "dotted_i": "Cohort İpek Dotted",
    "sharp_s": "Cohort ẞeta Sharp",
    "kelvin": "Cohort Kelvin Sign",  # U+212A KELVIN SIGN, not an ASCII K
    "ohm": "Cohort Ωhm Sign",
    "long_s": "Cohort ſoft Long",
    "final_sigma": "Cohort ΟΔΟΣ Sigma",
    "greek_pair": "Cohort ΨΥΧΉ Greek",
    "cyrillic": "Cohort ЖУК Cyrillic",
}

#: Pairs of DIFFERENT stored names that Python lowercases to the SAME key, so only the
#: player id can order them. Each pair is a non-reversible mapping, which is exactly why
#: an inverse-uppercase fold could never have produced them.
UNICODE_LOWER_COLLISIONS = (
    ("Cohort Kelvin Twin", "Cohort Kelvin Twin"),  # KELVIN SIGN vs ASCII K
    ("Cohort ẞharp Twin", "Cohort ßharp Twin"),  # capital vs small sharp s
)

#: Names carrying a character that is special to SQL `LIKE`. The needle must stay
#: literal, so each is paired with a decoy that a wildcard reading would also match.
LITERAL_PATTERN_NAMES = {
    "percent": "Cohort 100% Effort",
    "percent_decoy": "Cohort 100XX Effort",
    "underscore": "Cohort A_B Underscore",
    "underscore_decoy": "Cohort AZB Underscore",
    "escape": "Cohort Sla/sh Escape",
    "escape_decoy": "Cohort SlaXsh Escape",
}


def _add_unicode_rows(add, *, season_end, sharp_club, greek_league):
    """Players whose names, clubs, leagues and nationalities need real Unicode casing.

    Every one of these is discoverable through `q`, and the nationalities are chosen so
    the equality predicate is exercised by the same characters. They are ordinary cohort
    members otherwise, so they also flow through the whole differential matrix and every
    sort mode rather than only through a bespoke assertion.
    """
    add(
        UNICODE_NAMES["acute"],
        ratings={SELECTED_ROLE: (58.0, "medium")},
        birth_date=_born(23, season_end=season_end),
        nationality="ÉIRE",
        asking=(4_000_000, 6_000_000),
    )
    add(
        UNICODE_NAMES["dotted_i"],
        ratings={SELECTED_ROLE: (57.0, "medium")},
        birth_date=_born(24, season_end=season_end),
        # Stored uppercase on purpose: its Python lowercase contains a combining dot
        # that neither database's own `lower()` produces.
        nationality="TÜRKİYE",
        team=sharp_club,
        competition=greek_league,
        asking=(4_100_000, 6_100_000),
    )
    add(
        UNICODE_NAMES["sharp_s"],
        ratings={SELECTED_ROLE: (56.0, "medium")},
        birth_date=_born(25, season_end=season_end),
        nationality="GROẞLAND",
        team=sharp_club,
        competition=greek_league,
        asking=(4_200_000, 6_200_000),
    )
    add(
        UNICODE_NAMES["kelvin"],
        ratings={SELECTED_ROLE: (55.0, "medium")},
        birth_date=_born(26, season_end=season_end),
        nationality="KELVINIA",
        asking=(4_300_000, 6_300_000),
    )
    add(
        UNICODE_NAMES["ohm"],
        ratings={SELECTED_ROLE: (54.0, "medium")},
        birth_date=_born(28, season_end=season_end),
        nationality="ΩHMLAND",
        asking=(4_400_000, 6_400_000),
    )
    add(
        UNICODE_NAMES["long_s"],
        ratings={SELECTED_ROLE: (52.0, "medium")},
        birth_date=_born(29, season_end=season_end),
        nationality="ſORBIA",
        asking=(4_500_000, 6_500_000),
    )
    add(
        UNICODE_NAMES["final_sigma"],
        ratings={SELECTED_ROLE: (51.0, "medium")},
        birth_date=_born(30, season_end=season_end),
        nationality="ΕΛΛΆΣ",
        competition=greek_league,
        asking=(4_600_000, 6_600_000),
    )
    add(
        UNICODE_NAMES["greek_pair"],
        ratings={SELECTED_ROLE: (50.0, "medium")},
        birth_date=_born(21, season_end=season_end),
        nationality="ΚΎΠΡΟΣ",
        competition=greek_league,
        asking=(4_700_000, 6_700_000),
    )
    add(
        UNICODE_NAMES["cyrillic"],
        ratings={SELECTED_ROLE: (49.0, "medium")},
        birth_date=_born(20, season_end=season_end),
        nationality="РОССИЯ",
        asking=(4_800_000, 6_800_000),
    )
    # Distinct spellings that collide once lowercased: identical sort key, so the
    # player id is the only thing left to order them by.
    for first, second in UNICODE_LOWER_COLLISIONS:
        for name in (first, second):
            add(
                name,
                ratings={SELECTED_ROLE: (48.0, "medium")},
                birth_date=_born(27, season_end=season_end),
                asking=(4_900_000, 6_900_000),
            )


def _add_literal_pattern_rows(add, *, season_end):
    """Names containing `%`, `_` and the LIKE escape character, each with a decoy.

    The decoy is the point: if the needle were interpolated into a LIKE pattern rather
    than escaped, `100%` would also match `100XX` and `A_B` would also match `AZB`.
    """
    for key, name in LITERAL_PATTERN_NAMES.items():
        add(
            name,
            ratings={SELECTED_ROLE: (44.0, "low")},
            birth_date=_born(31, season_end=season_end),
            nationality=name,
            asking=(1_100_000, 2_200_000) if "decoy" not in key else None,
        )


def _add_scale_rows(session, season_id, cohort, team, competition, count):
    """Bulk-insert `count` deterministic player-seasons for the volume tests.

    Written with Core `insert()` rather than the ORM so several thousand rows cost a
    handful of statements. Every twelfth player is unrated, every seventh has no
    market row, every ninth has no birth date and scores repeat every 40 players, so
    the volume run exercises ties, unknowns and the ordering rather than counting a
    field of empty profiles.
    """
    players = []
    for index in range(count):
        no_birth = index % 9 == 0
        players.append(
            {
                "canonical_name": f"Cohort Scale Player {index:05d}",
                "birth_date": (
                    None
                    if no_birth
                    else COHORT_SEASON_END - _timedelta_days(6_500 + (index % 4_000))
                ),
                "nationality": "Scaleland" if index % 3 else "Cohortia",
                "primary_position": "RW" if index % 2 == 0 else "CM",
                "secondary_positions": [],
            }
        )
    session.execute(insert(Player), players)
    ids = list(
        session.scalars(
            select(Player.id)
            .where(Player.canonical_name.like("Cohort Scale Player %"))
            .order_by(Player.id)
        )
    )
    assert len(ids) == count, f"expected {count} scale players, inserted {len(ids)}"
    for index, pid in enumerate(ids):
        cohort.ids_by_name.setdefault(f"Cohort Scale Player {index:05d}", []).append(pid)

    appearances, ratings, markets, playstyles, memberships = [], [], [], [], []
    for index, pid in enumerate(ids):
        appearances.append(
            {
                "player_id": pid,
                "team_id": team.id,
                "competition_id": competition.id,
                "season_id": season_id,
                "minutes": 300 + (index % 47) * 60,
                "appearances": 10 + index % 20,
                "starts": index % 15,
                "position_group": "ATT" if index % 2 == 0 else "MID",
            }
        )
        if index % 12:
            # Scores repeat, so many rows tie and the tie-breaks do real work.
            selected = round(20.0 + (index % 40) * 1.5, 1)
            ratings.append(
                {
                    "player_id": pid,
                    "role_key": SELECTED_ROLE if index % 2 == 0 else OTHER_ROLE,
                    "season_id": season_id,
                    "version": "cohort",
                    "raw_score": selected,
                    "context_adjusted_score": selected,
                    "final_score": selected,
                    "confidence": ("unknown", "low", "medium", "high")[index % 4],
                }
            )
            if index % 5 == 0:
                other = round(15.0 + (index % 37) * 1.7, 1)
                ratings.append(
                    {
                        "player_id": pid,
                        "role_key": THIRD_ROLE,
                        "season_id": season_id,
                        "version": "cohort",
                        "raw_score": other,
                        "context_adjusted_score": other,
                        "final_score": other,
                        "confidence": ("high", "medium")[index % 2],
                    }
                )
        if index % 7:
            low = None if index % 23 == 0 else 500_000 + (index % 60) * 250_000
            high = None if index % 29 == 0 else 1_500_000 + (index % 60) * 400_000
            markets.append(
                {
                    "player_id": pid,
                    "season_id": season_id,
                    "expected_asking_low_eur": low,
                    "expected_asking_high_eur": high,
                    "confidence": "medium",
                    "label": "fair",
                    "version": "cohort",
                }
            )
        if index % 4 == 0:
            playstyles.append(
                {
                    "player_id": pid,
                    "season_id": season_id,
                    "playstyle_key": "volume_shooter",
                    "tier": ("base", "plus", "elite")[index % 3],
                    "confidence": "medium",
                    "is_concern": False,
                    "why_applied_json": {},
                    "version": "cohort",
                }
            )
        if index % 11 == 0:
            playstyles.append(
                {
                    "player_id": pid,
                    "season_id": season_id,
                    "playstyle_key": "inflated_market",
                    "tier": None,
                    "confidence": "low",
                    "is_concern": True,
                    "why_applied_json": {},
                    "version": "cohort",
                }
            )
        if index % 6 == 0:
            memberships.append(
                {
                    "player_id": pid,
                    "season_id": season_id,
                    "universe_key": MVP_UNIVERSE_KEY,
                    "eligible": index % 12 == 0,
                    "reasons_json": {},
                }
            )
    session.execute(insert(Appearance), appearances)
    session.execute(insert(RoleRating), ratings)
    session.execute(insert(MarketValue), markets)
    session.execute(insert(PlayerPlaystyle), playstyles)
    session.execute(insert(PlayerUniverseMembership), memberships)


# ---------------------------------------------------------------------------
# the Python reference implementation (pre-8.1B semantics)
# ---------------------------------------------------------------------------
@dataclass
class _RefRow:
    player_id: int
    canonical_name: str
    nationality: Optional[str]
    primary_position: Optional[str]
    club: Optional[str]
    club_slug: Optional[str]
    league_name: Optional[str]
    league_slug: Optional[str]
    minutes: int
    position_group: Optional[str]
    age: Optional[float]
    ratings: list
    playstyle_keys: set
    asking_low: Optional[float]
    asking_high: Optional[float]
    has_market: bool
    is_high_coverage: bool


def _ref_age(birth: Optional[date], season_end: Optional[date]) -> Optional[float]:
    if not birth or not season_end:
        return None
    return round((season_end - birth).days / 365.25, 1)


def _ref_best(ratings):
    if not ratings:
        return None
    return sorted(ratings, key=lambda r: (-r.final_score, r.role_key))[0]


def load_reference_rows(session, season_id: int, season_end: Optional[date]) -> list:
    """Assemble the whole cohort in Python, the way `_load_rows` used to.

    Deliberately unoptimized: full-table reads, a dict per relationship, and a
    per-player lookup. Appearances are walked in primary-key order and replaced only
    on strictly greater minutes, which is exactly what the previous implementation
    did, so the reference keeps its "first row wins a minutes tie" characteristic.
    """
    teams = {t.id: t for t in session.scalars(select(Team))}
    comps = {c.id: c for c in session.scalars(select(Competition))}
    primary = {}
    for appearance in session.scalars(
        select(Appearance).where(Appearance.season_id == season_id).order_by(Appearance.id)
    ):
        current = primary.get(appearance.player_id)
        if current is None or (appearance.minutes or 0) > (current.minutes or 0):
            primary[appearance.player_id] = appearance
    ratings: dict = {}
    for rating in session.scalars(select(RoleRating).where(RoleRating.season_id == season_id)):
        ratings.setdefault(rating.player_id, []).append(rating)
    playstyles: dict = {}
    for style in session.scalars(
        select(PlayerPlaystyle).where(PlayerPlaystyle.season_id == season_id)
    ):
        playstyles.setdefault(style.player_id, []).append(style)
    markets = {
        m.player_id: m
        for m in session.scalars(select(MarketValue).where(MarketValue.season_id == season_id))
    }
    eligible = set(
        session.scalars(
            select(PlayerUniverseMembership.player_id).where(
                PlayerUniverseMembership.season_id == season_id,
                PlayerUniverseMembership.universe_key == MVP_UNIVERSE_KEY,
                PlayerUniverseMembership.eligible.is_(True),
            )
        )
    )

    rows = []
    for pid, appearance in primary.items():
        player = session.get(Player, pid)
        if player is None:
            continue
        team = teams.get(appearance.team_id)
        comp = comps.get(appearance.competition_id)
        market = markets.get(pid)
        styles = playstyles.get(pid, [])
        rows.append(
            _RefRow(
                player_id=pid,
                canonical_name=player.canonical_name,
                nationality=player.nationality,
                primary_position=player.primary_position,
                club=team.canonical_name if team else None,
                club_slug=team.slug if team else None,
                league_name=comp.name if comp else None,
                league_slug=comp.slug if comp else None,
                minutes=appearance.minutes or 0,
                position_group=(
                    appearance.position_group or position_group_for(player.primary_position or "")
                ),
                age=_ref_age(player.birth_date, season_end),
                ratings=ratings.get(pid, []),
                playstyle_keys={s.playstyle_key for s in styles if not s.is_concern},
                asking_low=market.expected_asking_low_eur if market else None,
                asking_high=market.expected_asking_high_eur if market else None,
                has_market=market is not None,
                is_high_coverage=pid in eligible,
            )
        )
    return rows


def _ref_applicable(row: _RefRow, role: Optional[str]):
    if role:
        return next((r for r in row.ratings if r.role_key == role), None)
    return _ref_best(row.ratings)


_AGE_BANDS = {
    "u23": (None, 23),
    "24_26": (24, 26),
    "27_30": (27, 30),
    "31_plus": (31, None),
}
_SCOPES = {"analyzed", "all_records", "high_coverage_u23"}
_UNIVERSE_ALIASES = {"mvp": "high_coverage_u23", "all": "all_records"}


def _ref_scope(scope, universe):
    """Explicit valid scope wins; then the legacy alias; then the default."""
    if scope in _SCOPES:
        return scope
    if universe in _UNIVERSE_ALIASES:
        return _UNIVERSE_ALIASES[universe]
    return "analyzed"


def reference_search(rows: list, *, sort="rolefit_desc", page=1, page_size=20, **criteria):
    """The pre-8.1B result for one query: `(ids, total, page, total_pages)`."""
    import math

    q = criteria.get("q")
    role = criteria.get("role")
    scope = _ref_scope(criteria.get("scope"), criteria.get("universe"))
    position_group = criteria.get("position_group")
    league = criteria.get("league")
    club = criteria.get("club")
    nationality = criteria.get("nationality")
    min_minutes = criteria.get("min_minutes")
    rolefit_min = criteria.get("rolefit_min")
    rolefit_max = criteria.get("rolefit_max")
    playstyle = criteria.get("playstyle")
    value_min = criteria.get("value_min")
    value_max = criteria.get("value_max")
    age_min = criteria.get("age_min")
    age_max = criteria.get("age_max")
    band_min, band_max = _AGE_BANDS.get(criteria.get("age_band"), (None, None))

    def applicable(row):
        return _ref_applicable(row, role)

    def keep(row: _RefRow) -> bool:
        result = applicable(row)
        if scope == "analyzed" and not row.ratings:
            return False
        if scope == "high_coverage_u23" and not row.is_high_coverage:
            return False
        if q:
            hay = " ".join(
                filter(
                    None,
                    [row.canonical_name, row.club, row.league_name, row.primary_position],
                )
            ).lower()
            if q.lower() not in hay:
                return False
        if position_group and row.position_group != position_group:
            return False
        if role and result is None:
            return False
        if (
            league
            and league.lower()
            not in " ".join(filter(None, [row.league_slug, row.league_name])).lower()
        ):
            return False
        if club and club.lower() not in " ".join(filter(None, [row.club_slug, row.club])).lower():
            return False
        if nationality and (row.nationality or "").lower() != nationality.lower():
            return False
        if min_minutes is not None and row.minutes < min_minutes:
            return False
        for floor in (age_min, band_min):
            if floor is not None and (row.age is None or row.age < floor):
                return False
        for ceiling in (age_max, band_max):
            if ceiling is not None and (row.age is None or row.age > ceiling):
                return False
        score = result.final_score if result else None
        if rolefit_min is not None and (score is None or score < rolefit_min):
            return False
        if rolefit_max is not None and (score is None or score > rolefit_max):
            return False
        if playstyle and playstyle not in row.playstyle_keys:
            return False
        if value_min is not None and (row.asking_high is None or row.asking_high < value_min):
            return False
        if value_max is not None and (row.asking_low is None or row.asking_low > value_max):
            return False
        return True

    def sort_key(row: _RefRow):
        result = applicable(row)
        score = result.final_score if result else None
        rated = score is not None
        score_value = score if rated else 0.0
        conf = _CONF_ORDER.get(result.confidence if result else "unknown", 0)
        priced = row.asking_low is not None
        price_rank = 0 if priced else 1
        price_value = row.asking_low if priced else 0.0
        name = row.canonical_name.lower()
        primary = {
            "rolefit_desc": (0 if rated else 1, -score_value, -conf),
            "rolefit_asc": (0 if rated else 1, score_value, -conf),
            "age_asc": (row.age if row.age is not None else 999,),
            "age_desc": (-(row.age if row.age is not None else -1),),
            "value_desc": (price_rank, -price_value),
            "value_asc": (price_rank, price_value),
            "name_asc": (name,),
        }[sort]
        return (*primary, name, row.player_id)

    matched = sorted([r for r in rows if keep(r)], key=sort_key)
    total = len(matched)
    total_pages = math.ceil(total / page_size) if page_size else 0
    effective_page = min(page, total_pages) if total_pages else 1
    start = (effective_page - 1) * page_size
    ids = [r.player_id for r in matched[start : start + page_size]]
    return ids, total, effective_page, total_pages


# ---------------------------------------------------------------------------
# the query matrix both dialects are held to
# ---------------------------------------------------------------------------
SORTS = (
    "rolefit_desc",
    "rolefit_asc",
    "age_asc",
    "age_desc",
    "value_desc",
    "value_asc",
    "name_asc",
)

#: Representative filter combinations. Each is a `search_players` keyword set; the
#: differential test runs every one of them against every sort mode.
FILTER_CASES = (
    ("unfiltered default scope", {}),
    ("all records", {"scope": "all_records"}),
    ("high coverage scope", {"scope": "high_coverage_u23"}),
    ("legacy universe alias", {"universe": "mvp"}),
    ("selected role", {"role": SELECTED_ROLE}),
    ("selected role over all records", {"scope": "all_records", "role": SELECTED_ROLE}),
    ("other selected role", {"role": OTHER_ROLE}),
    ("selected role with bounds", {"role": SELECTED_ROLE, "rolefit_min": 45, "rolefit_max": 70}),
    ("rolefit floor only", {"scope": "all_records", "rolefit_min": 60}),
    ("free text name", {"scope": "all_records", "q": "Cohort"}),
    ("free text spanning fields", {"scope": "all_records", "q": "Winger Cohort Home"}),
    ("free text accented club", {"scope": "all_records", "q": "saint-étienne"}),
    ("free text no match", {"scope": "all_records", "q": "no-such-player"}),
    # -- Unicode casing. Each character is searched both as stored and as Python
    # lowercases it, so a mechanism that only handled one direction would fail.
    ("unicode acute stored", {"scope": "all_records", "q": "Étienne"}),
    ("unicode acute lowered", {"scope": "all_records", "q": "étienne"}),
    ("unicode dotted i stored", {"scope": "all_records", "q": "İpek"}),
    ("unicode dotted i lowered", {"scope": "all_records", "q": "i̇pek"}),
    ("unicode dotted i naive", {"scope": "all_records", "q": "ipek"}),
    ("unicode sharp s stored", {"scope": "all_records", "q": "ẞeta"}),
    ("unicode sharp s lowered", {"scope": "all_records", "q": "ßeta"}),
    ("unicode kelvin stored", {"scope": "all_records", "q": "Kelvin Sign"}),
    ("unicode kelvin lowered", {"scope": "all_records", "q": "kelvin sign"}),
    ("unicode ohm stored", {"scope": "all_records", "q": "Ωhm"}),
    ("unicode ohm lowered", {"scope": "all_records", "q": "ωhm"}),
    ("unicode long s", {"scope": "all_records", "q": "ſoft"}),
    ("unicode long s as plain s", {"scope": "all_records", "q": "soft long"}),
    ("unicode final sigma stored", {"scope": "all_records", "q": "ΟΔΟΣ"}),
    ("unicode final sigma lowered", {"scope": "all_records", "q": "οδος"}),
    ("unicode nonfinal sigma", {"scope": "all_records", "q": "οδοσ"}),
    ("unicode greek pair", {"scope": "all_records", "q": "ψυχή"}),
    ("unicode cyrillic", {"scope": "all_records", "q": "жук"}),
    ("unicode mixed ascii", {"scope": "all_records", "q": "Cohort ЖУК Cyr"}),
    ("unicode spanning name and club", {"scope": "all_records", "q": "Sharp Cohort straße"}),
    ("unicode club by name", {"scope": "all_records", "club": "straße"}),
    ("unicode club by stored case", {"scope": "all_records", "club": "STRAẞE"}),
    ("unicode league by name", {"scope": "all_records", "league": "ελλάς"}),
    ("unicode nationality lowered", {"scope": "all_records", "nationality": "türki̇ye"}),
    ("unicode nationality stored", {"scope": "all_records", "nationality": "TÜRKİYE"}),
    ("unicode nationality naive", {"scope": "all_records", "nationality": "türkiye"}),
    ("unicode nationality sharp", {"scope": "all_records", "nationality": "großland"}),
    ("unicode nationality sigma", {"scope": "all_records", "nationality": "ελλάς"}),
    # -- LIKE metacharacters stay literal. Each has a decoy in the cohort that a
    # wildcard reading of the needle would also return.
    ("free text wildcard literal", {"scope": "all_records", "q": "100%"}),
    ("literal percent with tail", {"scope": "all_records", "q": "100% Effort"}),
    ("literal underscore", {"scope": "all_records", "q": "A_B"}),
    ("literal escape character", {"scope": "all_records", "q": "Sla/sh"}),
    ("literal escape as underscore", {"scope": "all_records", "q": "Sla_sh"}),
    (
        "literal percent in nationality",
        {"scope": "all_records", "nationality": "cohort 100% effort"},
    ),
    ("position group ATT", {"scope": "all_records", "position_group": "ATT"}),
    ("position group MID", {"scope": "all_records", "position_group": "MID"}),
    ("position group DEF", {"scope": "all_records", "position_group": "DEF"}),
    ("league by slug", {"scope": "all_records", "league": "cohort-league"}),
    ("league by name", {"scope": "all_records", "league": "Second Division"}),
    ("club by slug", {"scope": "all_records", "club": "cohort-away"}),
    ("club accented name", {"scope": "all_records", "club": "Étienne"}),
    ("nationality mixed case", {"scope": "all_records", "nationality": "cohortIA"}),
    ("minutes zero", {"scope": "all_records", "min_minutes": 0}),
    ("minutes realistic", {"scope": "all_records", "min_minutes": 1500}),
    ("minutes above every record", {"scope": "all_records", "min_minutes": 9000}),
    ("age floor", {"scope": "all_records", "age_min": 25}),
    ("age ceiling", {"scope": "all_records", "age_max": 25}),
    ("age window", {"scope": "all_records", "age_min": 22, "age_max": 28}),
    ("age fractional bounds", {"scope": "all_records", "age_min": 23.5, "age_max": 27.5}),
    ("legacy age band u23", {"scope": "all_records", "age_band": "u23"}),
    ("legacy age band 24_26", {"scope": "all_records", "age_band": "24_26"}),
    ("legacy age band 31_plus", {"scope": "all_records", "age_band": "31_plus"}),
    ("age band plus explicit bound", {"scope": "all_records", "age_band": "u23", "age_min": 19}),
    ("value floor", {"scope": "all_records", "value_min": 10_000_000}),
    ("value ceiling", {"scope": "all_records", "value_max": 10_000_000}),
    ("value window", {"scope": "all_records", "value_min": 5_000_000, "value_max": 20_000_000}),
    ("positive playstyle", {"scope": "all_records", "playstyle": "volume_shooter"}),
    ("playstyle only held as concern", {"scope": "all_records", "playstyle": "inflated_market"}),
    (
        "role plus playstyle plus minutes",
        {"role": SELECTED_ROLE, "playstyle": "dribble_carrier", "min_minutes": 900},
    ),
    (
        "everything at once",
        {
            "scope": "all_records",
            "q": "Cohort",
            "position_group": "ATT",
            "league": "cohort",
            "min_minutes": 100,
            "age_min": 20,
            "age_max": 32,
            "value_min": 1_000_000,
            "rolefit_min": 40,
            "role": SELECTED_ROLE,
        },
    ),
)
