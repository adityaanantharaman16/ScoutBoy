from __future__ import annotations

import csv
from pathlib import Path

import pytest
from app.models.orm import SourceSnapshot
from data_pipeline.adapters import StatsBombPilotAdapter, TransfermarktAdapter
from data_pipeline.adapters.statsbomb_pilot import derive_player_seasons
from data_pipeline.jobs.ingest import ingest_bundle
from rolefit.paths import repo_root
from sqlalchemy import func, select


def _write_csv(path: Path, rows: list[dict]) -> None:
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def test_real_dcaribou_schema_aggregates_matches_and_uses_as_of_value(tmp_path):
    _write_csv(
        tmp_path / "competitions.csv",
        [
            {
                "competition_id": "L1",
                "name": "Bundesliga",
                "country_name": "Germany",
                "confederation": "europa",
            }
        ],
    )
    _write_csv(
        tmp_path / "clubs.csv",
        [
            {
                "club_id": "1",
                "club_code": "test-club",
                "name": "Test Club",
                "domestic_competition_id": "L1",
            }
        ],
    )
    _write_csv(
        tmp_path / "games.csv",
        [
            {
                "game_id": "10",
                "competition_id": "L1",
                "season": "2023",
                "home_club_id": "1",
                "away_club_id": "1",
                "home_club_goals": "1",
                "away_club_goals": "1",
            }
        ],
    )
    _write_csv(
        tmp_path / "appearances.csv",
        [
            {
                "appearance_id": "a",
                "game_id": "10",
                "player_id": "7",
                "player_club_id": "1",
                "minutes_played": "73",
            }
        ],
    )
    _write_csv(
        tmp_path / "players.csv",
        [
            {
                "player_id": "7",
                "name": "Pilot Player",
                "date_of_birth": "2002-01-01",
                "country_of_citizenship": "Germany",
                "sub_position": "Attacking Midfield",
                "position": "Midfield",
                "foot": "right",
                "height_in_cm": "180",
                "url": "https://example.test/7",
            }
        ],
    )
    _write_csv(
        tmp_path / "player_valuations.csv",
        [
            {"player_id": "7", "date": "2024-06-01", "market_value_in_eur": "10000000"},
            {"player_id": "7", "date": "2024-07-01", "market_value_in_eur": "20000000"},
        ],
    )
    bundle = TransfermarktAdapter(csv_dir=tmp_path).fetch()
    assert bundle.appearances[0].minutes == 73
    assert bundle.appearances[0].position_group == "MID"
    values = [m for m in bundle.metrics if m.metric_name == "public_value_eur"]
    assert len(values) == 1 and values[0].metric_value == 10_000_000
    assert values[0].raw_payload["date"] == "2024-06-01"


def test_ingest_persists_snapshot_provenance(fresh_sessions, tm_dir):
    SessionLocal, _ = fresh_sessions
    with SessionLocal() as session:
        ingest_bundle(session, TransfermarktAdapter(csv_dir=tm_dir).fetch())
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(SourceSnapshot)) == 1


def test_pinned_statsbomb_snapshot_derives_real_event_metrics():
    snapshot = repo_root() / "data/raw/statsbomb"
    if not snapshot.exists():
        pytest.skip("local immutable StatsBomb snapshot is intentionally gitignored")
    rows = derive_player_seasons(snapshot, 9, 281, "2023/2024")
    assert len(rows) >= 300
    wirtz = next(row for row in rows if row["player_name"] == "Florian Wirtz")
    assert wirtz["minutes"] >= 2400
    assert wirtz["metrics"]["progressive_carries_per90"] > 0


def test_statsbomb_identity_bridge_keeps_unresolved_rows_quarantined():
    root = repo_root()
    if not (root / "data/raw/statsbomb").exists() or not (root / "data/raw/transfermarkt").exists():
        pytest.skip("local immutable pilot snapshots are intentionally gitignored")
    bundle = StatsBombPilotAdapter(
        root / "data/raw/statsbomb",
        transfermarkt_dir=root / "data/raw/transfermarkt",
        overrides_path=root / "configs/identity/statsbomb_transfermarkt_overrides_v1.yaml",
    ).fetch()
    checks = {item["check"]: item for item in bundle.adapter_warnings}
    assert checks["statsbomb_identity_matched"]["count"] >= 300
    assert checks["statsbomb_identity_unmatched"]["count"] > 0
    assert any(m.metric_name == "performance_covered_minutes" for m in bundle.metrics)
