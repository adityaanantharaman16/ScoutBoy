"""ScoutBoy RoleFit rating engine (v1).

Config-driven, explainable role ratings + playstyles. Public surface:

    load_role_configs()          -> dict[role_key, RoleConfig]
    ContextConfig.load()         -> context multipliers config
    build_context(...)           -> ContextResult for a player-season
    compute_role_rating(...)     -> RoleRatingResult (raw, adjusted, final, audit)
    build_audit(result)          -> storable audit dict
    build_strengths_concerns(...)-> grounded strengths/concerns
    PlaystyleConfig.load()       -> playstyle/concern definitions
    compute_playstyles(...)      -> list[AppliedBadge]
    percentile_ranks(...)        -> peer-group goodness percentiles
"""

from __future__ import annotations

RATING_VERSION = "rolefit-v1"
PLAYSTYLE_VERSION = "playstyles-v1"

from .audit import build_audit, build_explanation_text, build_strengths_concerns
from .confidence import ConfidenceResult, compute_confidence
from .context_adjustments import ContextConfig, ContextResult, build_context
from .formula import RoleRatingResult, compute_role_rating
from .normalize import percentile_ranks, percentile_to_score, zscore_ranks
from .playstyles import AppliedBadge, PlaystyleConfig, compute_playstyles
from .role_weights import RoleConfig, RoleConfigError, load_role_config, load_role_configs

__all__ = [
    "RATING_VERSION",
    "PLAYSTYLE_VERSION",
    "build_audit",
    "build_explanation_text",
    "build_strengths_concerns",
    "ConfidenceResult",
    "compute_confidence",
    "ContextConfig",
    "ContextResult",
    "build_context",
    "RoleRatingResult",
    "compute_role_rating",
    "percentile_ranks",
    "percentile_to_score",
    "zscore_ranks",
    "AppliedBadge",
    "PlaystyleConfig",
    "compute_playstyles",
    "RoleConfig",
    "RoleConfigError",
    "load_role_config",
    "load_role_configs",
]
