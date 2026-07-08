from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import NotFoundError
from app.models.schemas import (
    MarketPanel,
    Paginated,
    PlayerCardResponse,
    PlayerPlaystylesResponse,
    PlayerSearchCard,
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


@router.get("", response_model=Paginated[PlayerSearchCard])
def search_players(
    q: Optional[str] = None,
    age_min: Optional[float] = None,
    age_max: Optional[float] = None,
    position_group: Optional[str] = None,
    role: Optional[str] = None,
    league: Optional[str] = None,
    club: Optional[str] = None,
    nationality: Optional[str] = None,
    min_minutes: Optional[int] = None,
    rolefit_min: Optional[float] = None,
    rolefit_max: Optional[float] = None,
    playstyle: Optional[str] = None,
    value_min: Optional[float] = None,
    value_max: Optional[float] = None,
    sort: str = "rolefit_desc",
    universe: str = Query(
        "mvp",
        description="'mvp' (default) filters to the U23 EU att/mid universe; 'all' includes everyone",
    ),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
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
