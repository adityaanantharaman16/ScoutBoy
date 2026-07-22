from __future__ import annotations

import json
from datetime import date

from app.models.orm import DataCoverage, Event, Match, PlayerEvidenceConfidence
from data_pipeline.adapters.statsbomb_open_data import StatsBombOpenDataAdapter
from data_pipeline.coverage import (
    coverage_confidence,
    role_similarity_confidence,
    sample_confidence,
    weakest_confidence,
)
from data_pipeline.jobs.ingest import ingest_bundle
from data_pipeline.provider_contract import validate_adapter
from sqlalchemy import func, select


def _write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


def _competition_row(season_id: int, season_name: str) -> dict:
    return {
        "competition_id": 9,
        "season_id": season_id,
        "country_name": "Germany",
        "competition_name": "1. Bundesliga",
        "competition_gender": "male",
        "competition_youth": False,
        "competition_international": False,
        "season_name": season_name,
        "match_updated": "2024-07-01T00:00:00",
        "match_available": "2024-07-01T00:00:00",
        "match_available_360": None,
        "match_updated_360": None,
    }


def _match(match_id: int, match_date: str) -> dict:
    return {
        "match_id": match_id,
        "match_date": match_date,
        "competition": {
            "competition_id": 9,
            "country_name": "Germany",
            "competition_name": "1. Bundesliga",
        },
        "season": {"season_id": 281, "season_name": "2023/2024"},
        "home_team": {
            "home_team_id": 1,
            "home_team_name": "Home FC",
            "country": {"name": "Germany"},
        },
        "away_team": {
            "away_team_id": 2,
            "away_team_name": "Away FC",
            "country": {"name": "Germany"},
        },
        "home_score": 1,
        "away_score": 0,
        "match_status": "available",
        "match_status_360": None,
        "last_updated": "2024-07-01T00:00:00",
        "last_updated_360": None,
        "metadata": {"data_version": "1.1.0"},
        "match_week": 1,
        "competition_stage": {"id": 1, "name": "Regular Season"},
    }


def _lineup() -> list[dict]:
    return [
        {
            "team_id": 1,
            "team_name": "Home FC",
            "lineup": [
                {
                    "player_id": 10,
                    "player_name": "Test Forward",
                    "jersey_number": 9,
                    "country": {"name": "France"},
                    "cards": [],
                    "positions": [
                        {
                            "position_id": 23,
                            "position": "Center Forward",
                            "from": "00:00",
                            "to": None,
                            "from_period": 1,
                            "to_period": None,
                            "start_reason": "Starting XI",
                            "end_reason": "Final Whistle",
                        }
                    ],
                }
            ],
        }
    ]


def _events() -> list[dict]:
    return [
        {
            "id": "start",
            "index": 1,
            "period": 1,
            "timestamp": "00:00:00.000",
            "minute": 0,
            "second": 0,
            "type": {"name": "Starting XI"},
            "possession": 1,
            "team": {"id": 1, "name": "Home FC"},
            "tactics": {
                "lineup": [
                    {
                        "player": {"id": 10, "name": "Test Forward"},
                        "position": {"id": 23, "name": "Center Forward"},
                        "jersey_number": 9,
                    }
                ]
            },
        },
        {
            "id": "pass-1",
            "type": {"name": "Pass"},
            "player": {"id": 10, "name": "Test Forward"},
            "team": {"id": 1, "name": "Home FC"},
            "minute": 5,
            "second": 0,
            "possession": 2,
            "location": [50, 40],
            "pass": {"end_location": [85, 40]},
        },
        {
            "id": "carry-1",
            "type": {"name": "Carry"},
            "player": {"id": 10, "name": "Test Forward"},
            "team": {"id": 1, "name": "Home FC"},
            "minute": 7,
            "second": 0,
            "possession": 3,
            "location": [70, 40],
            "carry": {"end_location": [90, 40]},
        },
        {
            "id": "shot-1",
            "type": {"name": "Shot"},
            "player": {"id": 10, "name": "Test Forward"},
            "team": {"id": 1, "name": "Home FC"},
            "minute": 8,
            "second": 0,
            "possession": 3,
            "location": [108, 40],
            "shot": {
                "statsbomb_xg": 0.2,
                "type": {"name": "Open Play"},
                "outcome": {"name": "Saved"},
            },
        },
        {
            "id": "half-end",
            "type": {"name": "Half End"},
            "minute": 90,
            "second": 0,
            "possession": 4,
            "team": {"id": 1, "name": "Home FC"},
        },
    ]


