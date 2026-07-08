from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import NotFoundError
from app.models.schemas import RoleLeaderboard
from app.services import roles_service

router = APIRouter(prefix="/roles", tags=["roles"])


@router.get("/{role_key}/rankings", response_model=RoleLeaderboard)
def role_rankings(
    role_key: str,
    age_min: Optional[float] = None,
    age_max: Optional[float] = None,
    league: Optional[str] = None,
    min_minutes: Optional[int] = None,
    min_confidence: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    board = roles_service.role_leaderboard(
        db,
        role_key,
        age_min=age_min,
        age_max=age_max,
        league=league,
        min_minutes=min_minutes,
        min_confidence=min_confidence,
        limit=limit,
    )
    if board is None:
        raise NotFoundError(f"Role '{role_key}' not found")
    return board
