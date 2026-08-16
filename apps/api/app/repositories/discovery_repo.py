"""Database-side Discovery selection: candidates, predicates, ordering, count, page.

Phase 8.1B. Discovery used to load every player-season of the current season into
Python, filter and sort the list, then slice a page out of it. This module moves that
work into SQL: the database identifies the qualifying player-season rows, resolves the
one role rating each row is judged by, applies every approved predicate, applies the
approved ordering with its tie-breaks, counts the distinct qualifying players and
returns only the requested page.

Three rules shape everything here.

**One rating per row.** A Discovery row is about exactly one stored role rating. With
no selected role that is the player's stored best rating; with ``role=<key>`` it is the
stored rating for that role, and a player without it does not qualify. The same joined
row supplies the score that bounds the row, the score and confidence that order it,
and the figures that get serialized, so they cannot disagree.

**Nothing multiplies.** Each of the four one-to-many relationships an appearance,
rating or market row could contribute is reduced to a single row by a ``NOT EXISTS``
anti-join that says "no other row of this group outranks me", and playstyles and
universe membership are tested with ``EXISTS`` rather than joined. A player with
several appearances, ratings, market rows or playstyles therefore still contributes
exactly one candidate and counts exactly once.

**No missing value becomes a meaningful zero, and no ordering leans on the dialect.**
Unknown scores, ages and asking prices carry an explicit "known first" rank and an
explicit sentinel that mirrors the previous Python sort key, so the result never
depends on whether the database sorts NULL high or low.

Portability notes, since this runs on SQLite locally and PostgreSQL in production
(ADR 0001):

* "One row per group" is expressed as a correlated ``NOT EXISTS`` rather than a
  ``ROW_NUMBER()`` window, because the anti-join reads real tables that both
  databases can satisfy from an index. The window form was measured first: SQLite
  materializes the ranked relation and then re-scans it once per candidate, which is
  quadratic (~1.1s for a 5,000-player cohort against ~7ms here). See
  ``docs/milestone_8_discovery_contract.md`` for the recorded plans.
* Age is a rounded value derived from a day count. The day count comes from
  SQLAlchemy's portable :func:`~sqlalchemy.extract` of ``epoch``, which compiles to
  ``STRFTIME('%s', ...)`` on SQLite and ``EXTRACT(epoch FROM ...)`` on PostgreSQL and
  yields the same integer on both. Age *predicates* do not use it at all: the service
  converts each bound into a birth-date boundary in Python and compares dates.
* Rounding to one decimal can never land on a half-way value, because
  ``days / 365.25`` equals ``k/10 + 1/20`` only when ``80`` divides an odd number,
  which never happens. Half-up, half-even and half-away-from-zero therefore agree, so
  SQL ``round`` and Python ``round`` return the same value for every integer day count.
* Case-insensitive text matching and the name ordering key are lowercased by
  :class:`app.core.text_search.unicode_lower`, not by the database's own ``lower()``.
  SQLite's is ASCII-only and PostgreSQL's follows the database's LC_CTYPE, so neither
  reproduces Python's ``str.lower()``, which is the behaviour this phase preserves.
  That module documents the mechanism and its one measured residual.
* Name ordering is additionally collated to code-point order, because PostgreSQL's
  default locale collation would otherwise order names differently from SQLite's
  binary collation and from the Python ordering this phase is preserving. Lowercasing
  and collation are separate concerns: one decides the value, the other the comparison.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional

from scoutboy_shared import POSITIONS
from sqlalchemy import (
    Numeric,
    String,
    and_,
    case,
    cast,
    collate,
    extract,
    func,
    literal,
    null,
    or_,
    select,
)
from sqlalchemy.orm import Session, aliased
from sqlalchemy.sql import ColumnElement, Select

from app.core.search_aliases import club_alias_targets, league_alias_targets
from app.core.text_search import unicode_lower
from app.models.orm import (
    Appearance,
    Competition,
    MarketValue,
    Player,
    PlayerPlaystyle,
    PlayerUniverseMembership,
    RoleRating,
    Team,
)

#: Confidence ordering, mirroring `services._common._CONF_ORDER`. Higher wins the
#: RoleFit tie-break in BOTH directions, and an absent rating ranks as "unknown".
CONFIDENCE_RANK = {"unknown": 0, "low": 1, "medium": 2, "high": 3}

#: Sentinel age for a record with no birth date, mirroring the previous Python sort
#: key so unknown ages stay last in both age directions without relying on the
#: database's default NULL placement.
_UNKNOWN_AGE_ASC_SENTINEL = 999.0
_UNKNOWN_AGE_DESC_SENTINEL = -1.0

_EPOCH = date(1970, 1, 1)
_DAYS_PER_YEAR = 365.25

#: Collation that reproduces Python's code-point string ordering. SQLite's default is
#: already byte order; PostgreSQL's default is a locale collation that is not, so the
#: name tie-break has to say which one it means or the two databases disagree.
_CODE_POINT_COLLATION = {"sqlite": "BINARY", "postgresql": "C"}


# ---------------------------------------------------------------------------
# request / response shapes
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class DiscoveryFilters:
    """A fully normalized Discovery request.

    Every value here has already been validated and resolved by the service: the
    scope alias has been applied, the legacy age band has been folded into the age
    bounds, and both age bounds have been converted into birth-date boundaries. The
    repository translates, it does not decide.
    """

    season_id: int
    universe_key: str
    scope: str = "analyzed"
    q: Optional[str] = None
    position_group: Optional[str] = None
    role: Optional[str] = None
    league: Optional[str] = None
    club: Optional[str] = None
    nationality: Optional[str] = None
    min_minutes: Optional[int] = None
    rolefit_min: Optional[float] = None
    rolefit_max: Optional[float] = None
    playstyle: Optional[str] = None
    value_min: Optional[float] = None
    value_max: Optional[float] = None
    #: Latest birth date whose rounded age still clears the requested age floor.
    birth_on_or_before: Optional[date] = None
    #: Earliest birth date whose rounded age still sits under the requested ceiling.
    birth_on_or_after: Optional[date] = None
    #: True when any age bound is active, so an unknown birth date must be excluded.
    age_bound_active: bool = False
    #: Set when an active age bound cannot be satisfied by any birth date at all.
    age_bound_unsatisfiable: bool = False
    #: The season's end date, which is what age is measured against.
    season_end: Optional[date] = None


@dataclass(frozen=True)
class DiscoveryRow:
    """One page row, carrying everything a search card needs except playstyles."""

    player_id: int
    canonical_name: str
    birth_date: Optional[date]
    primary_position: Optional[str]
    appearance_position_group: Optional[str]
    minutes: Optional[int]
    club: Optional[str]
    league: Optional[str]
    has_any_rating: bool
    best_role: Optional[str]
    best_score: Optional[float]
    best_confidence: Optional[str]
    result_role: Optional[str]
    result_score: Optional[float]
    result_confidence: Optional[str]
    is_high_coverage: bool
    market_label: Optional[str]
    asking_low: Optional[float]
    asking_high: Optional[float]


# ---------------------------------------------------------------------------
# case-insensitive text matching
# ---------------------------------------------------------------------------
def _ci_contains(expr: ColumnElement, needle: str) -> ColumnElement:
    """Case-insensitive substring containment, with the needle taken literally.

    Both sides are lowercased the way Python's ``str.lower()`` does it: the haystack by
    :class:`~app.core.text_search.unicode_lower`, which the database evaluates, and the
    needle by `str.lower()` itself. That is the whole of the case rule - there is no
    separate folding step that could disagree with it.

    ``autoescape`` matters: the previous behaviour was Python's ``in``, so a needle
    containing ``%``, ``_`` or the escape character must stay literal rather than
    becoming a LIKE wildcard.
    """
    return unicode_lower(expr).contains(needle.lower(), autoescape=True)


def _ci_equals(expr: ColumnElement, needle: str) -> ColumnElement:
    return unicode_lower(expr) == needle.lower()


def _ci_contains_any(expr: ColumnElement, needles) -> ColumnElement:
    """``expr`` contains any one of ``needles``, each taken literally.

    One ``OR`` inside the same ``WHERE``, so an alias that stands for several stored
    spellings still costs no extra statement and no application-side pass over rows.
    """
    return or_(*[_ci_contains(expr, needle) for needle in needles])


def _space_joined(*parts: ColumnElement) -> ColumnElement:
    """SQL equivalent of ``" ".join(filter(None, parts))``.

    The separator is emitted only between two parts that are both present, so a
    missing club or league does not leave a double space that a multi-word needle
    would then fail to match. Reproducing the join exactly matters because the
    previous free-text search ran against the joined string, so a needle may legally
    span the boundary between two fields.
    """
    empty = literal("", String)
    present = [and_(part.isnot(None), part != "") for part in parts]
    pieces = []
    for index, (part, is_present) in enumerate(zip(parts, present)):
        if index == 0:
            pieces.append(case((is_present, part), else_=empty))
        else:
            any_prior = or_(*present[:index])
            pieces.append(
                case(
                    (and_(any_prior, is_present), literal(" ", String) + part),
                    (is_present, part),
                    else_=empty,
                )
            )
    joined = pieces[0]
    for piece in pieces[1:]:
        joined = joined + piece
    return joined


# ---------------------------------------------------------------------------
# Context predicates: league, club
#
# Both are ordinary case-insensitive literal-substring searches over a joined
# haystack, with one deterministic alias table in front of them
# (`configs/discovery/search_aliases_v1.yaml`). The alias layer is a lookup, not
# fuzzy matching, and it compiles into the SAME `WHERE` clause: no extra statement,
# no application-side pass over rows, and AND composition with every other filter is
# untouched.
# ---------------------------------------------------------------------------
def _league_haystack() -> ColumnElement:
    """Competition slug, name and COUNTRY as one searchable string.

    Country is the Phase 8.2 addition. Without it the field only appeared to
    understand countries: `eng`, `por` and `ita` worked purely because those codes
    happen to lead the stored slugs, while the actual words `England`, `Portugal` and
    `Italy` matched nothing. Adding the stored country makes both spellings work for
    the same reason instead of by coincidence, and it needs no extra join because
    `Competition` is already outer-joined for the free-text haystack.
    """
    return _space_joined(Competition.slug, Competition.name, Competition.country)


def _club_haystack() -> ColumnElement:
    """Team slug and canonical name as one searchable string.

    Alias targets are matched against this same joined value, so a target may be
    written in either provider shape (`paris_sg` or `Paris Saint-Germain`) and still
    resolve.
    """
    return _space_joined(Team.slug, Team.canonical_name)


def _league_predicate(needle: str) -> ColumnElement:
    """League by name, slug code or country, with the misspelling table in front."""
    targets = league_alias_targets(needle)
    return _ci_contains_any(_league_haystack(), targets or (needle,))


def _club_predicate(needle: str) -> ColumnElement:
    """Club by name or slug, with the abbreviation/nickname table in front.

    A matched alias RESOLVES: its targets replace the typed needle rather than being
    unioned with it. `club=` is a statement of which club, so a curated answer is what
    the field is for - and unioning would let a two-letter abbreviation such as `om`
    drag in every club whose name merely contains those letters. Anything that is not
    an alias is searched exactly as before.
    """
    targets = club_alias_targets(needle)
    return _ci_contains_any(_club_haystack(), targets or (needle,))


# ---------------------------------------------------------------------------
# derived expressions
# ---------------------------------------------------------------------------
def position_group_case(appearance_group: ColumnElement, primary_position: ColumnElement):
    """The row's position group: the appearance's own, else the primary position's.

    Built from the same ``POSITIONS`` mapping ``position_group_for`` uses, so the SQL
    filter and the serialized value cannot drift. An empty stored group falls through
    exactly as the previous ``appr.position_group or position_group_for(...)`` did.
    """
    mapped = case(
        *[
            (func.upper(func.coalesce(primary_position, "")) == position, group)
            for position, group in sorted(POSITIONS.items())
        ],
        else_=literal(None, String),
    )
    return case(
        (and_(appearance_group.isnot(None), appearance_group != ""), appearance_group),
        else_=mapped,
    )


def rounded_age_expr(birth_date: ColumnElement, season_end: Optional[date]):
    """The displayed rounded age, as an ordering key only.

    Equal to ``round((season_end - birth_date).days / 365.25, 1)`` for every integer
    day count, on both supported dialects. NULL when the birth date or the season end
    is unknown; callers supply the "unknown last" sentinel themselves.

    The unknown-season-end NULL is an explicit ``CAST(NULL AS NUMERIC)``. A bare typed
    literal is sent as an untyped parameter, which PostgreSQL infers as ``text`` and
    then refuses to hand back through a numeric result processor
    ("Unknown PG numeric type: 25"); SQLite is untyped enough not to notice.
    """
    if season_end is None:
        return cast(null(), Numeric)
    epoch_end = (season_end - _EPOCH).days * 86400
    days = (literal(epoch_end) - extract("epoch", birth_date)) / 86400
    return func.round(cast(days / _DAYS_PER_YEAR, Numeric), 1)


def _confidence_rank(confidence: ColumnElement):
    """Stored confidence as an orderable rank: unknown < low < medium < high."""
    return case(
        *[(confidence == level, rank) for level, rank in sorted(CONFIDENCE_RANK.items())],
        else_=CONFIDENCE_RANK["unknown"],
    )


def code_point_collation(session: Session) -> Optional[str]:
    """The collation that makes SQL name ordering match Python's, or None."""
    bind = session.get_bind()
    return _CODE_POINT_COLLATION.get(bind.dialect.name) if bind is not None else None