def _fixture(root, *, missing_optional=False):
    _write_json(
        root / "competitions.json",
        [
            _competition_row(1, "2021/2022"),
            _competition_row(2, "2022/2023"),
            _competition_row(281, "2023/2024"),
        ],
    )
    _write_json(root / "matches" / "9" / "1.json", [_match(1001, "2022-05-01")])
    _write_json(root / "matches" / "9" / "2.json", [_match(1002, "2023-05-01")])
    _write_json(root / "matches" / "9" / "281.json", [_match(1003, "2024-05-01")])
    for match_id in (1002, 1003):
        if missing_optional and match_id == 1002:
            continue
        _write_json(root / "events" / f"{match_id}.json", _events())
        _write_json(root / "lineups" / f"{match_id}.json", _lineup())


def test_confidence_components_are_deterministic():
    assert sample_confidence(0) == "insufficient data"
    assert sample_confidence(449) == "low"
    assert sample_confidence(450) == "medium"
    assert sample_confidence(900) == "high"
    assert coverage_confidence(None, 3) == "low"
    assert coverage_confidence(0.85, 3) == "high"
    assert role_similarity_confidence(900, 16) == "high"
    assert weakest_confidence("high", "medium", "low") == "low"


def test_statsbomb_recent_seasons_use_match_dates(tmp_path):
    _fixture(tmp_path)
    adapter = StatsBombOpenDataAdapter(tmp_path, competition_ids=[9], recent_seasons=2)
    bundle = adapter.fetch()
    conformance = validate_adapter(adapter, bundle)
    assert conformance["valid"] is True, conformance
    assert {s.label for s in bundle.seasons} == {"2022/2023", "2023/2024"}
    assert len(bundle.matches) == 2
    assert bundle.coverages[0].matches_covered == 1
    assert any(m.metric_name == "progressive_passes_per90" for m in bundle.metrics)


def test_statsbomb_missing_optional_files_warn_without_failing(tmp_path):
    _fixture(tmp_path, missing_optional=True)
    bundle = StatsBombOpenDataAdapter(tmp_path, competition_ids=[9], recent_seasons=2).fetch()
    warning_names = {w["check"] for w in bundle.adapter_warnings if w["severity"] == "warn"}
    assert "statsbomb_events_file_missing" in warning_names
    assert "statsbomb_lineups_file_missing" in warning_names
    assert len(bundle.matches) == 2


def test_statsbomb_ingest_is_idempotent(fresh_sessions, tmp_path):
    _fixture(tmp_path)
    sessions, _engine = fresh_sessions
    bundle = StatsBombOpenDataAdapter(
        tmp_path,
        competition_ids=[9],
        season_ids=[281],
        recent_seasons=None,
        as_of_date=date(2024, 6, 30),
    ).fetch()
    with sessions() as session:
        first = ingest_bundle(session, bundle)
        second = ingest_bundle(session, bundle)
        assert first["players"] == 1
        assert second["players"] == 0
        assert second["status"] == "skipped_idempotent"
        assert session.scalar(select(func.count(Match.id))) == 1
        assert session.scalar(select(func.count(Event.id))) == len(bundle.events)
        assert session.scalar(select(func.count(DataCoverage.id))) == 1
        assert session.scalar(select(func.count(PlayerEvidenceConfidence.id))) == 1
