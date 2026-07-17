from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from .common import DataSource
from .market import MarketPanel


class PlayerIdentity(BaseModel):
    id: int
    canonical_name: str
    age: Optional[float] = None
    birth_date: Optional[str] = None
    nationality: Optional[str] = None
    preferred_foot: Optional[str] = None
    height_cm: Optional[int] = None
    primary_position: Optional[str] = None
    secondary_positions: list[str] = []
    position_group: Optional[str] = None
    club: Optional[str] = None
    league: Optional[str] = None


class SubStat(BaseModel):
    name: str
    display: str
    unit: str
    per90_value: Optional[float] = None
    percentile: Optional[float] = None
    score: Optional[float] = None
    present: bool = True


class FaceStat(BaseModel):
    group_key: str
    group_label: str
    score: Optional[float] = None  # None => unknown, never zeroed
    confidence: str
    metrics: list[SubStat] = []


class RoleRatingSummary(BaseModel):
    role_key: str
    display_name: str
    final_score: float
    raw_score: float
    context_adjusted_score: float
    confidence: str
    rank_in_peer_group: Optional[int] = None
    is_best: bool = False


class PlaystyleBadge(BaseModel):
    playstyle_key: str
    display_name: str
    category: str
    tier: Optional[str] = None
    confidence: str
    is_concern: bool = False
    why_applied: dict = {}
    supporting_metrics: list[dict] = []


class StrengthConcern(BaseModel):
    label: str
    detail: str
    score: Optional[float] = None


class ContextPanel(BaseModel):
    league_strength: Optional[float] = None
    team_strength: Optional[float] = None
    opposition_quality: Optional[float] = None
    competition_stakes: Optional[float] = None
    role_usage: Optional[float] = None
    sample_reliability: Optional[float] = None
    translation_risk: Optional[str] = None
    sample_confidence: Optional[str] = None
    minutes: Optional[int] = None
    appearances: Optional[int] = None
    starts: Optional[int] = None
    data_source: Optional[str] = None
    data_type: Optional[str] = None
    data_last_updated: Optional[str] = None
    matches_covered: Optional[int] = None
    known_total_matches: Optional[int] = None
    competition_coverage_pct: Optional[float] = None
    data_recency_days: Optional[int] = None
    sample_size_confidence: Optional[str] = None
    coverage_confidence: Optional[str] = None
    league_adjustment_confidence: Optional[str] = None
    role_similarity_confidence: Optional[str] = None
    overall_rating_confidence: Optional[str] = None
    uses_event_data: bool = False
    uses_basic_statistics: bool = False
    uses_modeled_values: bool = False
    uses_demo_data: bool = False
    limitations: list[str] = []
    attribution: Optional[str] = None
    explanation: dict = {}


class PlayerSearchCard(BaseModel):
    id: int
    canonical_name: str
    age: Optional[float] = None
    club: Optional[str] = None
    league: Optional[str] = None
    primary_position: Optional[str] = None
    position_group: Optional[str] = None
    best_role: Optional[str] = None
    best_role_display: Optional[str] = None
    best_role_score: Optional[float] = None
    confidence: str = "unknown"
    top_playstyles: list[str] = []
    minutes: Optional[int] = None
    market_label: Optional[str] = None
    expected_asking_low_eur: Optional[float] = None
    expected_asking_high_eur: Optional[float] = None


class PlayerPlaystylesResponse(BaseModel):
    player_id: int
    season: str
    playstyles: list[PlaystyleBadge] = []
    concerns: list[PlaystyleBadge] = []


class PlayerCardResponse(BaseModel):
    identity: PlayerIdentity
    season: str
    confidence: str
    best_role: Optional[str] = None
    face_stats: list[FaceStat] = []
    substats: list[SubStat] = []
    role_ratings: list[RoleRatingSummary] = []
    playstyles: list[PlaystyleBadge] = []
    concerns: list[PlaystyleBadge] = []
    market: Optional[MarketPanel] = None
    strengths: list[StrengthConcern] = []
    concerns_text: list[StrengthConcern] = []
    context: Optional[ContextPanel] = None
    data_sources: list[DataSource] = []
    last_updated: Optional[str] = None
    rating_version: Optional[str] = None
