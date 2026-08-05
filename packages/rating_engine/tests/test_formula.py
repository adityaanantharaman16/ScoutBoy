from __future__ import annotations

import pytest
from rolefit import (
    ContextConfig,
    build_audit,
    build_context,
    compute_role_rating,
    load_role_configs,
)
from rolefit.context_adjustments import build_context as _bc
from scoutboy_shared import DISPLAY_SCALE_MAX, DISPLAY_SCALE_MIN


@pytest.fixture(scope="module")
def roles():
    return load_role_configs()


@pytest.fixture(scope="module")
def ctx_config():
    return ContextConfig.load()


def _rate(
    pid, role_key, roles, ctx_config, sample_percentiles, sample_meta, form_index, role_usage=1.0
):
    meta = sample_meta[pid]
    context = build_context(
        ctx_config,
        competition_slug=meta["competition_slug"],
        team_slug=meta["team_slug"],
        competition_type=meta["competition_type"],
        minutes=meta["minutes"],
        recent_form_index=form_index[pid],
        role_usage=role_usage,
    )
    return compute_role_rating(
        roles[role_key], sample_percentiles[pid], context, minutes=meta["minutes"]
    )


def test_final_score_in_display_range(
    roles, ctx_config, sample_percentiles, sample_meta, form_index
):
    for pid in sample_percentiles:
        pg = sample_meta[pid]["position_group"]
        for role in roles.values():
            if role.position_group != pg:
                continue
            res = _rate(
                pid, role.role_key, roles, ctx_config, sample_percentiles, sample_meta, form_index
            )
            assert DISPLAY_SCALE_MIN <= res.final_score <= DISPLAY_SCALE_MAX
            assert 0.0 <= res.raw_score <= 100.0


def test_archetype_scores_higher_in_matching_role(
    roles, ctx_config, sample_percentiles, sample_meta, form_index
):
    # A touchline_winger archetype should outscore a ball-winning midfielder in the
    # touchline_winger role (roles are ATT-only here, so pick two ATT archetypes).
    winger = next(p for p, m in sample_meta.items() if m["archetype"] == "touchline_winger")
    finisher = next(p for p, m in sample_meta.items() if m["archetype"] == "pressing_forward")
    w = _rate(
        winger, "touchline_winger", roles, ctx_config, sample_percentiles, sample_meta, form_index
    )
    f = _rate(
        finisher, "touchline_winger", roles, ctx_config, sample_percentiles, sample_meta, form_index
    )
    assert w.final_score > f.final_score


def test_context_multipliers_change_score(
    roles, ctx_config, sample_percentiles, sample_meta, form_index
):
    pid = next(p for p, m in sample_meta.items() if m["archetype"] == "inside_forward")
    perc = sample_percentiles[pid]
    strong = _bc(
        ctx_config,
        competition_slug="eng_premier_league",
        team_slug="man_city",
        competition_type="uefa_elite_knockout",
        minutes=1800,
        recent_form_index=None,
    )
    weak = _bc(
        ctx_config,
        competition_slug="fra_ligue_2",
        team_slug="saint_etienne",
        competition_type="domestic_second_tier",
        minutes=1800,
        recent_form_index=None,
    )
    s = compute_role_rating(roles["inside_forward"], perc, strong, minutes=1800)
    w = compute_role_rating(roles["inside_forward"], perc, weak, minutes=1800)
    assert s.context.combined_multiplier > w.context.combined_multiplier
    assert s.final_score > w.final_score
    # ...but weak-league production is NOT erased to zero
    assert w.final_score > 0.0


def test_low_minutes_lower_confidence(roles, ctx_config, sample_percentiles, sample_meta):
    pid = next(iter(sample_percentiles))
    role = roles["inside_forward" if sample_meta[pid]["position_group"] == "ATT" else "advanced_8"]
    perc = sample_percentiles[pid]
    hi_ctx = _bc(
        ctx_config,
        competition_slug="eng_premier_league",
        team_slug="arsenal",
        competition_type="domestic_top_tier",
        minutes=2400,
        recent_form_index=None,
    )
    lo_ctx = _bc(
        ctx_config,
        competition_slug="eng_premier_league",
        team_slug="arsenal",
        competition_type="domestic_top_tier",
        minutes=200,
        recent_form_index=None,
    )
    hi = compute_role_rating(role, perc, hi_ctx, minutes=2400)
    lo = compute_role_rating(role, perc, lo_ctx, minutes=200)
    assert lo.confidence.score < hi.confidence.score
    assert lo.confidence.score <= 0.4  # capped below the minutes threshold


