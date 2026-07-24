"""Production-context tests for the recent-form bonus gating (Milestone 6 correction).

The form bonus must honor ``form_bonus.requires_confidence`` in
``configs/context/sample_reliability_v1.yaml``: zero below the confidence floor, positive but
capped at ``max_points`` at/above it. This is intentional context behavior, verified directly
on the production ``ContextConfig`` — the evaluator must not duplicate this gating.
"""

from __future__ import annotations

import pytest
from rolefit import ContextConfig, build_context


@pytest.fixture(scope="module")
def ctx_config():
    return ContextConfig.load()


def test_requires_confidence_is_medium(ctx_config):
    cfg = ctx_config.sample["form_bonus"]
    assert cfg["requires_confidence"] == "medium"
    assert float(cfg["max_points"]) == 2.0


def test_form_bonus_zero_when_form_missing(ctx_config):
    assert ctx_config.form_bonus_points(None, "high") == 0.0


def test_form_bonus_zero_below_confidence_floor(ctx_config):
    # low / unknown confidence is below the configured 'medium' floor -> exactly zero
    assert ctx_config.form_bonus_points(0.9, "low") == 0.0
    assert ctx_config.form_bonus_points(0.9, "unknown") == 0.0


def test_form_bonus_positive_at_or_above_floor_and_capped(ctx_config):
    med = ctx_config.form_bonus_points(0.9, "medium")
    high = ctx_config.form_bonus_points(0.9, "high")
    assert med > 0.0 and high > 0.0
    assert med == high  # gating is a floor, not a scale — equal above the floor
    # capped at max_points even for an out-of-range form index
    assert ctx_config.form_bonus_points(5.0, "high") == 2.0


def test_build_context_gates_form_by_minutes(ctx_config):
    """Below the reliability floor (small sample) the built context carries a zero form bonus."""
    small = build_context(
        ctx_config,
        competition_slug="eng_premier_league",
        team_slug="arsenal",
        competition_type="domestic_top_tier",
        minutes=200,  # -> low sample confidence
        recent_form_index=0.9,
    )
    reliable = build_context(
        ctx_config,
        competition_slug="eng_premier_league",
        team_slug="arsenal",
        competition_type="domestic_top_tier",
        minutes=2000,  # -> high sample confidence
        recent_form_index=0.9,
    )
    assert small.form_bonus == 0.0
    assert 0.0 < reliable.form_bonus <= 2.0
