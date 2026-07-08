from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class RoleRankingRow(BaseModel):
    rank: int
    player_id: int
    canonical_name: str
    age: Optional[float] = None
    club: Optional[str] = None
    league: Optional[str] = None
    final_score: float
    confidence: str
    top_playstyles: list[str] = []
    expected_asking_low_eur: Optional[float] = None
    expected_asking_high_eur: Optional[float] = None


class RoleLeaderboard(BaseModel):
    role_key: str
    display_name: str
    position_group: str
    description: Optional[str] = None
    season: str
    rating_version: str
    total: int
    rows: list[RoleRankingRow] = []
