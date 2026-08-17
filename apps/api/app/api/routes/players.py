from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from scoutboy_shared import DISPLAY_SCALE_MAX, MINUTES_FILTER_MAX
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import NotFoundError
from app.models.schemas import (
    DiscoverySearchResponse,
    MarketPanel,
    PlayerCardResponse,
    PlayerPlaystylesResponse,
    RoleRatingDetail,
    SimilarResponse,
)
from app.services import (
    market_service,
    players_service,
    playstyles_service,
    ratings_service,
)

router = APIRouter(prefix="/players", tags=["players"])

# Two SEPARATE domains, each with its own inclusive ceiling. They were briefly one
# constant, which capped the minutes filter at 99 and made a realistic threshold
# such as 450 a validation error.
#
# RoleFit: the authoritative 0-99 scoring scale, so a bound can never ask for a
# score the engine cannot produce.
ROLEFIT_FILTER_MAX = int(DISPLAY_SCALE_MAX)
# Minutes: a technical safety ceiling in minutes, defined in the shared package and
# unrelated to the RoleFit scale. Stored/displayed minutes are never capped by it.
MIN_MINUTES_FILTER_MAX = MINUTES_FILTER_MAX
# Largest page the API will serve in one request.
PAGE_SIZE_MAX = 100


# The response carries the five pagination fields it always has, plus `ranking`:
# the Phase 8.3 explanation of the ordering the query just applied. A dedicated
# schema rather than a `ranking` field bolted onto the generic `Paginated`, because
# ranking is a Discovery concern and every other paginated response would otherwise
# have had to carry a field it can never fill.
@router.get("", response_model=DiscoverySearchResponse)
def search_players(
    q: Optional[str] = Query(
        None,
        description=(
            "Case-insensitive literal substring across player name, club, league and "
            "primary position. When the WHOLE input is a configured club alias "
            "('psg', 'spurs') the clubs it names are searched as well, so club "
            "abbreviations work here too."
        ),
    ),
    age_min: Optional[float] = None,
    age_max: Optional[float] = None,
    position_group: Optional[str] = Query(
        None,
        description=(
            "'ATT', 'MID', 'DEF' or 'GK'. Validated against the domain's "
            "discoverable position groups; an unknown value is a 422."
        ),
    ),
    role: Optional[str] = Query(
        None,
        description=(
            "A configured role key. Only players with a STORED rating for it "
            "qualify, and the result's role context becomes that role: its stored "
            "score and confidence do the filtering, the ordering, the confidence "
            "tie-break and the display. An unknown role key is a 422."
        ),
    ),
    league: Optional[str] = Query(
        None,
        description=(
            "Case-insensitive literal substring over the competition's slug, name and "
            "country, so 'Premier League', 'eng' and 'England' all match. A small "
            "deterministic misspelling table is applied first (see "
            "configs/discovery/search_aliases_v1.yaml); there is no fuzzy matching."
        ),
    ),
    club: Optional[str] = Query(
        None,
        description=(
            "Case-insensitive literal substring over the team's slug and canonical "
            "name. A deterministic alias table resolves common abbreviations and "
            "nicknames first - 'psg', 'P.S.G.', 'spurs', 'thfc' - and an ambiguous "
            "abbreviation returns every club it defensibly names. Anything that is not "
            "a configured alias is searched as an ordinary substring; there is no fuzzy "
            "matching."
        ),
    ),
    nationality: Optional[str] = Query(
        None,
        description=(
            "Case-insensitive literal SUBSTRING of the stored nationality, so 'Eng' "
            "matches England. A player with no stored nationality fails an active "
            "predicate rather than matching."
        ),
    ),
    # Bounds are declared here so a directly crafted out-of-range request gets a
    # 422 rather than silently producing a misleading result set. Minutes and
    # RoleFit carry SEPARATE ceilings: see the module constants.
    min_minutes: Optional[int] = Query(
        None,
        ge=0,
        le=MIN_MINUTES_FILTER_MAX,
        description=(
            f"Whole season minutes, 0-{MIN_MINUTES_FILTER_MAX} inclusive. Omit for "
            "no minutes threshold; 0 is a real accepted value, not 'unset'. "
            "Unrelated to the RoleFit scale."
        ),
    ),
    rolefit_min: Optional[float] = Query(
        None,
        ge=0,
        le=ROLEFIT_FILTER_MAX,
        description=(
            f"Applicable-role-context RoleFit floor on the authoritative "
            f"0-{ROLEFIT_FILTER_MAX} scale."
        ),
    ),
    rolefit_max: Optional[float] = Query(
        None,
        ge=0,
        le=ROLEFIT_FILTER_MAX,
        description=(
            f"Applicable-role-context RoleFit ceiling on the authoritative "
            f"0-{ROLEFIT_FILTER_MAX} scale."
        ),
    ),
    playstyle: Optional[str] = None,
    value_min: Optional[float] = Query(
        None,
        ge=0,
        description=(
            "Absolute EUR. Requires a KNOWN expected-asking high endpoint, which "
            "must reach this floor; a player with unknown market information fails "
            "rather than being read as 0."
        ),
    ),
    value_max: Optional[float] = Query(
        None,
        ge=0,
        description=(
            "Absolute EUR. Requires a KNOWN expected-asking low endpoint at or "
            "below this ceiling. Rejected when value_min exceeds value_max."
        ),
    ),
    sort: str = Query(
        players_service.DEFAULT_SEARCH_SORT,
        description=(
            "One of: " + ", ".join(players_service.SEARCH_SORTS) + ". Unknown values "
            "are a 422 rather than a silent fallback. RoleFit modes order by the "
            "applicable role context's stored score and break ties on its stored "
            "confidence; the asking-price modes order by expected_asking_low_eur "
            "with unknown lower bounds last in both directions. 'age_desc' is "
            "API-only: the Discovery Sort control does not offer it."
        ),
    ),
    scope: Optional[str] = Query(
        None,
        description=(
            "'analyzed' (default), 'all_records', or 'high_coverage_u23'. Still a "
            "supported API capability; the Discovery UI no longer exposes a selector "
            "for it and always requests the default."
        ),
    ),
    age_band: Optional[str] = Query(
        None,
        description=(
            "Legacy age filter: 'all' (default), 'u23', '24_26', '27_30', or "
            "'31_plus'. Superseded by the one-sided age_min / age_max bounds the "
            "Discovery age control writes; retained so existing callers keep working."
        ),
    ),
    universe: Optional[str] = Query(
        None,
        description="Legacy alias: 'mvp' maps to high_coverage_u23; 'all' maps to all_records. Ignored when scope is supplied.",
    ),
    page: int = Query(
        1,
        ge=1,
        description=(
            "1-based. A page past the end of a non-empty result set returns the "
            "last available page, and the response reports the page actually served."
        ),
    ),
    page_size: int = Query(20, ge=1, le=PAGE_SIZE_MAX),
    db: Session = Depends(get_db),
):
    return players_service.search_players(
        db,
        q=q,
        age_min=age_min,
        age_max=age_max,
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
        sort=sort,
        scope=scope,
        age_band=age_band,
        universe=universe,
        page=page,
        page_size=page_size,
    )