def _name_key(collation: Optional[str]):
    """The canonical-name ordering key: `canonical_name.lower()`, by code point.

    Two separate concerns, and both are needed. `unicode_lower` decides *what* the
    lowercase is, because neither database's own `lower()` reproduces Python's; the
    collation decides how the lowered values *compare*, because PostgreSQL's default
    is a locale collation rather than the code-point order Python's `<` uses.
    """
    lowered = unicode_lower(Player.canonical_name)
    return collate(lowered, collation) if collation else lowered


# ---------------------------------------------------------------------------
# "exactly one row per player" anti-joins
#
# Each of these says: keep this row unless another row of the same group outranks
# it. The ranking each one encodes is a characterization of what the previous
# in-Python assembly already selected, written out so it is explicit and stable
# rather than dependent on the order rows happen to be scanned in.
# ---------------------------------------------------------------------------
def _not_outranked(*conditions) -> ColumnElement:
    """ "No other row of this group satisfies `conditions`", i.e. none outranks me."""
    return ~select(literal(1)).where(*conditions).exists()


def _primary_appearance_condition(appearance, season_id: int) -> ColumnElement:
    """The greatest-minutes appearance, then the lowest appearance id.

    The greatest-minutes rule is the established Discovery semantic. The id tie-break
    characterizes what the previous Python loop already did - it kept the first
    appearance it saw and replaced it only on *strictly* greater minutes, which under
    a primary-key scan is the lowest id. It is a technical tie-break, not a new
    product rule, and the fixtures contain a deliberate minutes tie that pins it.
    """
    other = aliased(Appearance, name="other_appearance")
    mine = func.coalesce(appearance.minutes, 0)
    theirs = func.coalesce(other.minutes, 0)
    return _not_outranked(
        other.player_id == appearance.player_id,
        other.season_id == season_id,
        or_(theirs > mine, and_(theirs == mine, other.id < appearance.id)),
    )


