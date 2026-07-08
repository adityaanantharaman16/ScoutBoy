from __future__ import annotations

from enum import Enum


class ConfidenceLevel(str, Enum):
    """Ordered confidence levels. UNKNOWN is used when there is no usable data —
    it must never be silently coerced to a numeric score of zero."""

    UNKNOWN = "unknown"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


_ORDER = {
    ConfidenceLevel.UNKNOWN: 0,
    ConfidenceLevel.LOW: 1,
    ConfidenceLevel.MEDIUM: 2,
    ConfidenceLevel.HIGH: 3,
}
_BY_RANK = {v: k for k, v in _ORDER.items()}


def confidence_from_score(score: float) -> ConfidenceLevel:
    """Map a 0..1 confidence score to a level. Thresholds are intentionally simple
    and explainable."""
    if score <= 0.0:
        return ConfidenceLevel.UNKNOWN
    if score < 0.5:
        return ConfidenceLevel.LOW
    if score < 0.8:
        return ConfidenceLevel.MEDIUM
    return ConfidenceLevel.HIGH


def label_for_confidence(level: ConfidenceLevel) -> str:
    return {
        ConfidenceLevel.UNKNOWN: "Unknown — insufficient data",
        ConfidenceLevel.LOW: "Low confidence",
        ConfidenceLevel.MEDIUM: "Medium confidence",
        ConfidenceLevel.HIGH: "High confidence",
    }[level]


def blend_confidence(*levels: ConfidenceLevel) -> ConfidenceLevel:
    """Combine confidence levels by taking the weakest present (the chain is only as
    strong as its least-certain link). Empty input -> UNKNOWN."""
    if not levels:
        return ConfidenceLevel.UNKNOWN
    return _BY_RANK[min(_ORDER[level] for level in levels)]
