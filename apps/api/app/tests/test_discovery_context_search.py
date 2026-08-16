"""Phase 8.2 corrective pass - the Discovery Context filters behave like search.

The rail exposed League, Club and Nationality as free-text controls, and all three
behaved like something other than a search box:

* **Nationality was case-insensitive EQUALITY.** `nationality=England` worked;
  `nationality=Eng` returned nothing at all, so the field read as broken until the
  whole stored country had been typed.
* **League searched only slug and name.** `eng`, `por` and `ita` appeared to work, but
  only because those codes happen to lead the stored slugs; the actual countries
  `England`, `Portugal` and `Italy` matched nothing.
* **Club was a bare substring.** Nobody types "Paris Saint-Germain" to find PSG, and
  no amount of substring matching turns `psg` into that club.

All three are repaired inside the SQL predicate. This module owns the exhaustive
coverage; the same rules are additionally asserted on both dialects by
`discovery_parity`, which the PostgreSQL smoke also runs.

The clubs the alias registry names are mostly absent from the committed sample - it is
a 24-player synthetic fixture, not a league database - so this builds an isolated
in-memory cohort containing them. No production player is fabricated to make a test
pass; the seeded sample is only used where it genuinely has the data (PSG).
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.search_aliases import club_alias_targets
from app.models.orm import Appearance, Base, Competition, Player, RoleRating, Season, Team
from app.services import players_service

SEASON_LABEL = "2097/98"
SEASON_END = date(2098, 5, 31)
ROLE = "touchline_winger"

#: `(team slug, canonical name, competition key)`. Slugs and names are spelled the way
#: a provider would, so an alias can only reach them through its configured targets.
CLUBS = (
    ("paris_sg", "Paris Saint-Germain", "fra"),
    ("marseille", "Olympique de Marseille", "fra"),
    ("lyon", "Olympique Lyonnais", "fra"),
    ("lille", "LOSC Lille", "fra"),
    ("tottenham", "Tottenham Hotspur", "eng"),
    ("man_utd", "Manchester United", "eng"),
    ("man_city", "Manchester City", "eng"),
    ("liverpool", "Liverpool", "eng"),
    ("arsenal", "Arsenal", "eng"),
    ("barcelona", "FC Barcelona", "esp"),
    ("real_madrid", "Real Madrid", "esp"),
    ("atletico_madrid", "Atletico Madrid", "esp"),
    ("bayern_munich", "Bayern Munich", "ger"),
    ("dortmund", "Borussia Dortmund", "ger"),
    ("leverkusen", "Bayer Leverkusen", "ger"),
    ("leipzig", "RB Leipzig", "ger"),
    ("juventus", "Juventus", "ita"),
    ("inter_milan", "Internazionale", "ita"),
    ("ac_milan", "AC Milan", "ita"),
)

#: `(slug, name, country)`. Names deliberately never repeat the country, so a country
#: needle can only match through the country column.
COMPETITIONS = {
    "eng": ("eng_premier_league", "Premier League", "England"),
    "esp": ("esp_la_liga", "La Liga", "Spain"),
    "ita": ("ita_serie_a", "Serie A", "Italy"),
    "ger": ("ger_bundesliga", "Bundesliga", "Germany"),
    "fra": ("fra_ligue_1", "Ligue 1", "France"),
    "por": ("por_primeira_liga", "Primeira Liga", "Portugal"),
}


#: One player per club, named after the club so an assertion reads clearly.
def _player_name(club_name: str) -> str:
    return f"Player of {club_name}"


@pytest.fixture(scope="module")
def context_db():
    """An isolated in-memory cohort with real top-five-league club and country names."""
    engine = create_engine(
        "sqlite://", future=True, poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    session = factory()

    season = Season(
        label=SEASON_LABEL, start_date=date(2097, 8, 1), end_date=SEASON_END, is_current=True
    )
    session.add(season)
    session.flush()

    competitions = {}
    for key, (slug, name, country) in COMPETITIONS.items():
        comp = Competition(slug=slug, name=name, country=country, is_european=True)
        session.add(comp)
        competitions[key] = comp
    session.flush()

    # One Portuguese club, so the Portugal country and its misspelling alias have a
    # result and are not merely "returns nothing, same as before".
    clubs = CLUBS + (("benfica", "SL Benfica", "por"),)
    for slug, name, comp_key in clubs:
        team = Team(slug=slug, canonical_name=name, league_id=competitions[comp_key].id)
        session.add(team)
        session.flush()
        player = Player(
            canonical_name=_player_name(name),
            birth_date=date(2075, 1, 1),
            nationality="England" if comp_key == "eng" else "Portugal",
            primary_position="RW",
            secondary_positions=[],
        )
        session.add(player)
        session.flush()
        session.add(
            Appearance(
                player_id=player.id,
                team_id=team.id,
                competition_id=competitions[comp_key].id,
                season_id=season.id,
                minutes=1800,
                appearances=25,
                starts=22,
                position_group="ATT",
            )
        )
        session.add(
            RoleRating(
                player_id=player.id,
                role_key=ROLE,
                season_id=season.id,
                version="context-test",
                raw_score=70.0,
                context_adjusted_score=70.0,
                final_score=70.0,
                confidence="medium",
            )
        )
    session.commit()
    yield session
    session.close()
    engine.dispose()


def _clubs(session, **criteria) -> set:
    """The canonical CLUB names a Discovery query returns."""
    body = players_service.search_players(session, page_size=100, **criteria)
    assert body.total == len(body.items), "the count and the returned rows disagree"
    return {item.club for item in body.items}


# ---------------------------------------------------------------------------
# 1. Nationality is a substring
# ---------------------------------------------------------------------------
class TestNationality:
    @pytest.mark.parametrize("needle", ["England", "england", "ENGLAND", "Eng", "eng", "gland"])
    def test_full_and_partial_and_mixed_case_all_match(self, context_db, needle):
        found = _clubs(context_db, nationality=needle)
        assert "Tottenham Hotspur" in found
        assert "Paris Saint-Germain" not in found  # a Portugal-nationality player

    def test_a_non_matching_needle_returns_nothing(self, context_db):
        assert _clubs(context_db, nationality="Narnia") == set()

    def test_it_composes_with_every_other_filter(self, context_db):
        assert _clubs(context_db, nationality="Eng", club="spurs") == {"Tottenham Hotspur"}
        assert _clubs(context_db, nationality="Eng", league="Spain") == set()
        assert _clubs(context_db, nationality="Eng", rolefit_min=99) == set()


# ---------------------------------------------------------------------------
# 2. League searches name, slug code and country
# ---------------------------------------------------------------------------
class TestLeague:
    #: `(needle, a club that must be returned)`. Each country word appears ONLY in the
    #: country column, so these cannot pass through the name or the slug.
    COUNTRIES = (
        ("England", "Tottenham Hotspur"),
        ("eng", "Tottenham Hotspur"),
        ("Portugal", "SL Benfica"),
        ("por", "SL Benfica"),
        ("Italy", "Juventus"),
        ("ita", "Juventus"),
        ("Spain", "Real Madrid"),
        ("esp", "Real Madrid"),
        ("Germany", "Bayern Munich"),
        ("ger", "Bayern Munich"),
        ("France", "Paris Saint-Germain"),
        ("fra", "Paris Saint-Germain"),
    )

    @pytest.mark.parametrize("needle,expected_club", COUNTRIES)
    def test_country_and_code_both_reach_the_league(self, context_db, needle, expected_club):
        assert expected_club in _clubs(context_db, league=needle)

    @pytest.mark.parametrize("needle", ["Premier League", "premier", "eng_premier_league"])
    def test_name_and_slug_still_work(self, context_db, needle):
        assert "Tottenham Hotspur" in _clubs(context_db, league=needle)

    def test_the_portgual_misspelling_is_a_deterministic_alias(self, context_db):
        portugal = _clubs(context_db, league="Portugal")
        assert portugal == {"SL Benfica"}
        assert _clubs(context_db, league="portgual") == portugal
        assert _clubs(context_db, league="PORTGUAL") == portugal
        assert _clubs(context_db, league=" portgual ") == portugal

    def test_it_is_not_general_fuzzy_matching(self, context_db):
        # One curated misspelling is in the table. Nothing else is: a different typo
        # returns nothing rather than being guessed at.
        for typo in ("portugual", "portgal", "prtugal", "englnd", "germny"):
            assert _clubs(context_db, league=typo) == set(), typo

    def test_it_composes_with_every_other_filter(self, context_db):
        assert _clubs(context_db, league="England", club="spurs") == {"Tottenham Hotspur"}
        assert _clubs(context_db, league="Spain", club="spurs") == set()


# ---------------------------------------------------------------------------
# 3. Club abbreviations and nicknames
# ---------------------------------------------------------------------------
class TestClubAliases:
    #: Every alias the registry ships that this cohort can answer, and the clubs it
    #: must resolve to. Written out rather than derived from the registry, so a
    #: mis-edited target fails here instead of agreeing with itself.
    RESOLVES = (
        ("psg", {"Paris Saint-Germain"}),
        ("PSG", {"Paris Saint-Germain"}),
        ("P.S.G.", {"Paris Saint-Germain"}),
        ("  psg  ", {"Paris Saint-Germain"}),
        ("Paris SG", {"Paris Saint-Germain"}),
        ("paris  sg", {"Paris Saint-Germain"}),
        ("spurs", {"Tottenham Hotspur"}),
        ("SPURS", {"Tottenham Hotspur"}),
        ("thfc", {"Tottenham Hotspur"}),
        ("T.H.F.C.", {"Tottenham Hotspur"}),
        ("man utd", {"Manchester United"}),
        ("Man United", {"Manchester United"}),
        ("MUFC", {"Manchester United"}),
        ("man city", {"Manchester City"}),
        ("MCFC", {"Manchester City"}),
        ("lfc", {"Liverpool"}),
        ("gunners", {"Arsenal"}),
        ("barca", {"FC Barcelona"}),
        ("barça", {"FC Barcelona"}),
        ("BARÇA", {"FC Barcelona"}),
        ("atleti", {"Atletico Madrid"}),
        ("rma", {"Real Madrid"}),
        ("bvb", {"Borussia Dortmund"}),
        ("b04", {"Bayer Leverkusen"}),
        ("rbl", {"RB Leipzig"}),
        ("juve", {"Juventus"}),
        ("inter milan", {"Internazionale"}),
        ("nerazzurri", {"Internazionale"}),
        ("rossoneri", {"AC Milan"}),
        ("om", {"Olympique de Marseille"}),
        ("ol", {"Olympique Lyonnais"}),
        ("losc", {"LOSC Lille"}),
    )

    @pytest.mark.parametrize("needle,expected", RESOLVES)
    def test_every_shipped_alias_resolves(self, context_db, needle, expected):
        assert _clubs(context_db, club=needle) == expected

    def test_an_ambiguous_abbreviation_returns_every_defensible_club(self, context_db):
        # FCB is claimed by Barcelona and by Bayern Munich. Neither is silently chosen.
        assert _clubs(context_db, club="fcb") == {"FC Barcelona", "Bayern Munich"}
        assert _clubs(context_db, club="F.C.B.") == {"FC Barcelona", "Bayern Munich"}

    def test_a_target_can_match_the_slug_rather_than_the_name(self, context_db):
        # "Manchester City" is reachable by name, but `man_city` is a slug-shaped
        # target and is what proves both sides of the haystack are searched.
        assert "man_city" in club_alias_targets("man city")
        assert _clubs(context_db, club="man_city") == {"Manchester City"}

    @pytest.mark.parametrize(
        "needle,expected",
        [
            ("Tottenham", {"Tottenham Hotspur"}),
            ("tottenham", {"Tottenham Hotspur"}),
            ("Madrid", {"Real Madrid", "Atletico Madrid"}),
            # A bare "milan" reaches AC Milan's name AND Internazionale's slug, which
            # is exactly why `rossoneri` is a curated alias instead of a substring.
            ("milan", {"AC Milan", "Internazionale"}),
            ("olympique", {"Olympique de Marseille", "Olympique Lyonnais"}),
            ("paris_sg", {"Paris Saint-Germain"}),
        ],
    )
    def test_a_non_alias_needle_is_an_ordinary_substring(self, context_db, needle, expected):
        assert club_alias_targets(needle) == ()
        assert _clubs(context_db, club=needle) == expected

    def test_an_unknown_alias_falls_back_rather_than_failing(self, context_db):
        # Not in the registry, and not a substring of anything: an empty result, not
        # an error and not a guess.
        assert club_alias_targets("qpr") == ()
        assert _clubs(context_db, club="qpr") == set()

    def test_dangerously_generic_abbreviations_are_not_aliases(self, context_db):
        # These name several major clubs each. They stay ordinary substrings rather
        # than silently resolving to somebody's favourite.
        for generic in ("united", "city", "real", "blues"):
            assert club_alias_targets(generic) == (), generic
        assert _clubs(context_db, club="united") == {"Manchester United"}
        assert _clubs(context_db, club="real") == {"Real Madrid"}

    def test_an_alias_resolves_rather_than_widening(self, context_db):
        # `om` as a bare substring would drag in every club whose name merely contains
        # those letters. A curated alias answers the question that was asked.
        assert _clubs(context_db, club="om") == {"Olympique de Marseille"}
        assert "Borussia Dortmund" not in _clubs(context_db, club="om")

    def test_aliases_compose_with_every_other_filter(self, context_db):
        assert _clubs(context_db, club="psg", league="France") == {"Paris Saint-Germain"}
        assert _clubs(context_db, club="psg", league="England") == set()
        assert _clubs(context_db, club="psg", nationality="Portugal") == {"Paris Saint-Germain"}
        assert _clubs(context_db, club="psg", nationality="England") == set()
        assert _clubs(context_db, club="psg", role=ROLE, rolefit_min=60, min_minutes=1000) == {
            "Paris Saint-Germain"
        }
        assert _clubs(context_db, club="psg", rolefit_min=99) == set()
        assert _clubs(context_db, club="fcb", league="Spain") == {"FC Barcelona"}

    def test_the_count_agrees_with_the_rows_for_an_ambiguous_alias(self, context_db):
        body = players_service.search_players(context_db, club="fcb", page_size=100)
        assert body.total == 2
        assert len(body.items) == 2
        # ...and it pages coherently, because the alias is one predicate rather than a
        # post-filter over an already-paged result.
        first = players_service.search_players(context_db, club="fcb", page=1, page_size=1)
        second = players_service.search_players(context_db, club="fcb", page=2, page_size=1)
        assert first.total == second.total == 2
        assert first.total_pages == second.total_pages == 2
        assert {first.items[0].club} | {second.items[0].club} == {"FC Barcelona", "Bayern Munich"}


# ---------------------------------------------------------------------------
# 4. Whole-input club aliases in the main search
# ---------------------------------------------------------------------------
class TestFreeTextAliases:
    @pytest.mark.parametrize(
        "needle,expected_club",
        [
            ("psg", "Paris Saint-Germain"),
            ("PSG", "Paris Saint-Germain"),
            ("P.S.G.", "Paris Saint-Germain"),
            ("spurs", "Tottenham Hotspur"),
            ("THFC", "Tottenham Hotspur"),
            ("bvb", "Borussia Dortmund"),
        ],
    )
    def test_a_whole_input_alias_finds_that_club(self, context_db, needle, expected_club):
        assert expected_club in _clubs(context_db, q=needle)

    def test_free_text_keeps_its_ordinary_reach(self, context_db):
        # The alias ADDS to the free-text match here rather than replacing it, because
        # `q` is a broad "find anything" search.
        assert "Tottenham Hotspur" in _clubs(context_db, q="Tottenham")
        assert _clubs(context_db, q="Madrid") == {"Real Madrid", "Atletico Madrid"}
        assert "Juventus" in _clubs(context_db, q="Player of Juventus")

    def test_only_a_whole_input_alias_is_expanded(self, context_db):
        # Deliberately no token parsing of compound prose: "psg winger" is searched
        # exactly as typed, and finds nothing.
        assert _clubs(context_db, q="psg winger") == set()
        assert _clubs(context_db, q="the psg") == set()

    def test_it_composes_with_every_other_filter(self, context_db):
        assert _clubs(context_db, q="psg", league="France") == {"Paris Saint-Germain"}
        assert _clubs(context_db, q="psg", league="Italy") == set()
        assert _clubs(context_db, q="spurs", nationality="England") == {"Tottenham Hotspur"}


# ---------------------------------------------------------------------------
# 5. The alias layer costs no SQL
# ---------------------------------------------------------------------------
def test_alias_resolution_issues_no_database_statement(context_db):
    """Loading and consulting the registry must not touch the database.

    The registry is a cached configuration read; if it ever became a table lookup the
    documented four-statement request shape would quietly become five.
    """
    from sqlalchemy import event

    from app.core.search_aliases import load_aliases

    load_aliases()  # warm the cache exactly as the first request would
    statements: list = []
    bind = context_db.get_bind()

    @event.listens_for(bind, "before_cursor_execute")
    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    try:
        for _ in range(5):
            club_alias_targets("psg")
            club_alias_targets("not-an-alias")
            load_aliases()
        assert statements == []
    finally:
        event.remove(bind, "before_cursor_execute", _record)


def test_an_alias_request_costs_the_same_statements_as_a_plain_one(context_db):
    """One alias standing for several clubs is still one WHERE clause.

    `fcb` expands to three targets. If that had become three queries, or a Python pass
    over an unfiltered result, the statement count would move.
    """
    from sqlalchemy import event

    bind = context_db.get_bind()
    counts = {}

    for label, criteria in (
        ("plain", {"club": "Tottenham"}),
        ("single-target alias", {"club": "psg"}),
        ("three-target alias", {"club": "fcb"}),
        ("league alias", {"league": "portgual"}),
        ("q alias", {"q": "psg"}),
    ):
        statements: list = []

        @event.listens_for(bind, "before_cursor_execute")
        def _record(conn, cursor, statement, parameters, context, executemany, _s=statements):
            _s.append(statement)

        try:
            players_service.search_players(context_db, page_size=20, **criteria)
        finally:
            event.remove(bind, "before_cursor_execute", _record)
        counts[label] = len(statements)

    # Season, count, page, page playstyles - the documented shape, unchanged.
    assert counts["plain"] == 4, counts
    assert set(counts.values()) == {4}, counts