def _best_rating_condition(best, season_id: int) -> ColumnElement:
    """The stored best rating: highest final score, then role key, then id.

    The id tie-break reproduces the previous stable Python sort. The recompute job
    clears a season before rewriting it, so exactly one row exists per
    (player, role, season) in practice; ranking anyway keeps a duplicated version
    from multiplying candidates or silently changing which rating is "best".
    """
    other = aliased(RoleRating, name="other_rating")
    return _not_outranked(
        other.player_id == best.player_id,
        other.season_id == season_id,
        or_(
            other.final_score > best.final_score,
            and_(other.final_score == best.final_score, other.role_key < best.role_key),
            and_(
                other.final_score == best.final_score,
                other.role_key == best.role_key,
                other.id < best.id,
            ),
        ),
    )


def _selected_rating_condition(selected, season_id: int, role_key: str) -> ColumnElement:
    """The stored rating for exactly one role, lowest id.

    Lowest id mirrors the previous ``next((r for r in ratings if r.role_key == ...))``,
    which took the first matching row in scan order.
    """
    other = aliased(RoleRating, name="other_selected_rating")
    return _not_outranked(
        other.player_id == selected.player_id,
        other.season_id == season_id,
        other.role_key == role_key,
        other.id < selected.id,
    )


def _market_condition(market, season_id: int) -> ColumnElement:
    """The player's market row, highest id.

    Highest id characterizes the previous ``{m.player_id: m for m in ...}`` dict
    comprehension, where the last row scanned won. Like the ratings, the recompute
    job leaves exactly one row per player-season.
    """
    other = aliased(MarketValue, name="other_market_value")
    return _not_outranked(
        other.player_id == market.player_id,
        other.season_id == season_id,
        other.id > market.id,
    )


