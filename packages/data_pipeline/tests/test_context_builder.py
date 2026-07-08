from __future__ import annotations

import pytest
from data_pipeline.normalize.context_builder import build_player_context
from rolefit import ContextConfig


@pytest.fixture(scope="module")
def cfg():
    return ContextConfig.load()


def test_league_strength_applied(cfg):
    strong = build_player_context(
        cfg,
        competition_slug="eng_premier_league",
        competition_type="domestic_top_tier",
        team_slug="man_city",
        minutes=2000,
        recent_form_index=None,
    )
    weak = build_player_context(
        cfg,
        competition_slug="fra_ligue_2",
        competition_type="domestic_second_tier",
        team_slug="saint_etienne",
        minutes=2000,
        recent_form_index=None,
    )
    assert strong.multipliers["league_strength"] > weak.multipliers["league_strength"]


def test_sample_reliability_scales_with_minutes(cfg):
    low = build_player_context(
        cfg,
        competition_slug="eng_premier_league",
        competition_type="domestic_top_tier",
        team_slug="arsenal",
        minutes=200,
        recent_form_index=None,
    )
    high = build_player_context(
        cfg,
        competition_slug="eng_premier_league",
        competition_type="domestic_top_tier",
        team_slug="arsenal",
        minutes=2500,
        recent_form_index=None,
    )
    assert high.multipliers["sample_reliability"] >= low.multipliers["sample_reliability"]
    assert low.sample_confidence in ("low", "unknown")
    assert high.sample_confidence == "high"


def test_unknown_league_falls_back_gracefully(cfg):
    unk = build_player_context(
        cfg,
        competition_slug="zz_unknown_league",
        competition_type="domestic_top_tier",
        team_slug="mystery_fc",
        minutes=1800,
        recent_form_index=None,
    )
    # uses the config default and flags higher translation risk rather than crashing
    assert unk.multipliers["league_strength"] == cfg.league["default"]["multiplier"]
    assert unk.translation_risk == cfg.league["default"]["translation_risk"]
