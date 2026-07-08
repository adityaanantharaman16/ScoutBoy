from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.models.schemas import MarketPanel
from app.repositories import players_repo as repo

from . import _common as C


def player_market(session: Session, player_id: int) -> Optional[MarketPanel]:
    if repo.get_player(session, player_id) is None:
        return None
    season = repo.get_current_season(session)
    if season is None:
        return None
    return C.market_panel(repo.market_for_player(session, player_id, season.id))
