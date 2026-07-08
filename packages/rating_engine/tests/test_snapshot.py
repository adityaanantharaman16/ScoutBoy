"""Snapshot regression test (US-3.11): known benchmark players must not shift
unexpectedly after formula/pipeline changes."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from rolefit import ContextConfig, build_context, compute_role_rating, load_role_configs

SNAPSHOT = Path(__file__).with_name("benchmark_snapshot.json")
TOLERANCE = 0.2


@pytest.fixture(scope="module")
def snapshot():
    return json.loads(SNAPSHOT.read_text())


def _best_role(pid, roles, ctx_config, percentiles, meta, form_index):
    m = meta[pid]
    ctx = build_context(
        ctx_config,
        competition_slug=m["competition_slug"],
        team_slug=m["team_slug"],
        competition_type=m["competition_type"],
        minutes=m["minutes"],
        recent_form_index=form_index[pid],
    )
    results = [
        compute_role_rating(role, percentiles[pid], ctx, minutes=m["minutes"])
        for role in roles.values()
        if role.position_group == m["position_group"]
    ]
    results.sort(key=lambda r: (r.final_score, r.role_key), reverse=True)
    return results[0]


def test_benchmark_players_are_stable(snapshot, sample_percentiles, sample_meta, form_index):
    roles = load_role_configs()
    ctx_config = ContextConfig.load()
    for pid, expected in snapshot["players"].items():
        best = _best_role(pid, roles, ctx_config, sample_percentiles, sample_meta, form_index)
        assert (
            best.role_key == expected["best_role"]
        ), f"{pid}: best role {best.role_key} != {expected['best_role']}"
        assert (
            abs(best.final_score - expected["final_score"]) <= TOLERANCE
        ), f"{pid}: {best.final_score} vs snapshot {expected['final_score']}"
