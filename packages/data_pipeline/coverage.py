from __future__ import annotations

from datetime import date
from typing import Optional


def confidence_state(score: float) -> str:
    if score <= 0:
        return "insufficient data"
    if score < 0.5:
        return "low"
    if score < 0.8:
        return "medium"
    return "high"


def sample_confidence(minutes: int) -> str:
    if minutes <= 0:
        return "insufficient data"
    if minutes < 450:
        return "low"
    if minutes < 900:
        return "medium"
    return "high"


def coverage_confidence(coverage_pct: Optional[float], matches_covered: int) -> str:
    if matches_covered <= 0:
        return "insufficient data"
    if coverage_pct is None:
        return "low"
    if coverage_pct < 0.4:
        return "low"
    if coverage_pct < 0.8:
        return "medium"
    return "high"


def role_similarity_confidence(minutes: int, metric_count: int) -> str:
    if minutes <= 0 or metric_count <= 0:
        return "insufficient data"
    if minutes < 450 or metric_count < 8:
        return "low"
    if minutes < 900 or metric_count < 16:
        return "medium"
    return "high"


_RANK = {"insufficient data": 0, "unknown": 0, "low": 1, "medium": 2, "high": 3}
_STATE = {0: "insufficient data", 1: "low", 2: "medium", 3: "high"}


def weakest_confidence(*states: str) -> str:
    if not states:
        return "insufficient data"
    return _STATE[min(_RANK.get(s, 0) for s in states)]


def recency_days(last_match_date: Optional[date], as_of_date: Optional[date]) -> Optional[int]:
    if not last_match_date or not as_of_date:
        return None
    return max(0, (as_of_date - last_match_date).days)
