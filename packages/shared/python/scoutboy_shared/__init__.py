"""Shared, framework-free constants and metric metadata for ScoutBoy.

This package is the single source of truth for the canonical metric vocabulary,
position groups, face-stat groupings, and confidence labels. The rating engine,
market model, data pipeline, and API all import from here so no module invents its
own metric names. The TypeScript mirror lives in packages/shared/typescript.
"""

from __future__ import annotations

from .confidence import (
    ConfidenceLevel,
    blend_confidence,
    confidence_from_score,
    label_for_confidence,
)
from .constants import (
    DEFAULT_MIN_MINUTES,
    DISPLAY_SCALE_MAX,
    MVP_UNIVERSE_KEY,
    POSITION_GROUPS,
    POSITIONS,
    position_group_for,
)
from .metrics import (
    ALIASES,
    FACE_STAT_GROUPS,
    METRIC_REGISTRY,
    PERFORMANCE_METRICS,
    MetricMeta,
    is_higher_better,
    is_performance_metric,
    metric_meta,
    resolve_metric,
)

__all__ = [
    "ConfidenceLevel",
    "blend_confidence",
    "confidence_from_score",
    "label_for_confidence",
    "DEFAULT_MIN_MINUTES",
    "DISPLAY_SCALE_MAX",
    "MVP_UNIVERSE_KEY",
    "POSITION_GROUPS",
    "POSITIONS",
    "position_group_for",
    "FACE_STAT_GROUPS",
    "METRIC_REGISTRY",
    "PERFORMANCE_METRICS",
    "ALIASES",
    "MetricMeta",
    "is_higher_better",
    "is_performance_metric",
    "metric_meta",
    "resolve_metric",
]
