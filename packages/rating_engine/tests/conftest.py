"""Shared fixtures for rating-engine + playstyle tests.

Loads the synthetic sample fixtures and computes peer-group (position_group) goodness
percentiles the same way the production pipeline does, so engine tests run against
realistic, deterministic inputs without needing a database.
"""

from __future__ import annotations

import csv
import json

import pytest
from rolefit import percentile_ranks
from rolefit.paths import repo_root
from scoutboy_shared import METRIC_REGISTRY, is_higher_better


def _load_raw():
    root = repo_root()
    with open(root / "data" / "sample" / "players.json") as f:
        players = json.load(f)["players"]
    metrics: dict[str, dict[str, float]] = {}
    with open(root / "data" / "sample" / "sample_metrics.csv") as f:
        for row in csv.DictReader(f):
            pid = row["source_player_id"]
            metrics.setdefault(pid, {})[row["metric_name"]] = float(row["metric_value"])
    return players, metrics


@pytest.fixture(scope="session")
def sample_players():
    players, _ = _load_raw()
    return {p["source_player_id"]: p for p in players}


@pytest.fixture(scope="session")
def sample_meta(sample_players):
    meta = {}
    for pid, p in sample_players.items():
        meta[pid] = {
            "position_group": p["position_group"],
            "minutes": p["minutes"],
            "competition_slug": p["competition_slug"],
            "team_slug": p["club_slug"],
            "competition_type": "domestic_top_tier",
            "archetype": p["archetype_hint"],
        }
    return meta


@pytest.fixture(scope="session")
def sample_percentiles(sample_players):
    """player_id -> {metric_name: goodness_percentile 0..1} within its position group."""
    _, metrics = _load_raw()
    # group players by position group
    groups: dict[str, list[str]] = {}
    for pid, p in sample_players.items():
        groups.setdefault(p["position_group"], []).append(pid)

    out: dict[str, dict[str, float]] = {pid: {} for pid in sample_players}
    for _pg, pids in groups.items():
        for metric_name in METRIC_REGISTRY:
            values = {pid: metrics.get(pid, {}).get(metric_name) for pid in pids}
            ranks = percentile_ranks(values, higher_better=is_higher_better(metric_name))
            for pid, r in ranks.items():
                if r is not None:
                    out[pid][metric_name] = r
    return out


@pytest.fixture(scope="session")
def form_index(sample_players):
    _, metrics = _load_raw()
    return {pid: metrics.get(pid, {}).get("recent_form_index") for pid in sample_players}
