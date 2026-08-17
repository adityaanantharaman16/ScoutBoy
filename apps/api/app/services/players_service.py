"""Player search, player card, and similarity assembly."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

from scoutboy_shared import DISCOVERABLE_POSITION_GROUPS, position_group_for
from scoutboy_shared import MVP_UNIVERSE_KEY as UNIVERSE_KEY
from sqlalchemy.orm import Session

from app.core.errors import QueryValidationError
from app.models.orm import Player, RoleRating
from app.models.schemas import (
    DataSource,
    DiscoverySearchResponse,
    PlayerCardResponse,
    PlayerIdentity,
    PlayerSearchCard,
    SimilarGroup,
    SimilarPlayer,
    SimilarResponse,
    StrengthConcern,
)
from app.repositories import discovery_repo
from app.repositories import players_repo as repo

from . import _common as C
from . import discovery_explanation

SEARCH_SCOPES = {"analyzed", "all_records", "high_coverage_u23"}
AGE_BANDS = {"all", "u23", "24_26", "27_30", "31_plus"}
UNIVERSE_ALIASES = {"mvp": "high_coverage_u23", "all": "all_records"}

# The accepted player-search sort modes, and the one definition of the set. An
# unknown value is rejected rather than silently falling back to RoleFit
# descending, which used to make a typo look like a deliberate ranking.
#
# `age_desc` is API-only on purpose: the Discovery Sort control has never offered
# it, but it is a legitimate documented capability for direct callers, so it stays.
SEARCH_SORTS = (
    "rolefit_desc",
    "rolefit_asc",
    "age_asc",
    "age_desc",
    "value_desc",
    "value_asc",
    "name_asc",
)
DEFAULT_SEARCH_SORT = "rolefit_desc"

# Which role context a result's `result_role*` fields describe. The ranking
# explanation reports the same two values for the same reason, from
# `discovery_explanation`, so a card and the explanation beside it cannot disagree
# about which rating did the work.
RESULT_ROLE_BEST = discovery_explanation.RESULT_ROLE_BEST
RESULT_ROLE_SELECTED = discovery_explanation.RESULT_ROLE_SELECTED


@dataclass
class _Row:
    """One player-season assembled in Python, for the dossier's similarity groups.

    Discovery no longer uses this: since Phase 8.1B its candidate selection,
    predicates, ordering, counting and pagination all run in SQL (see
    `repositories.discovery_repo`). `find_similar` still needs the whole
    position-group cohort in memory to score cosine similarity against every
    candidate, so the full-cohort assembly below stays for that one caller.
    """

    player: Player
    club: Optional[str]
    club_slug: Optional[str]
    league_slug: Optional[str]
    league_name: Optional[str]
    minutes: int
    position_group: Optional[str]
    age: Optional[float]
    ratings: list[RoleRating]
    best: Optional[RoleRating]
    playstyle_keys: set = field(default_factory=set)
    top_playstyles: list = field(default_factory=list)
    market: object = None
    is_high_coverage: bool = False


def _load_rows(session: Session, season) -> list[_Row]:
    teams = repo.teams_by_id(session)
    comps = repo.competitions_by_id(session)
    appearances = repo.primary_appearances(session, season.id)
    ratings = repo.ratings_for_season(session, season.id)
    playstyles = repo.playstyles_for_season(session, season.id)
    markets = repo.markets_for_season(session, season.id)

    rows: list[_Row] = []
    for pid, appr in appearances.items():
        player = session.get(Player, pid)
        if player is None:
            continue
        team = teams.get(appr.team_id)
        comp = comps.get(appr.competition_id)
        pg = appr.position_group or position_group_for(player.primary_position or "")
        pls = playstyles.get(pid, [])
        rlist = ratings.get(pid, [])
        best = C.best_rating(rlist)
        rows.append(
            _Row(
                player=player,
                club=team.canonical_name if team else None,
                club_slug=team.slug if team else None,
                league_slug=comp.slug if comp else None,
                league_name=comp.name if comp else None,
                minutes=appr.minutes or 0,
                position_group=pg,
                age=C.age_for(player.birth_date, season.end_date),
                ratings=rlist,
                best=best,
                playstyle_keys={p.playstyle_key for p in pls if not p.is_concern},
                top_playstyles=C.top_playstyle_names(pls),
                market=markets.get(pid),
            )
        )
    return rows


def _evidence_status(*, is_high_coverage: bool, has_analysis: bool) -> str:
    if is_high_coverage:
        return "high_coverage"
    if has_analysis:
        return "analyzed_limited"
    return "profile_only"


def _card_from_row(
    row: discovery_repo.DiscoveryRow,
    playstyles: list,
    *,
    season_label: str,
    season_end: Optional[date],
    result_role_source: str,
) -> PlayerSearchCard:
    """Serialize one database-selected Discovery row.

    Every score and confidence is a stored value read straight off the row the query
    selected, so the displayed role context is by construction the one that qualified,
    bounded and ordered it. Nothing is rescored, and no unknown becomes a zero.
    """
    names = C.role_display_map()
    has_analysis = row.has_any_rating
    minutes = row.minutes or 0
    result_confidence = row.result_confidence if row.result_role is not None else "unknown"
    return PlayerSearchCard(
        id=row.player_id,
        canonical_name=row.canonical_name,
        season=season_label,
        age=C.age_for(row.birth_date, season_end),
        club=row.club,
        league=row.league,
        primary_position=row.primary_position,
        position_group=(
            row.appearance_position_group or position_group_for(row.primary_position or "")
        ),
        # The player's own best role, whatever was filtered. Never relabelled.
        best_role=row.best_role,
        best_role_display=names.get(row.best_role) if row.best_role else None,
        best_role_score=row.best_score,
        best_role_confidence=row.best_confidence if has_analysis else "unknown",
        # The stored rating the query filtered and ordered by.
        result_role=row.result_role,
        result_role_display=names.get(row.result_role) if row.result_role else None,
        result_role_score=row.result_score,
        result_role_confidence=result_confidence,
        result_role_source=result_role_source,
        confidence=result_confidence,
        analysis_status="analyzed" if has_analysis else "profile_only",
        evidence_status=_evidence_status(
            is_high_coverage=row.is_high_coverage, has_analysis=has_analysis
        ),
        has_rolefit_analysis=has_analysis,
        is_high_coverage=row.is_high_coverage,
        top_playstyles=C.top_playstyle_names(playstyles),
        minutes=minutes,
        represented_minutes=minutes,
        market_label=row.market_label,
        expected_asking_low_eur=row.asking_low,
        expected_asking_high_eur=row.asking_high,
    )


def _normalize_scope(scope: Optional[str], universe: Optional[str]) -> str:
    if scope in SEARCH_SCOPES:
        return scope
    if universe in UNIVERSE_ALIASES:
        return UNIVERSE_ALIASES[universe]
    return "analyzed"


def _validate_query(
    *,
    sort: str,
    position_group: Optional[str],
    role: Optional[str],
    value_min: Optional[float],
    value_max: Optional[float],
) -> None:
    """Reject query values that can only be checked against the domain or config.

    `scope`, `universe` and `age_band` are deliberately absent: their documented
    compatibility behaviour is to fall back to a default, and changing that would
    break links this project promised to keep working.
    """
    if sort not in SEARCH_SORTS:
        raise QueryValidationError(
            "sort", sort, f"Unknown sort. Accepted: {', '.join(SEARCH_SORTS)}."
        )
    if position_group is not None and position_group not in DISCOVERABLE_POSITION_GROUPS:
        raise QueryValidationError(
            "position_group",
            position_group,
            f"Unknown position group. Accepted: {', '.join(DISCOVERABLE_POSITION_GROUPS)}.",
        )
    # Roles come from configs/roles/*.yaml, so the configured set is the authority.
    if role is not None and role not in C.role_display_map():
        raise QueryValidationError("role", role, "Unknown role key.")
    if value_min is not None and value_max is not None and value_min > value_max:
        raise QueryValidationError("value_min", value_min, "value_min must not exceed value_max.")


def _age_band_bounds(age_band: Optional[str]) -> tuple[Optional[float], Optional[float]]:
    if age_band == "u23":
        return None, 23
    if age_band == "24_26":
        return 24, 26
    if age_band == "27_30":
        return 27, 30
    if age_band == "31_plus":
        return 31, None
    return None, None


# ---------------------------------------------------------------------------
# Age bounds as birth-date boundaries
#
# Age is `round((season_end - birth_date).days / 365.25, 1)`: a step function of a
# whole number of days, and non-decreasing in that day count. So every age bound has
# an exact equivalent birth-date boundary, which the database can compare against a
# stored date with no dialect-specific date arithmetic at all. The rounding stays in
# Python, where it always was, so the displayed age and the applied filter are derived
# from the very same expression.
# ---------------------------------------------------------------------------
_DAYS_PER_YEAR = 365.25
#: Beyond this many years no representable birth date exists (`date.min` is ~2,000
#: years back), so a bound past it is decided without touching the day arithmetic.
#: This is also what keeps an absurd or infinite bound from overflowing.
_AGE_SPAN_LIMIT = 12_000.0


def _rounded_age_for_days(days: int) -> float:
    """The one definition of a rounded age, shared by the filter and the display."""
    return round(days / _DAYS_PER_YEAR, 1)


def _days_for_age_floor(age_min: float) -> int:
    """Fewest whole days whose rounded age still reaches `age_min`.

    Found by stepping around a closed-form estimate rather than solving the rounding
    boundary algebraically, so the answer is defined by `_rounded_age_for_days` itself
    and cannot drift from it. The rounded age is monotone in `days`, so the two short
    scans below are exact and terminate within a few dozen steps.
    """
    days = int((age_min - 0.1) * _DAYS_PER_YEAR) - 2
    while _rounded_age_for_days(days) >= age_min:
        days -= 1
    while _rounded_age_for_days(days) < age_min:
        days += 1
    return days


def _days_for_age_ceiling(age_max: float) -> int:
    """Most whole days whose rounded age still sits at or under `age_max`."""
    days = int((age_max + 0.1) * _DAYS_PER_YEAR) + 2
    while _rounded_age_for_days(days) <= age_max:
        days += 1
    while _rounded_age_for_days(days) > age_max:
        days -= 1
    return days


def _birth_date_window(
    season_end: Optional[date],
    floors: list,
    ceilings: list,
) -> tuple[Optional[date], Optional[date], bool, bool]:
    """Translate age bounds into a birth-date window.

    Returns `(birth_on_or_before, birth_on_or_after, any_bound_active,
    unsatisfiable)`. An older player has an earlier birth date, so an age FLOOR
    becomes a latest-allowed birth date and an age CEILING becomes an earliest-allowed
    one. Several bounds may be active at once (`age_min`/`age_max` plus a legacy
    `age_band`); they intersect, exactly as the previous independent comparisons did.

    A record with no birth date is deliberately left out of the window entirely: it
    stays visible while no bound is active and fails every active one.
    """
    active = bool(floors or ceilings)
    if not active:
        return None, None, False, False
    # With no season end date no age is knowable, so every age was previously unknown
    # and every active bound excluded every record.
    if season_end is None:
        return None, None, True, True

    oldest_days = (season_end - date.min).days
    youngest_days = (season_end - date.max).days
    before: Optional[date] = None
    after: Optional[date] = None

    for value in floors:
        if value != value:  # NaN: every comparison was false, so nothing was excluded
            continue
        if value > _AGE_SPAN_LIMIT:
            return None, None, True, True
        if value < -_AGE_SPAN_LIMIT:
            continue
        days = _days_for_age_floor(value)
        if days > oldest_days:
            return None, None, True, True
        if days < youngest_days:
            continue
        boundary = season_end - timedelta(days=days)
        before = boundary if before is None else min(before, boundary)

    for value in ceilings:
        if value != value:
            continue
        if value < -_AGE_SPAN_LIMIT:
            return None, None, True, True
        if value > _AGE_SPAN_LIMIT:
            continue
        days = _days_for_age_ceiling(value)
        if days < youngest_days:
            return None, None, True, True
        if days > oldest_days:
            continue
        boundary = season_end - timedelta(days=days)
        after = boundary if after is None else max(after, boundary)

    return before, after, True, False


def _empty_response(*, sort: str, role, page_size: int) -> DiscoverySearchResponse:
    """A well-formed zero-result page that still explains the active ordering."""
    return DiscoverySearchResponse(
        items=[],
        total=0,
        page=1,
        page_size=page_size,
        total_pages=0,
        ranking=discovery_explanation.build(
            sort=sort,
            role_key=role,
            role_display_map=C.role_display_map(),
        ),
    )


def search_players(
    session: Session,
    *,
    q=None,
    age_min=None,
    age_max=None,
    position_group=None,
    role=None,
    league=None,
    club=None,
    nationality=None,
    min_minutes=None,
    rolefit_min=None,
    rolefit_max=None,
    playstyle=None,
    value_min=None,
    value_max=None,
    sort=DEFAULT_SEARCH_SORT,
    scope=None,
    age_band=None,
    universe=None,
    page=1,
    page_size=20,
) -> DiscoverySearchResponse:
    """One page of Discovery results, selected and ordered by the database.

    The database does the work: it identifies the qualifying player-season rows,
    resolves the one stored role rating each row is judged by, applies every
    predicate, applies the approved ordering and tie-breaks, counts the distinct
    qualifying players and returns only the requested page. This function normalizes
    the request, canonicalizes the page against the total, and serializes.

    Since Phase 8.3 it also attaches the ranking explanation: the active mode's exact
    ordered key sequence, the role context every result's RoleFit is read from and
    whether that rating also ordered the page, how unknown values are placed, and the
    deterministic final tie-breaks. It is derived entirely from the one sort
    specification the SQL `ORDER BY` is built from, so it reads no rows and costs no
    query.
    """
    _validate_query(
        sort=sort,
        position_group=position_group,
        role=role,
        value_min=value_min,
        value_max=value_max,
    )
    season = repo.get_current_season(session)
    if season is None:
        # Nothing qualifies, but the request still HAS an active sort, so the
        # explanation is still the honest answer to "what ranking mode is this?".
        return _empty_response(sort=sort, role=role, page_size=page_size)

    selected_scope = _normalize_scope(scope, universe)
    selected_age_band = age_band if age_band in AGE_BANDS else "all"
    band_min, band_max = _age_band_bounds(selected_age_band)
    birth_before, birth_after, age_active, age_impossible = _birth_date_window(
        season.end_date,
        [v for v in (age_min, band_min) if v is not None],
        [v for v in (age_max, band_max) if v is not None],
    )

    filters = discovery_repo.DiscoveryFilters(
        season_id=season.id,
        universe_key=UNIVERSE_KEY,
        scope=selected_scope,
        q=q,
        position_group=position_group,
        role=role,
        league=league,
        club=club,
        nationality=nationality,
        min_minutes=min_minutes,
        rolefit_min=rolefit_min,
        rolefit_max=rolefit_max,
        playstyle=playstyle,
        value_min=value_min,
        value_max=value_max,
        birth_on_or_before=birth_before,
        birth_on_or_after=birth_after,
        age_bound_active=age_active,
        age_bound_unsatisfiable=age_impossible,
        season_end=season.end_date,
    )

    total = discovery_repo.count_players(session, filters)
    total_pages = math.ceil(total / page_size) if page_size else 0
    # A valid request for a page past the end returns the last page that exists,
    # never an empty ledger that would read as "no players match these filters".
    # A genuinely empty result is page 1. The total is known before any row is
    # fetched, so this costs no extra candidate scan.
    effective_page = min(page, total_pages) if total_pages else 1

    rows: list = []
    if total_pages:
        rows = discovery_repo.fetch_page(
            session,
            filters,
            sort=sort,
            limit=page_size,
            offset=(effective_page - 1) * page_size,
        )
    # Card enrichment is bounded to the page: playstyles are the only card data the
    # candidate row does not already carry, and they load for these ids alone.
    playstyles = discovery_repo.playstyles_for_players(
        session, season.id, [row.player_id for row in rows]
    )
    result_role_source = RESULT_ROLE_SELECTED if role else RESULT_ROLE_BEST
    return DiscoverySearchResponse(
        items=[
            _card_from_row(
                row,
                playstyles.get(row.player_id, []),
                season_label=season.label,
                season_end=season.end_date,
                result_role_source=result_role_source,
            )
            for row in rows
        ],
        total=total,
        page=effective_page,
        page_size=page_size,
        total_pages=total_pages,
        # Built from the same sort specification the ORDER BY above was built from,
        # and from nothing else: no rows are read and no further query is issued.
        ranking=discovery_explanation.build(
            sort=sort,
            role_key=role,
            role_display_map=C.role_display_map(),
        ),
    )


def _strengths_concerns(audit) -> tuple[list[StrengthConcern], list[StrengthConcern]]:
    strengths, concerns = [], []
    if audit is None:
        return strengths, concerns
    groups = (audit.metric_breakdown_json or {}).get("groups", [])
    scored = [g for g in groups if g.get("group_score") is not None]
    for g in sorted(scored, key=lambda g: g["group_score"], reverse=True)[:3]:
        if g["group_score"] >= 65:
            strengths.append(
                StrengthConcern(
                    label=g["key"].replace("_", " ").title(),
                    detail=f"{g['group_score']:.0f}/100 in {g['key'].replace('_', ' ')} for this role.",
                    score=g["group_score"],
                )
            )
    for g in sorted(scored, key=lambda g: g["group_score"])[:2]:
        if g["group_score"] <= 35:
            concerns.append(
                StrengthConcern(
                    label=f"Weak {g['key'].replace('_', ' ')}",
                    detail=f"Only {g['group_score']:.0f}/100 in {g['key'].replace('_', ' ')}.",
                )
            )
    for p in (audit.penalties_json or {}).get("items", []):
        concerns.append(
            StrengthConcern(
                label=p["key"].replace("_", " ").title(), detail=p.get("explanation", "")
            )
        )
    return strengths, concerns


def build_player_card(session: Session, player_id: int) -> Optional[PlayerCardResponse]:
    player = repo.get_player(session, player_id)
    if player is None:
        return None
    season = repo.get_current_season(session)
    if season is None:
        return None

    appr = repo.primary_appearances(session, season.id).get(player_id)
    teams = repo.teams_by_id(session)
    comps = repo.competitions_by_id(session)
    club = league = None
    minutes = 0
    appearances_count = starts_count = None
    if appr:
        team = teams.get(appr.team_id)
        comp = comps.get(appr.competition_id)
        club = team.canonical_name if team else None
        league = comp.name if comp else None
        minutes = appr.minutes or 0
        appearances_count = appr.appearances
        starts_count = appr.starts

    normalized = repo.normalized_for_player(session, player_id, season.id)
    ratings = repo.ratings_for_player(session, player_id, season.id)
    playstyles = repo.playstyles_for_player(session, player_id, season.id)
    market = repo.market_for_player(session, player_id, season.id)
    ctx = repo.contexts_for_season(session, season.id).get(player_id)
    sources = repo.source_ids_for_player(session, player_id)
    evidence_rows = repo.evidence_for_player(session, player_id, season.id)
    primary_evidence = (
        sorted(evidence_rows, key=lambda e: (-(e.minutes or 0), e.provider_id))[0]
        if evidence_rows
        else None
    )
    providers = repo.providers_by_id(session) if evidence_rows else {}
    snapshot_ids = {
        e.source_snapshot_record_id
        for e in evidence_rows
        if e.source_snapshot_record_id is not None
    }
    snapshots = repo.source_snapshots_by_id(session, snapshot_ids)
    primary_provider = providers.get(primary_evidence.provider_id) if primary_evidence else None
    primary_snapshot = (
        snapshots.get(primary_evidence.source_snapshot_record_id)
        if primary_evidence and primary_evidence.source_snapshot_record_id
        else None
    )

    substats = C.substats_from_normalized(normalized)
    sample_conf = ctx.context_confidence if ctx else "unknown"
    face_stats = C.face_stats_from_substats(substats, sample_conf)
    role_summaries = C.role_summaries(ratings)
    best = C.best_rating(ratings)
    positives, concern_badges = C.playstyle_badges(playstyles)

    strengths, concerns_text = [], []
    if best:
        audit = repo.audits_for_ratings(session, [best.id]).get(best.id)
        strengths, concerns_text = _strengths_concerns(audit)

    identity = PlayerIdentity(
        id=player.id,
        canonical_name=player.canonical_name,
        age=C.age_for(player.birth_date, season.end_date),
        birth_date=player.birth_date.isoformat() if player.birth_date else None,
        nationality=player.nationality,
        preferred_foot=player.preferred_foot,
        height_cm=player.height_cm,
        primary_position=player.primary_position,
        secondary_positions=player.secondary_positions or [],
        position_group=(
            appr.position_group if appr else position_group_for(player.primary_position or "")
        ),
        club=club,
        league=league,
    )

    overall_conf = best.confidence if best else "unknown"
    is_high_coverage = (
        player_id in repo.eligible_universe_ids(session, season.id, UNIVERSE_KEY)
        if repo.universe_materialized(session, season.id, UNIVERSE_KEY)
        else False
    )
    evidence_status = (
        "high_coverage" if is_high_coverage else "analyzed_limited" if ratings else "profile_only"
    )
    return PlayerCardResponse(
        identity=identity,
        season=season.label,
        confidence=overall_conf,
        analysis_status="analyzed" if ratings else "profile_only",
        evidence_status=evidence_status,
        has_rolefit_analysis=bool(ratings),
        is_high_coverage=is_high_coverage,
        best_role=best.role_key if best else None,
        face_stats=face_stats,
        substats=substats,
        role_ratings=role_summaries,
        playstyles=positives,
        concerns=concern_badges,
        market=C.market_panel(market),
        strengths=strengths,
        concerns_text=concerns_text,
        context=C.context_panel(
            ctx,
            minutes,
            appearances=appearances_count,
            starts=starts_count,
            evidence=primary_evidence,
            provider=primary_provider,
            snapshot=primary_snapshot,
            uses_modeled_values=bool(ratings),
        ),
        data_sources=[
            DataSource(
                source_name=s.source_name,
                source_player_id=s.source_player_id,
                source_url=s.source_url,
                data_type="demo" if s.source_name == "sample" else None,
            )
            for s in sources
        ]
        + [
            DataSource(
                source_name=p.slug,
                provider_display_name=p.name,
                data_type=p.provider_type,
                last_updated=(
                    snapshots[e.source_snapshot_record_id].as_of_date.isoformat()
                    if e.source_snapshot_record_id in snapshots
                    and snapshots[e.source_snapshot_record_id].as_of_date
                    else None
                ),
                license_url=p.license_url,
                attribution=p.attribution,
            )
            for e in evidence_rows
            for p in [providers.get(e.provider_id)]
            if p is not None
        ],
        last_updated=player.updated_at.isoformat() if player.updated_at else None,
        rating_version=best.version if best else None,
    )


def find_similar(session: Session, player_id: int, limit: int = 5) -> Optional[SimilarResponse]:
    from app.models.orm import SimilarityVector

    season = repo.get_current_season(session)
    if season is None or repo.get_player(session, player_id) is None:
        return None
    vectors = {
        (v.player_id, v.vector_type): v.vector_json
        for v in session.query(SimilarityVector).filter(SimilarityVector.season_id == season.id)
    }
    style_target = vectors.get((player_id, "style"))
    if not style_target:
        return SimilarResponse(player_id=player_id, season=season.label, groups=[])

    rows = {r.player.id: r for r in _load_rows(session, season)}
    target = rows.get(player_id)
    target_pg = target.position_group if target else None

    def cosine(a: dict, b: dict) -> float:
        keys = set(a) & set(b)
        if not keys:
            return 0.0
        dot = sum(a[k] * b[k] for k in keys)
        na = math.sqrt(sum(v * v for v in a.values()))
        nb = math.sqrt(sum(v * v for v in b.values()))
        return dot / (na * nb) if na and nb else 0.0

    scored = []
    for pid, row in rows.items():
        if pid == player_id or row.position_group != target_pg:
            continue
        vec = vectors.get((pid, "style"))
        if not vec:
            continue
        scored.append((cosine(style_target, vec), row))
    scored.sort(key=lambda x: (-x[0], x[1].player.canonical_name.lower(), x[1].player.id))

    def sp(sim, row, reason):
        m = row.market
        return SimilarPlayer(
            player_id=row.player.id,
            canonical_name=row.player.canonical_name,
            club=row.club,
            league=row.league_name,
            age=row.age,
            best_role=row.best.role_key if row.best else None,
            best_role_score=row.best.final_score if row.best else None,
            similarity=round(sim, 3),
            expected_asking_low_eur=getattr(m, "expected_asking_low_eur", None),
            expected_asking_high_eur=getattr(m, "expected_asking_high_eur", None),
            reason=reason,
        )

    style_comps = [sp(s, r, "Similar statistical profile") for s, r in scored[:limit]]

    target_score = target.best.final_score if target and target.best else 0.0
    target_ask = target.market.expected_asking_high_eur if target and target.market else None
    quality = sorted(
        [(s, r) for s, r in scored if s >= 0.5],
        key=lambda x: (-(x[1].best.final_score if x[1].best else 0), x[1].player.id),
    )
    quality_comps = [sp(s, r, "Similar profile, comparable quality") for s, r in quality[:limit]]
    cheaper = [
        sp(s, r, "Similar profile, lower expected asking price")
        for s, r in scored
        if r.market and target_ask and (r.market.expected_asking_high_eur or 0) < target_ask
    ][:limit]
    upside = [
        sp(s, r, "Similar profile, higher RoleFit upside")
        for s, r in scored
        if r.best and r.best.final_score > target_score
    ][:limit]

    return SimilarResponse(
        player_id=player_id,
        season=season.label,
        groups=[
            SimilarGroup(
                key="style",
                label="Style comps",
                description="Closest statistical style within the same position group.",
                players=style_comps,
            ),
            SimilarGroup(
                key="quality",
                label="Quality comps",
                description="Stylistically similar and of comparable rated quality.",
                players=quality_comps,
            ),
            SimilarGroup(
                key="cheaper",
                label="Similar but cheaper",
                description="Similar style at a lower expected asking price.",
                players=cheaper,
            ),
            SimilarGroup(
                key="upside",
                label="Higher upside",
                description="Similar style with a higher RoleFit score.",
                players=upside,
            ),
        ],
    )
