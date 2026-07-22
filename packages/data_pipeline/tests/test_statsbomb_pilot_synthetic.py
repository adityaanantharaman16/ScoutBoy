from __future__ import annotations

import json

from data_pipeline.adapters.statsbomb_pilot import StatsBombPilotAdapter, derive_player_seasons


def _event(event_id, event_type, minute, **values):
    return {"id": event_id, "type": {"name": event_type}, "minute": minute, **values}


def _write_synthetic_snapshot(tmp_path):
    snapshot = tmp_path / "statsbomb"
    matches = snapshot / "matches" / "9"
    events = snapshot / "events"
    matches.mkdir(parents=True)
    events.mkdir()
    (matches / "281.json").write_text(json.dumps([{"match_id": 100}, {"match_id": 101}]))

    player = {"id": 1, "name": "Synthetic Winger"}
    replacement = {"id": 2, "name": "Synthetic Substitute"}
    team = {"name": "Synthetic FC"}
    possession = 7
    match_events = [
        _event(
            "lineup",
            "Starting XI",
            0,
            tactics={"lineup": [{"player": player}]},
        ),
        _event(
            "key-pass",
            "Pass",
            10,
            player=player,
            team=team,
            possession=possession,
            location=[50, 40],
            under_pressure=True,
            **{
                "pass": {
                    "end_location": [105, 40],
                    "goal_assist": True,
                    "shot_assist": True,
                    "cross": True,
                    "technique": {"name": "Through Ball"},
                }
            },
        ),
        _event(
            "carry",
            "Carry",
            11,
            player=player,
            team=team,
            possession=possession,
            location=[70, 40],
            carry={"end_location": [105, 40]},
        ),
        _event(
            "dribble",
            "Dribble",
            12,
            player=player,
            team=team,
            possession=possession,
            location=[105, 40],
            dribble={"outcome": {"name": "Complete"}},
        ),
        _event(
            "shot",
            "Shot",
            13,
            player=player,
            team=team,
            possession=possession,
            location=[110, 40],
            shot={
                "key_pass_id": "key-pass",
                "type": {"name": "Open Play"},
                "statsbomb_xg": 0.4,
                "outcome": {"name": "Goal"},
            },
        ),
        _event(
            "receipt",
            "Ball Receipt*",
            14,
            player=player,
            team=team,
            location=[104, 40],
        ),
        _event("miscontrol", "Miscontrol", 20, player=player, team=team),
        _event("dispossessed", "Dispossessed", 21, player=player, team=team),
        _event(
            "interception",
            "Interception",
            22,
            player=player,
            team=team,
            interception={"outcome": {"name": "Won"}},
        ),
        _event("block", "Block", 23, player=player, team=team),
        _event("recovery", "Ball Recovery", 24, player=player, team=team),
        _event("clearance", "Clearance", 25, player=player, team=team, aerial_won=True),
        _event(
            "pressure",
            "Pressure",
            26,
            player=player,
            team=team,
            counterpress=True,
        ),
        _event(
            "tackle",
            "Duel",
            27,
            player=player,
            team=team,
            duel={"type": {"name": "Tackle"}, "outcome": {"name": "Won"}},
        ),
        _event(
            "aerial-lost",
            "Duel",
            28,
            player=player,
            team=team,
            duel={"type": {"name": "Aerial Lost"}, "outcome": {"name": "Lost"}},
        ),
        _event(
            "substitution",
            "Substitution",
            60,
            player=player,
            substitution={"replacement": replacement},
        ),
        _event(
            "sub-pass",
            "Pass",
            65,
            player=replacement,
            team=team,
            location=[10, 10],
            **{"pass": {"end_location": [20, 10], "outcome": {"name": "Incomplete"}}},
        ),
        _event(
            "red-card",
            "Foul Committed",
            80,
            player=replacement,
            team=team,
            foul_committed={"card": {"name": "Red Card"}},
        ),
        _event("half-end", "Half End", 90),
    ]
    (events / "100.json").write_text(json.dumps(match_events))
    return snapshot


def test_synthetic_snapshot_exercises_event_metrics_without_gitignored_data(tmp_path):
    snapshot = _write_synthetic_snapshot(tmp_path)

    rows = derive_player_seasons(snapshot, 9, 281, "2023/2024")

    assert [(row["player_name"], row["minutes"]) for row in rows] == [
        ("Synthetic Winger", 60.0),
        ("Synthetic Substitute", 20.0),
    ]
    metrics = rows[0]["metrics"]
    assert metrics["non_penalty_goals_per90"] == 1.5
    assert metrics["non_penalty_xg_per90"] == 0.6
    assert metrics["pass_completion_pct"] == 100.0
    assert metrics["take_on_success_pct"] == 100.0
    assert metrics["ground_duels_won_pct"] == 100.0
    assert metrics["aerial_duels_won_pct"] == 50.0
    assert metrics["shot_creating_actions_per90"] == 3.0


def test_synthetic_snapshot_adapter_builds_canonical_metrics(tmp_path):
    snapshot = _write_synthetic_snapshot(tmp_path)

    bundle = StatsBombPilotAdapter(snapshot, min_minutes=30).fetch()

    assert bundle.source_name == "statsbomb"
    assert bundle.source_snapshot_id == "statsbomb@9-281"
    assert not bundle.players
    assert {metric.source_player_id for metric in bundle.metrics} == {"1"}
    assert any(metric.metric_name == "performance_covered_minutes" for metric in bundle.metrics)
    warnings = {item["check"]: item for item in bundle.adapter_warnings}
    assert warnings["statsbomb_identity_unmatched"]["count"] == 0
    assert warnings["statsbomb_identity_ambiguous"]["count"] == 0
    assert warnings["statsbomb_identity_matched"]["count"] == 0
