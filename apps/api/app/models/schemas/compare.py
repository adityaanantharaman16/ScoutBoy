from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from .market import MarketPanel
from .player import (
    ContextPanel,
    PlayerIdentity,
    PlaystyleBadge,
    RoleRatingSummary,
    SubStat,
)


class CompareSide(BaseModel):
    identity: PlayerIdentity
    role_ratings: list[RoleRatingSummary] = []
    substats: list[SubStat] = []
    playstyles: list[PlaystyleBadge] = []
    market: Optional[MarketPanel] = None
    context: Optional[ContextPanel] = None
    confidence: str = "unknown"


class CompareResponse(BaseModel):
    season: str
    role_key: Optional[str] = None
    role_display: Optional[str] = None
    player_a: CompareSide
    player_b: CompareSide
    # normalized side-by-side substats keyed by metric
    stat_rows: list[dict] = []
    role_comparison: dict = {}
    why_higher: str = ""
    confidence_warnings: list[str] = []
