"""Bridge DB entities → rating-engine context inputs.

Thin translation layer so the recompute job stays readable: it maps a player-season's
competition/team/minutes/form into a ContextResult via the config-driven engine."""

from __future__ import annotations

from typing import Optional

from rolefit import ContextConfig, ContextResult, build_context


def build_player_context(
    config: ContextConfig,
    *,
    competition_slug: Optional[str],
    competition_type: Optional[str],
    team_slug: Optional[str],
    minutes: int,
    recent_form_index: Optional[float],
    role_usage: float = 1.0,
    team_tier: Optional[str] = None,
) -> ContextResult:
    return build_context(
        config,
        competition_slug=competition_slug,
        team_slug=team_slug,
        competition_type=competition_type,
        minutes=minutes,
        recent_form_index=recent_form_index,
        role_usage=role_usage,
        team_tier=team_tier,
    )
