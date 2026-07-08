from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.repositories import players_repo as repo

from . import _common as C


def player_playstyles(session: Session, player_id: int) -> Optional[dict]:
    if repo.get_player(session, player_id) is None:
        return None
    season = repo.get_current_season(session)
    if season is None:
        return None
    rows = repo.playstyles_for_player(session, player_id, season.id)
    positives, concerns = C.playstyle_badges(rows)
    return {
        "player_id": player_id,
        "season": season.label,
        "playstyles": [b.model_dump() for b in positives],
        "concerns": [b.model_dump() for b in concerns],
    }