# ---------------------------------------------------------------------------
# candidate composition
# ---------------------------------------------------------------------------
class _Candidates:
    """The candidate relation plus the expressions the count and page queries need."""

    def __init__(self, filters: DiscoveryFilters):
        self.filters = filters
        season_id = filters.season_id
        self.appearance = aliased(Appearance, name="primary_appearance")
        self.best = aliased(RoleRating, name="best_rating")
        self.market = aliased(MarketValue, name="market_value")
        self.selected = aliased(RoleRating, name="selected_rating") if filters.role else None
        #: The one rating this row is judged by: the selected role's when a role is
        #: requested, the player's best otherwise.
        self.result = self.selected if self.selected is not None else self.best

        self._appearance_on = and_(
            self.appearance.season_id == season_id,
            _primary_appearance_condition(self.appearance, season_id),
        )
        self._best_on = and_(
            self.best.player_id == Player.id,
            self.best.season_id == season_id,
            _best_rating_condition(self.best, season_id),
        )
        self._market_on = and_(
            self.market.player_id == Player.id,
            self.market.season_id == season_id,
            _market_condition(self.market, season_id),
        )
        self._selected_on = (
            and_(
                self.selected.player_id == Player.id,
                self.selected.season_id == season_id,
                self.selected.role_key == filters.role,
                _selected_rating_condition(self.selected, season_id, filters.role),
            )
            if self.selected is not None
            else None
        )

        self.high_coverage = (
            select(literal(1))
            .where(
                PlayerUniverseMembership.player_id == Player.id,
                PlayerUniverseMembership.season_id == season_id,
                PlayerUniverseMembership.universe_key == filters.universe_key,
                PlayerUniverseMembership.eligible.is_(True),
            )
            .exists()
        )

    def select_from(self, stmt: Select) -> Select:
        """Compose the candidate relation.

        Every joined relation is reduced to at most one row per player by its own
        anti-join condition, so none of them can multiply a candidate.
        """
        stmt = (
            stmt.select_from(self.appearance)
            .join(Player, Player.id == self.appearance.player_id)
            .outerjoin(Team, Team.id == self.appearance.team_id)
            .outerjoin(Competition, Competition.id == self.appearance.competition_id)
            .outerjoin(self.best, self._best_on)
            .outerjoin(self.market, self._market_on)
        )
        if self.selected is not None:
            # A selected role qualifies a player only when that exact rating is
            # stored, so this join is deliberately inner.
            stmt = stmt.join(self.selected, self._selected_on)
        return stmt.where(self._appearance_on).where(*self._predicates())

    # -- predicates ---------------------------------------------------------
    def _predicates(self) -> list:
        f = self.filters
        where: list = []

        if f.scope == "analyzed":
            where.append(self.best.player_id.isnot(None))
        elif f.scope == "high_coverage_u23":
            where.append(self.high_coverage)

        if f.q:
            # The documented free-text haystack, unchanged.
            free_text = _ci_contains(
                _space_joined(
                    Player.canonical_name,
                    Team.canonical_name,
                    Competition.name,
                    Player.primary_position,
                ),
                f.q,
            )
            # ...plus, when the WHOLE input is a known club abbreviation, the clubs it
            # stands for. `q` is documented as searching club identity, so `q=psg`
            # finding nobody was a hole in that promise. This ADDS to the free-text
            # match rather than replacing it (the club field resolves instead - see
            # `_club_predicate`), because `q` is a broad "find anything" search and
            # silently narrowing it would be the more surprising behaviour. Only a
            # normalized whole-input alias is considered: there is deliberately no
            # token parsing of compound prose.
            club_targets = club_alias_targets(f.q)
            if club_targets:
                free_text = or_(free_text, _ci_contains_any(_club_haystack(), club_targets))
            where.append(free_text)
        if f.position_group:
            where.append(
                position_group_case(self.appearance.position_group, Player.primary_position)
                == f.position_group
            )
        if f.league:
            where.append(_league_predicate(f.league))
        if f.club:
            where.append(_club_predicate(f.club))
        if f.nationality:
            # Substring, not equality. Equality meant the field returned nothing until
            # the whole stored country had been typed, which read as a broken control:
            # `Eng` matched no England player at all. Missing nationality still fails an
            # active predicate - COALESCE to the empty string cannot contain a non-empty
            # needle - so nothing became more permissive about unknown data.
            where.append(_ci_contains(func.coalesce(Player.nationality, ""), f.nationality))
        if f.min_minutes is not None:
            where.append(func.coalesce(self.appearance.minutes, 0) >= f.min_minutes)

        # Age. An unknown birth date is visible with no bound active and excluded by
        # any active bound, which is exactly what a NULL date comparison yields; the
        # explicit NOT NULL keeps that true even when a bound is unsatisfiable.
        if f.age_bound_unsatisfiable:
            where.append(literal(False))
        elif f.age_bound_active:
            where.append(Player.birth_date.isnot(None))
            if f.birth_on_or_before is not None:
                where.append(Player.birth_date <= f.birth_on_or_before)
            if f.birth_on_or_after is not None:
                where.append(Player.birth_date >= f.birth_on_or_after)

        # RoleFit bounds read the applicable rating. An unrated row has no score and
        # fails an active bound rather than being treated as a zero.
        score = self.result.final_score
        if f.rolefit_min is not None:
            where.append(and_(score.isnot(None), score >= f.rolefit_min))
        if f.rolefit_max is not None:
            where.append(and_(score.isnot(None), score <= f.rolefit_max))

        if f.playstyle:
            where.append(
                select(literal(1))
                .where(
                    PlayerPlaystyle.player_id == Player.id,
                    PlayerPlaystyle.season_id == f.season_id,
                    PlayerPlaystyle.playstyle_key == f.playstyle,
                    PlayerPlaystyle.is_concern.is_(False),
                )
                .exists()
            )

        # Absolute EUR against the stored expected-asking interval. `value_min` needs
        # a known HIGH endpoint, `value_max` a known LOW one; a missing required
        # endpoint fails the predicate instead of passing as EUR 0.
        if f.value_min is not None:
            high = self.market.expected_asking_high_eur
            where.append(and_(high.isnot(None), high >= f.value_min))
        if f.value_max is not None:
            low = self.market.expected_asking_low_eur
            where.append(and_(low.isnot(None), low <= f.value_max))
        return where

    # -- ordering -----------------------------------------------------------
    def order_by(self, sort: str, collation: Optional[str]) -> list:
        """The approved ordering for one sort mode, with its explicit tie-breaks.

        Every mode ends with canonical name then player id, and every "unknown"
        carries an explicit rank or sentinel rather than relying on the database's
        default NULL placement.
        """
        f = self.filters
        score = self.result.final_score
        rated_first = case((score.is_(None), 1), else_=0)
        score_value = func.coalesce(score, 0.0)
        confidence = _confidence_rank(self.result.confidence).desc()
        age = rounded_age_expr(Player.birth_date, f.season_end)
        asking_low = self.market.expected_asking_low_eur
        priced_first = case((asking_low.is_(None), 1), else_=0)
        price_value = func.coalesce(asking_low, 0.0)
        tail = [_name_key(collation).asc(), Player.id.asc()]

        primary = {
            "rolefit_desc": [rated_first.asc(), score_value.desc(), confidence],
            "rolefit_asc": [rated_first.asc(), score_value.asc(), confidence],
            "age_asc": [func.coalesce(age, _UNKNOWN_AGE_ASC_SENTINEL).asc()],
            "age_desc": [(-func.coalesce(age, _UNKNOWN_AGE_DESC_SENTINEL)).asc()],
            "value_desc": [priced_first.asc(), price_value.desc()],
            "value_asc": [priced_first.asc(), price_value.asc()],
            "name_asc": [],
        }[sort]
        return primary + tail