@router.get("/{player_id}", response_model=PlayerCardResponse)
def get_player(player_id: int, db: Session = Depends(get_db)):
    card = players_service.build_player_card(db, player_id)
    if card is None:
        raise NotFoundError(f"Player {player_id} not found")
    return card


@router.get("/{player_id}/ratings", response_model=RoleRatingDetail)
def get_player_ratings(player_id: int, db: Session = Depends(get_db)):
    detail = ratings_service.ratings_detail(db, player_id)
    if detail is None:
        raise NotFoundError(f"Player {player_id} not found")
    return detail


@router.get("/{player_id}/playstyles", response_model=PlayerPlaystylesResponse)
def get_player_playstyles(player_id: int, db: Session = Depends(get_db)):
    result = playstyles_service.player_playstyles(db, player_id)
    if result is None:
        raise NotFoundError(f"Player {player_id} not found")
    return result


@router.get("/{player_id}/market", response_model=MarketPanel)
def get_player_market(player_id: int, db: Session = Depends(get_db)):
    market = market_service.player_market(db, player_id)
    if market is None:
        raise NotFoundError(f"Player {player_id} or market value not found")
    return market


@router.get("/{player_id}/similar", response_model=SimilarResponse)
def get_similar_players(player_id: int, db: Session = Depends(get_db)):
    result = players_service.find_similar(db, player_id)
    if result is None:
        raise NotFoundError(f"Player {player_id} not found")
    return result
