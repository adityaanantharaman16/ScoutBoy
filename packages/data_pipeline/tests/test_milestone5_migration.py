from __future__ import annotations

from alembic import command
from alembic.config import Config
from app.core.config import get_settings
from rolefit.paths import repo_root
from sqlalchemy import create_engine, inspect


def _names(items: list[dict]) -> set[str]:
    return {item["name"] for item in items}


def test_sqlite_milestone5_head_downgrade_head_roundtrip(tmp_path, monkeypatch):
    root = repo_root()
    database_path = tmp_path / "migration-roundtrip.db"
    database_url = f"sqlite:///{database_path}"
    config = Config(str(root / "alembic.ini"))
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.delenv("SCOUTBOY_DATABASE_URL", raising=False)
    get_settings.cache_clear()

    try:
        command.upgrade(config, "head")
        command.downgrade(config, "0004_provider_agnostic_events")

        engine = create_engine(database_url)
        downgraded = inspect(engine)
        assert "quarantine_records" not in downgraded.get_table_names()
        assert {
            "provider",
            "ingestion_mode",
            "snapshot_fingerprint",
            "scope_json",
            "summary_json",
            "failure_details_json",
            "replay_of_run_id",
        }.isdisjoint(_names(downgraded.get_columns("rating_runs")))
        assert {
            "fingerprint",
            "scope_json",
            "source_type",
            "health_label",
            "known_limitation",
            "attribution",
        }.isdisjoint(_names(downgraded.get_columns("source_snapshots")))
        engine.dispose()

        command.upgrade(config, "head")

        engine = create_engine(database_url)
        restored = inspect(engine)
        assert "quarantine_records" in restored.get_table_names()
        assert {
            "provider",
            "ingestion_mode",
            "snapshot_fingerprint",
            "scope_json",
            "summary_json",
            "failure_details_json",
            "replay_of_run_id",
        }.issubset(_names(restored.get_columns("rating_runs")))
        assert {
            "fingerprint",
            "scope_json",
            "source_type",
            "health_label",
            "known_limitation",
            "attribution",
        }.issubset(_names(restored.get_columns("source_snapshots")))
        assert {
            "ix_rating_runs_provider",
            "ix_rating_runs_snapshot_fingerprint",
            "ix_rating_runs_replay_of_run_id",
            "ix_ingest_provider_fingerprint_status",
        }.issubset(_names(restored.get_indexes("rating_runs")))
        assert {
            "ix_source_snapshots_fingerprint",
            "ix_source_snapshots_health_label",
        }.issubset(_names(restored.get_indexes("source_snapshots")))
        assert {
            "ix_quarantine_records_ingestion_run_id",
            "ix_quarantine_records_provider",
            "ix_quarantine_records_snapshot_fingerprint",
            "ix_quarantine_records_status",
            "ix_quarantine_records_replay_run_id",
        }.issubset(_names(restored.get_indexes("quarantine_records")))
        assert "uq_quarantine_source_record" in _names(
            restored.get_unique_constraints("quarantine_records")
        )
        assert "ix_metric_normalized_player_season_metric" in _names(
            restored.get_indexes("player_metrics_normalized")
        )
        assert any(
            foreign_key["referred_table"] == "rating_runs"
            and foreign_key["constrained_columns"] == ["replay_of_run_id"]
            for foreign_key in restored.get_foreign_keys("rating_runs")
        )
        engine.dispose()
    finally:
        get_settings.cache_clear()
