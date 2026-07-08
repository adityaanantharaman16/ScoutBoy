from __future__ import annotations

import pytest
from rolefit import PlaystyleConfig, compute_playstyles


@pytest.fixture(scope="module")
def ps_config():
    return PlaystyleConfig.load()


def test_no_badge_when_required_metrics_missing(ps_config):
    # Elite everywhere, but drop the required metric for technical_carrier.
    perc = {
        m: 0.99
        for m in [
            "carries_into_final_third_per90",
            "take_on_success_pct",
        ]
    }
    badges = compute_playstyles(perc, position_group="ATT", minutes=2000, config=ps_config)
    assert not any(b.playstyle_key == "technical_carrier" for b in badges)


def test_no_badge_when_sample_too_small(ps_config):
    perc = {
        "progressive_carries_per90": 0.99,
        "carries_into_final_third_per90": 0.99,
        "take_on_success_pct": 0.99,
    }
    badges = compute_playstyles(perc, position_group="ATT", minutes=100, config=ps_config)
    assert not any(b.playstyle_key == "technical_carrier" and not b.is_concern for b in badges)


def test_tiering_base_plus_elite(ps_config):
    def carrier_tier(p):
        perc = {
            "progressive_carries_per90": p,
            "carries_into_final_third_per90": p,
            "take_on_success_pct": p,
        }
        badges = compute_playstyles(perc, position_group="ATT", minutes=2000, config=ps_config)
        b = next((b for b in badges if b.playstyle_key == "technical_carrier"), None)
        return b.tier if b else None

    assert carrier_tier(0.60) is None
    assert carrier_tier(0.80) == "base"
    assert carrier_tier(0.92) == "plus"
    assert carrier_tier(0.97) == "elite"


def test_badge_is_role_aware(ps_config):
    # interceptor is MID-only; an ATT with elite interception metrics gets no badge.
    perc = {"interceptions_per90": 0.99, "tackles_per90": 0.99}
    att = compute_playstyles(perc, position_group="ATT", minutes=2000, config=ps_config)
    mid = compute_playstyles(perc, position_group="MID", minutes=2000, config=ps_config)
    assert not any(b.playstyle_key == "interceptor" for b in att)
    assert any(b.playstyle_key == "interceptor" for b in mid)


def test_concern_low_percentile(ps_config):
    perc = {"goals_minus_xg_per90": 0.05, "non_penalty_xg_per90": 0.5, "shots_per90": 0.5}
    badges = compute_playstyles(perc, position_group="ATT", minutes=2000, config=ps_config)
    assert any(b.playstyle_key == "raw_finishing" and b.is_concern for b in badges)


def test_concern_small_sample_and_translation(ps_config):
    perc = {"progressive_carries_per90": 0.5}
    badges = compute_playstyles(
        perc, position_group="MID", minutes=300, config=ps_config, translation_risk="high"
    )
    keys = {b.playstyle_key for b in badges if b.is_concern}
    assert "small_sample" in keys
    assert "role_translation_risk" in keys


def test_concern_market_label(ps_config):
    badges = compute_playstyles(
        {"progressive_carries_per90": 0.5},
        position_group="MID",
        minutes=2000,
        config=ps_config,
        market_label="inflated",
    )
    assert any(b.playstyle_key == "inflated_market" and b.is_concern for b in badges)


def test_why_applied_present_on_positive_badge(ps_config):
    perc = {
        "progressive_carries_per90": 0.96,
        "carries_into_final_third_per90": 0.96,
        "take_on_success_pct": 0.96,
    }
    badges = compute_playstyles(perc, position_group="ATT", minutes=2000, config=ps_config)
    b = next(b for b in badges if b.playstyle_key == "technical_carrier")
    assert b.why_applied.get("text")
    assert b.supporting_metrics
