from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import BadRequestError, NotFoundError
from app.models.schemas import CompareResponse
from app.services import compare_service

router = APIRouter(prefix="/compare", tags=["compare"])


@router.get("", response_model=CompareResponse)
def compare(
    player_a: int = Query(...),
    player_b: int = Query(...),
    role_key: Optional[str] = None,
    db: Session = Depends(get_db),
):
    if player_a == player_b:
        raise BadRequestError("player_a and player_b must be different")
    result = compare_service.compare_players(db, player_a, player_b, role_key)
    if result is None:
        raise NotFoundError("One or both players not found")
    return result
