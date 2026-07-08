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
            assert 0.0 <= res.final_score <= 99.9
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
