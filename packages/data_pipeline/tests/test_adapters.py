from __future__ import annotations

from data_pipeline.adapters import SampleAdapter, get_adapter
from data_pipeline.adapters.football_data_adapter import build_team_context
from data_pipeline.adapters.statsbomb_adapter import events_to_metrics
from data_pipeline.adapters.transfermarkt_adapter import map_player_row, map_valuation_row


def test_sample_adapter_produces_canonical_bundle():
    bundle = SampleAdapter().fetch()
    assert bundle.source_name == "sample"
    assert len(bundle.players) == 24
    assert bundle.competitions and bundle.teams and bundle.appearances
    # market inputs are emitted as metrics
    names = {m.metric_name for m in bundle.metrics}
    assert "public_value_eur" in names and "non_penalty_xg_per90" in names
    # no provider-specific fields leak: players carry canonical positions
    assert all(p.primary_position for p in bundle.players)


def test_get_adapter_unknown_raises():
    import pytest

    with pytest.raises(ValueError):
        get_adapter("nope")


def test_transfermarkt_player_mapping_normalizes_position():
    row = {
        "player_id": 12345,
        "name": "Test Player",
        "date_of_birth": "2003-01-01",
        "country_of_citizenship": "France",
        "foot": "right",
        "height_in_cm": "180",
        "sub_position": "Left Winger",
        "url": "http://x",
    }
    cp = map_player_row(row)
    assert cp.source_name == "transfermarkt"
    assert cp.source_player_id == "12345"
    assert cp.primary_position == "LW"
    assert cp.height_cm == 180


def test_transfermarkt_valuation_mapping():
    m = map_valuation_row(
        {"player_id": 1, "season": "2023", "market_value_in_eur": "5000000", "date": "2024-01-01"}
    )
    assert m and m.metric_name == "public_value_eur" and m.metric_value == 5_000_000.0
    assert map_valuation_row({"player_id": 1, "market_value_in_eur": None}) is None


def test_statsbomb_events_to_metrics():
    events = [
        {
            "type": {"name": "Shot"},
            "player": {"name": "A"},
            "shot": {"statsbomb_xg": 0.3, "type": {"name": "Open Play"}},
        },
        {
            "type": {"name": "Shot"},
            "player": {"name": "A"},
            "shot": {"statsbomb_xg": 0.9, "type": {"name": "Penalty"}},
        },  # excluded from npxg
        {"type": {"name": "Pass"}, "player": {"name": "A"}, "pass": {"shot_assist": True}},
        {"type": {"name": "Pressure"}, "player": {"name": "A"}},
        {"type": {"name": "Shot"}, "player": {"name": "B"}, "shot": {"statsbomb_xg": 0.5}},
    ]
    m = events_to_metrics(events, "A", minutes=90)
    assert m["shots_per90"] == 2.0
    assert m["non_penalty_xg_per90"] == 0.3  # penalty xg excluded
    assert m["key_passes_per90"] == 1.0
    assert m["pressures_per90"] == 1.0


def test_football_data_team_context():
    matches = [
        {"HomeTeam": "A", "AwayTeam": "B", "FTHG": 2, "FTAG": 0, "FTR": "H"},
        {"HomeTeam": "B", "AwayTeam": "A", "FTHG": 1, "FTAG": 1, "FTR": "D"},
    ]
    ctx = build_team_context(matches)
    assert ctx["A"]["points_per_game"] == 2.0  # win + draw over 2 games
    assert ctx["A"]["goal_difference"] == 2