# ---------------------------------------------------------------------------
# public queries
# ---------------------------------------------------------------------------
def count_players(session: Session, filters: DiscoveryFilters) -> int:
    """How many distinct players qualify.

    ``COUNT(DISTINCT)`` is deliberate: the candidate relation already yields one row
    per player, and counting distinct players says so explicitly, so no future join
    can inflate the total without the count noticing.
    """
    candidates = _Candidates(filters)
    stmt = candidates.select_from(select(func.count(func.distinct(Player.id))))
    return int(session.scalar(stmt) or 0)


def fetch_page(
    session: Session,
    filters: DiscoveryFilters,
    *,
    sort: str,
    limit: int,
    offset: int,
) -> list[DiscoveryRow]:
    """The ordered rows for one page, restricted in the database by LIMIT/OFFSET."""
    candidates = _Candidates(filters)
    best, market, result = candidates.best, candidates.market, candidates.result
    stmt = candidates.select_from(
        select(
            Player.id,
            Player.canonical_name,
            Player.birth_date,
            Player.primary_position,
            candidates.appearance.position_group,
            candidates.appearance.minutes,
            Team.canonical_name,
            Competition.name,
            best.role_key,
            best.final_score,
            best.confidence,
            result.role_key,
            result.final_score,
            result.confidence,
            candidates.high_coverage,
            market.label,
            market.expected_asking_low_eur,
            market.expected_asking_high_eur,
        )
    )
    stmt = stmt.order_by(*candidates.order_by(sort, code_point_collation(session)))
    stmt = stmt.limit(limit).offset(offset)

    rows = []
    for r in session.execute(stmt).all():
        rows.append(
            DiscoveryRow(
                player_id=r[0],
                canonical_name=r[1],
                birth_date=r[2],
                primary_position=r[3],
                appearance_position_group=r[4],
                minutes=r[5],
                club=r[6],
                league=r[7],
                has_any_rating=r[8] is not None,
                best_role=r[8],
                best_score=r[9],
                best_confidence=r[10],
                result_role=r[11],
                result_score=r[12],
                result_confidence=r[13],
                is_high_coverage=bool(r[14]),
                market_label=r[15],
                asking_low=r[16],
                asking_high=r[17],
            )
        )
    return rows


def playstyles_for_players(
    session: Session, season_id: int, player_ids: list[int]
) -> dict[int, list[PlayerPlaystyle]]:
    """Playstyle rows for the page's players only, in one statement."""
    if not player_ids:
        return {}
    out: dict[int, list[PlayerPlaystyle]] = {pid: [] for pid in player_ids}
    rows = session.scalars(
        select(PlayerPlaystyle).where(
            PlayerPlaystyle.season_id == season_id,
            PlayerPlaystyle.player_id.in_(player_ids),
        )
    )
    for row in rows:
        out.setdefault(row.player_id, []).append(row)
    return out
