from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class SimilarPlayer(BaseModel):
    player_id: int
    canonical_name: str
    club: Optional[str] = None
    league: Optional[str] = None
    age: Optional[float] = None
    best_role: Optional[str] = None
    best_role_score: Optional[float] = None
    similarity: float
    expected_asking_low_eur: Optional[float] = None
    expected_asking_high_eur: Optional[float] = None
    reason: str = ""


class SimilarGroup(BaseModel):
    key: str
    label: str
    description: str
    players: list[SimilarPlayer] = []


class SimilarResponse(BaseModel):
    player_id: int
    season: str
    groups: list[SimilarGroup] = []
