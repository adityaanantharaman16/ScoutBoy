from __future__ import annotations

import pytest
from rolefit import RoleConfigError, load_role_configs
from rolefit.context_adjustments import ContextConfig
from rolefit.playstyles import PlaystyleConfig

EXPECTED_ROLES = {
    "touchline_winger",
    "inside_forward",
    "shadow_striker",
    "pressing_forward",
    "complete_forward",
    "deep_lying_playmaker",
    "advanced_8",
    "ball_winning_midfielder",
    "tempo_controller",
}


def test_role_configs_load_and_cover_mvp_roles():
    configs = load_role_configs()
    assert EXPECTED_ROLES.issubset(set(configs))


def test_role_group_weights_sum_to_one():
    for role in load_role_configs().values():
        total = sum(g.weight for g in role.groups)
        assert abs(total - 1.0) < 0.01, f"{role.role_key} weights sum to {total}"


def test_role_config_hash_is_stable_and_present():
    configs = load_role_configs()
    for role in configs.values():
        assert role.config_hash
        assert len(role.config_hash) == 16


def test_bad_metric_name_raises(tmp_path):
    bad = tmp_path / "bad.yaml"
    bad.write_text(
        "role_key: bad\ndisplay_name: Bad\nposition_group: ATT\n"
        "metric_groups:\n  g:\n    weight: 1.0\n    metrics:\n"
        "      - {name: not_a_real_metric, direction: higher_better}\n"
    )
    from rolefit.role_weights import load_role_config

    with pytest.raises(RoleConfigError):
        load_role_config(bad)


def test_every_config_metric_is_in_canonical_registry():
    """Fail loudly (US: canonical registry) if any role/playstyle config references a
    metric that does not resolve in configs/metrics/canonical_metrics_v1.yaml."""
    from scoutboy_shared import resolve_metric

    for role in load_role_configs().values():
        for group in role.groups:
            for m in group.metrics:
                assert resolve_metric(m.name), f"{role.role_key}: unknown metric {m.name}"
        for rule in role.concern_rules:
            assert resolve_metric(
                rule.metric
            ), f"{role.role_key}: unknown concern metric {rule.metric}"

    ps = PlaystyleConfig.load()
    for item in [*ps.positives, *ps.concerns]:
        for m in item.get("metrics", []):
            assert resolve_metric(m["name"]), f"{item['key']}: unknown metric {m['name']}"


def test_context_and_playstyle_configs_load():
    ctx = ContextConfig.load()
    assert ctx.config_hash
    assert "eng_premier_league" in ctx.league["leagues"]

    ps = PlaystyleConfig.load()
    assert ps.version == "v1"
    keys = {p["key"] for p in ps.positives}
    assert "technical_carrier" in keys and "line_breaker" in keys
    concern_keys = {c["key"] for c in ps.concerns}
    assert {"raw_finishing", "small_sample", "role_translation_risk"}.issubset(concern_keys)