def test_missing_required_metric_is_not_zeroed(
    roles, ctx_config, sample_percentiles, sample_meta, form_index
):
    pid = next(p for p, m in sample_meta.items() if m["position_group"] == "ATT")
    perc = dict(sample_percentiles[pid])
    # drop every required metric for the role
    role = roles["inside_forward"]
    for m in role.required_metrics:
        perc.pop(m, None)
    ctx = build_context(
        ctx_config,
        competition_slug="eng_premier_league",
        team_slug="arsenal",
        competition_type="domestic_top_tier",
        minutes=1800,
        recent_form_index=None,
    )
    res = compute_role_rating(role, perc, ctx, minutes=1800)
    # score still computed from remaining metrics (not forced to zero), but confidence drops
    assert res.confidence.missing_required
    assert res.confidence.level.value in {"unknown", "low"}


def test_audit_contains_all_breakdowns(
    roles, ctx_config, sample_percentiles, sample_meta, form_index
):
    pid = next(iter(sample_percentiles))
    pg = sample_meta[pid]["position_group"]
    role_key = "inside_forward" if pg == "ATT" else "advanced_8"
    res = _rate(pid, role_key, roles, ctx_config, sample_percentiles, sample_meta, form_index)
    audit = build_audit(res)
    assert set(audit) == {
        "metric_breakdown_json",
        "context_breakdown_json",
        "confidence_breakdown_json",
        "penalties_json",
        "explanation_text",
    }
    assert audit["metric_breakdown_json"]["groups"]
    assert "multipliers" in audit["context_breakdown_json"]
    assert "score" in audit["confidence_breakdown_json"]
    assert isinstance(audit["explanation_text"], str) and audit["explanation_text"]


# ---------------------------------------------------------------------------
# The 0-99 scale is a clamp in the engine, not a display convention
# ---------------------------------------------------------------------------
def test_shared_scale_bounds_are_exactly_zero_and_ninety_nine():
    assert DISPLAY_SCALE_MIN == 0.0
    assert DISPLAY_SCALE_MAX == 99.0


def _flat_role(roles):
    """Any role, used purely as a weight/metric shape for the clamp cases."""
    return roles["inside_forward"]


def _clamped(role, goodness, ctx_config, multiplier_slugs):
    """Score `role` with every metric pinned to one goodness value."""
    metrics = {m.name for g in role.groups for m in g.metrics}
    ctx = _bc(
        ctx_config,
        competition_slug=multiplier_slugs[0],
        team_slug=multiplier_slugs[1],
        competition_type="domestic_top_tier",
        minutes=3000,
        recent_form_index=1.0,
    )
    return compute_role_rating(role, {m: goodness for m in metrics}, ctx, minutes=3000)


def test_upper_clamp_is_exactly_ninety_nine(roles, ctx_config):
    """A perfect profile in the strongest available context cannot exceed 99.

    The pre-clamp figure is asserted separately, so this proves the cap is doing the
    work rather than the inputs happening to stay low.
    """
    role = _flat_role(roles)
    res = _clamped(role, 1.0, ctx_config, ("eng_premier_league", "arsenal"))
    assert res.context_adjusted_score + res.context.form_bonus - res.penalties_total > 99.0
    assert res.final_score == 99.0


def test_lower_clamp_is_exactly_zero(roles, ctx_config):
    """A bottom-tail profile is floored at 0, never pushed negative by penalties."""
    role = _flat_role(roles)
    res = _clamped(role, 0.0, ctx_config, ("ger_2_bundesliga", "unknown_team"))
    assert res.penalties_total > 0
    assert res.context_adjusted_score + res.context.form_bonus - res.penalties_total < 0.0
    assert res.final_score == 0.0


def test_every_role_and_fixture_stays_inside_the_clamped_scale(
    roles, ctx_config, sample_percentiles, sample_meta, form_index
):
    for pid in sample_percentiles:
        pg = sample_meta[pid]["position_group"]
        for role in roles.values():
            if role.position_group != pg:
                continue
            res = _rate(
                pid, role.role_key, roles, ctx_config, sample_percentiles, sample_meta, form_index
            )
            assert DISPLAY_SCALE_MIN <= res.final_score <= DISPLAY_SCALE_MAX
            # nothing in the 99.0-99.9 band the old cap allowed
            assert res.final_score <= 99.0
