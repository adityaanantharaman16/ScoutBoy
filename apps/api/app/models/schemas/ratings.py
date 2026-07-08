from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from .player import RoleRatingSummary


class AuditBreakdown(BaseModel):
    role_key: str
    metric_breakdown: dict = {}
    context_breakdown: dict = {}
    confidence_breakdown: dict = {}
    penalties: dict = {}
    explanation_text: Optional[str] = None


class RoleRatingDetail(BaseModel):
    player_id: int
    season: str
    rating_version: str
    ratings: list[RoleRatingSummary] = []
    audits: list[AuditBreakdown] = []
