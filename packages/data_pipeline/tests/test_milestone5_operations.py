from __future__ import annotations

import csv
from copy import deepcopy
from datetime import date

import pytest
from app.models.orm import (
    Appearance,
    DataQualityReport,
    Player,
    PlayerMetricRaw,
    PlayerSourceId,
    QuarantineRecord,
    RatingRun,
    SourceSnapshot,
)
from data_pipeline.adapters import (
    GeneratedFixtureAdapter,
    MockCommercialProviderAdapter,
    PerformanceCsvAdapter,
    SampleAdapter,
    provider_capabilities,
)
from data_pipeline.adapters.base import CanonicalPlayer
from data_pipeline.jobs.ingest import _sanitize_context, execute_ingestion, ingest_bundle
from data_pipeline.normalize.identity_resolution import resolve_players
from data_pipeline.operations import (
    benchmark,
    coverage_report,
    freshness_category,
    snapshot_diff,
)
from data_pipeline.provider_contract import validate_adapter
from sqlalchemy import func, select


def _count(session, model) -> int:
    return session.scalar(select(func.count()).select_from(model))


def _write_metric_csv(path, *, source_player_id: str, value: str, snapshot: str = "replay-v1"):
    _write_metric_rows(
        path,
        rows=[{"source_player_id": source_player_id, "value": value}],
        snapshot=snapshot,
    )


def _write_metric_rows(path, *, rows: list[dict[str, str]], snapshot: str):
    fields = (
        "source_name",
        "source_player_id",
        "season",
        "competition_name",
        "team_name",
        "metric_name",
        "metric_value",
        "unit",
        "minutes",
        "position_group",
        "source_snapshot_id",
    )
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "source_name": "sample",
                    "source_player_id": row["source_player_id"],
                    "season": "2023/24",
                    "competition_name": "Fixture League",
                    "team_name": "Fixture Team",
                    "metric_name": "shots_per90",
                    "metric_value": row["value"],
                    "unit": "per90",
                    "minutes": "900",
                    "position_group": "ATT",
                    "source_snapshot_id": snapshot,
                }
            )


def _canonical_player(*, source: str, source_id: str, name: str = "Shared Identity"):
    return CanonicalPlayer(
        source_name=source,
        source_player_id=source_id,
        canonical_name=name,
        birth_date="2000-01-02",
        primary_position="CM",
    )


def test_all_adapters_declare_valid_capabilities():
    capabilities = provider_capabilities()
    assert {
        "sample",
        "transfermarkt",
        "performance_csv",
        "statsbomb",
        "statsbomb_open_data",
        "mock_commercial_provider",
        "generated_fixture",
    }.issubset(capabilities)
    assert all(not capability.validate() for capability in capabilities.values())


def test_quarantine_context_is_bounded_and_secret_safe():
    class DiagnosticObject:
        def __str__(self):
            return "diagnostic-object"

    sanitized = _sanitize_context(
        {
            "token": "must-not-survive",
            "raw_payload": {"large": "payload"},
            "safe": "x" * 700,
            "nested": {"api_key": "hidden", "value": 3},
            "items": (None, True, DiagnosticObject()),
            "deep": {"a": {"b": {"c": {"d": "too deep"}}}},
        }
    )
    assert "token" not in sanitized and "raw_payload" not in sanitized
    assert len(sanitized["safe"]) == 500
    assert sanitized["nested"] == {"value": 3}
    assert sanitized["items"] == [None, True, "diagnostic-object"]
    assert sanitized["deep"]["a"]["b"]["c"] == "[truncated]"


@pytest.mark.parametrize(
    "adapter",
    [
        SampleAdapter(),
        MockCommercialProviderAdapter(),
        GeneratedFixtureAdapter(size=12),
    ],
)
def test_fixture_adapters_pass_shared_conformance(adapter):
    first = validate_adapter(adapter, adapter.fetch())
    second = validate_adapter(adapter, adapter.fetch())
    assert first["valid"] is True
    assert first == second


def test_mock_commercial_credential_shape(monkeypatch):
    monkeypatch.delenv("SCOUTBOY_MOCK_COMMERCIAL_TOKEN", raising=False)
    with pytest.raises(ValueError, match="SCOUTBOY_MOCK_COMMERCIAL_TOKEN"):
        MockCommercialProviderAdapter(credential_required_mode=True).fetch()
    monkeypatch.setenv("SCOUTBOY_MOCK_COMMERCIAL_TOKEN", "dummy-test-token")
    bundle = MockCommercialProviderAdapter(credential_required_mode=True).fetch()
    assert bundle.snapshot_metadata["metadata"]["demo_only"] is True


def test_identity_resolution_preserves_exact_source_id_match(fresh_sessions):
    sessions, _ = fresh_sessions
    with sessions() as session:
        player = Player(canonical_name="Old Name", birth_date=date(1999, 1, 1))
        session.add(player)
        session.flush()
        session.add(
            PlayerSourceId(
                player_id=player.id,
                source_name="provider-a",
                source_player_id="exact-1",
            )
        )
        session.flush()

        result = resolve_players(
            session,
            [_canonical_player(source="provider-a", source_id="exact-1", name="Updated Name")],
        )

        assert result.ambiguities == []
        assert result.players_by_source_key[("provider-a", "exact-1")].id == player.id
        assert _count(session, Player) == 1


def test_identity_resolution_preserves_unique_name_and_dob_bridge(fresh_sessions):
    sessions, _ = fresh_sessions
    with sessions() as session:
        player = Player(canonical_name="Shared Identity", birth_date=date(2000, 1, 2))
        session.add(player)
        session.flush()

        result = resolve_players(
            session,
            [_canonical_player(source="provider-b", source_id="unique-1")],
        )
        session.flush()

        assert result.ambiguities == []
        assert result.players_by_source_key[("provider-b", "unique-1")].id == player.id
        assert _count(session, Player) == 1
        assert _count(session, PlayerSourceId) == 1


def test_identity_resolution_preserves_first_time_player_creation(fresh_sessions):
    sessions, _ = fresh_sessions
    with sessions() as session:
        result = resolve_players(
            session,
            [_canonical_player(source="provider-c", source_id="new-1")],
        )
        session.flush()

        assert result.ambiguities == []
        assert result.players_by_source_key[("provider-c", "new-1")].id is not None
        assert _count(session, Player) == 1
        assert _count(session, PlayerSourceId) == 1


def test_ambiguous_name_and_dob_is_quarantined_without_dependents(fresh_sessions):
    sessions, _ = fresh_sessions
    adapter = SampleAdapter()
    bundle = adapter.fetch()
    rejected = bundle.players[0]
    rejected_birth_date = date.fromisoformat(rejected.birth_date)
    with sessions() as session:
        candidates = [
            Player(canonical_name=rejected.canonical_name, birth_date=rejected_birth_date),
            Player(canonical_name=rejected.canonical_name, birth_date=rejected_birth_date),
        ]
        session.add_all(candidates)
        session.flush()
        candidate_ids = [player.id for player in candidates]

        result = ingest_bundle(session, bundle, adapter=adapter)

        ambiguity = session.scalar(
            select(QuarantineRecord).where(
                QuarantineRecord.entity_type == "player",
                QuarantineRecord.external_id == rejected.source_player_id,
                QuarantineRecord.reason_code == "unresolved_or_ambiguous_player_identity",
            )
        )
        assert result["status"] == "completed_with_warnings"
        assert ambiguity.diagnostic_context_json["candidate_count"] == 2
        assert (
            session.scalar(
                select(func.count())
                .select_from(PlayerSourceId)
                .where(
                    PlayerSourceId.source_name == rejected.source_name,
                    PlayerSourceId.source_player_id == rejected.source_player_id,
                )
            )
            == 0
        )
        assert (
            session.scalar(
                select(func.count())
                .select_from(Appearance)
                .where(Appearance.player_id.in_(candidate_ids))
            )
            == 0
        )
        assert (
            session.scalar(
                select(func.count())
                .select_from(PlayerMetricRaw)
                .where(PlayerMetricRaw.player_id.in_(candidate_ids))
            )
            == 0
        )
        assert _count(session, Player) == len(bundle.players) + 1


@pytest.mark.parametrize("mode", ["dry_run", "validate_only"])
def test_non_mutating_modes_write_nothing(fresh_sessions, mode):
    sessions, _ = fresh_sessions
    with sessions() as session:
        result = execute_ingestion(session, SampleAdapter(), mode=mode)
        assert result["status"] == "validated"
        for model in (Player, PlayerMetricRaw, SourceSnapshot, RatingRun, DataQualityReport):
            assert _count(session, model) == 0


def test_lifecycle_idempotency_and_fingerprint_difference(fresh_sessions):
    sessions, _ = fresh_sessions
    adapter = SampleAdapter()
    with sessions() as session:
        first = execute_ingestion(session, adapter)
        metric_count = _count(session, PlayerMetricRaw)
        report_count = _count(session, DataQualityReport)
        assert first["status"] == "completed"
        assert not list(session.scalars(select(RatingRun).where(RatingRun.run_type == "recompute")))

        second = execute_ingestion(session, adapter)
        assert second["status"] == "skipped_idempotent"
        assert _count(session, SourceSnapshot) == 1
        assert _count(session, PlayerMetricRaw) == metric_count
        assert _count(session, DataQualityReport) == report_count

        changed = deepcopy(adapter.fetch())
        changed.metrics[0].metric_value += 1
        third = ingest_bundle(session, changed, adapter=adapter)
        assert third["status"] == "completed"
        assert _count(session, SourceSnapshot) == 2
        completed_runs = list(
            session.scalars(
                select(RatingRun).where(
                    RatingRun.status.in_({"completed", "completed_with_warnings"})
                )
            )
        )
        assert len({run.snapshot_fingerprint for run in completed_runs}) == 2


def test_blocking_schema_drift_fails_without_publishing_snapshot(fresh_sessions):
    sessions, _ = fresh_sessions
    adapter = SampleAdapter()
    bundle = adapter.fetch()
    bundle.metrics = [
        metric for metric in bundle.metrics if metric.metric_name != "non_penalty_xg_per90"
    ]
    with sessions() as session, pytest.raises(ValueError, match="source_schema_drift"):
        ingest_bundle(session, bundle, adapter=adapter)
    with sessions() as session:
        run = session.scalar(select(RatingRun).order_by(RatingRun.id.desc()))
        assert run.status == "failed"
        assert _count(session, SourceSnapshot) == 0
        assert _count(session, Player) == 0
        assert (
            session.scalar(
                select(func.count())
                .select_from(QuarantineRecord)
                .where(QuarantineRecord.reason_code == "source_schema_drift")
            )
            == 1
        )


def test_quarantine_and_snapshot_scope_replay_are_idempotent(fresh_sessions, tmp_path):
    sessions, _ = fresh_sessions
    csv_path = tmp_path / "replay.csv"
    with sessions() as session:
        execute_ingestion(session, SampleAdapter())
        existing_id = session.scalar(
            select(PlayerSourceId.source_player_id).where(PlayerSourceId.source_name == "sample")
        )

    _write_metric_csv(csv_path, source_player_id="missing-player", value="3.2")
    with sessions() as session:
        rejected = execute_ingestion(session, PerformanceCsvAdapter(csv_path))
        assert rejected["status"] == "completed_with_warnings"
        quarantine = session.scalar(
            select(QuarantineRecord).where(QuarantineRecord.status == "open")
        )
        assert quarantine.reason_code == "unresolved_or_ambiguous_player_identity"
        rejected_run_id = rejected["run_id"]

    _write_metric_csv(csv_path, source_player_id=existing_id, value="3.2")
    with sessions() as session:
        replayed = execute_ingestion(
            session,
            PerformanceCsvAdapter(csv_path),
            replay_of_run_id=rejected_run_id,
        )
        assert replayed["status"] == "completed_with_warnings"
        resolved = session.scalar(
            select(QuarantineRecord).where(QuarantineRecord.ingestion_run_id == rejected_run_id)
        )
        assert resolved.status == "resolved"
        assert resolved.replay_run_id == replayed["run_id"]
        before_count = _count(session, PlayerMetricRaw)
        skipped = execute_ingestion(
            session,
            PerformanceCsvAdapter(csv_path),
            replay_of_run_id=rejected_run_id,
        )
        assert skipped["status"] == "skipped_idempotent"
        assert _count(session, PlayerMetricRaw) == before_count


def test_partial_replay_resolves_only_fixed_rows_then_full_replay_resolves_all(
    fresh_sessions, tmp_path
):
    sessions, _ = fresh_sessions
    csv_path = tmp_path / "partial-replay.csv"
    with sessions() as session:
        execute_ingestion(session, SampleAdapter())
        source_player_ids = list(
            session.scalars(
                select(PlayerSourceId.source_player_id)
                .where(PlayerSourceId.source_name == "sample")
                .order_by(PlayerSourceId.source_player_id)
                .limit(2)
            )
        )

    invalid_rows = [
        {"source_player_id": source_player_ids[0], "value": "invalid-a"},
        {"source_player_id": source_player_ids[1], "value": "invalid-b"},
    ]
    _write_metric_rows(csv_path, rows=invalid_rows, snapshot="partial-original")
    with sessions() as session:
        original = execute_ingestion(session, PerformanceCsvAdapter(csv_path))
        original_run_id = original["run_id"]
        assert original["quarantined"] == 2

    partial_rows = [
        {"source_player_id": source_player_ids[0], "value": "2.1"},
        {"source_player_id": source_player_ids[1], "value": "invalid-b"},
    ]
    _write_metric_rows(csv_path, rows=partial_rows, snapshot="partial-one-fixed")
    with sessions() as session:
        partial = execute_ingestion(
            session,
            PerformanceCsvAdapter(csv_path),
            replay_of_run_id=original_run_id,
        )
        original_rows = list(
            session.scalars(
                select(QuarantineRecord)
                .where(QuarantineRecord.ingestion_run_id == original_run_id)
                .order_by(QuarantineRecord.id)
            )
        )
        assert partial["quarantined"] == 1
        assert [row.status for row in original_rows] == ["resolved", "open"]
        assert original_rows[0].replay_run_id == partial["run_id"]
        assert original_rows[1].replay_run_id is None

    fixed_rows = [
        {"source_player_id": source_player_ids[0], "value": "2.1"},
        {"source_player_id": source_player_ids[1], "value": "1.7"},
    ]
    _write_metric_rows(csv_path, rows=fixed_rows, snapshot="partial-all-fixed")
    with sessions() as session:
        complete = execute_ingestion(
            session,
            PerformanceCsvAdapter(csv_path),
            replay_of_run_id=original_run_id,
        )
        original_rows = list(
            session.scalars(
                select(QuarantineRecord)
                .where(QuarantineRecord.ingestion_run_id == original_run_id)
                .order_by(QuarantineRecord.id)
            )
        )
        assert [row.status for row in original_rows] == ["resolved", "resolved"]
        assert original_rows[1].replay_run_id == complete["run_id"]
        metric_count = _count(session, PlayerMetricRaw)
        quarantine_count = _count(session, QuarantineRecord)

        skipped = execute_ingestion(
            session,
            PerformanceCsvAdapter(csv_path),
            replay_of_run_id=original_run_id,
        )
        assert skipped["status"] == "skipped_idempotent"
        assert _count(session, PlayerMetricRaw) == metric_count
        assert _count(session, QuarantineRecord) == quarantine_count


def test_invalid_metric_value_is_persistently_quarantined(fresh_sessions, tmp_path):
    sessions, _ = fresh_sessions
    csv_path = tmp_path / "invalid.csv"
    _write_metric_csv(csv_path, source_player_id="any", value="not-a-number")
    with sessions() as session:
        result = execute_ingestion(session, PerformanceCsvAdapter(csv_path))
        assert result["status"] == "completed_with_warnings"
        row = session.scalar(select(QuarantineRecord))
        assert row.reason_code == "invalid_metric_value"
        assert "not-a-number" not in str(row.diagnostic_context_json)


def test_missing_required_fields_fail_with_persistent_quarantine(fresh_sessions, tmp_path):
    sessions, _ = fresh_sessions
    csv_path = tmp_path / "missing-fields.csv"
    csv_path.write_text(
        "source_name,source_player_id,metric_name,metric_value\nsample,p1,shots_per90,1.2\n"
    )
    with sessions() as session, pytest.raises(ValueError, match="missing required columns"):
        execute_ingestion(session, PerformanceCsvAdapter(csv_path))
    with sessions() as session:
        run = session.scalar(select(RatingRun))
        quarantine = session.scalar(select(QuarantineRecord))
        assert run.status == "failed"
        assert quarantine.reason_code == "missing_required_source_fields"
        assert _count(session, SourceSnapshot) == 0


def test_unsupported_position_mapping_is_quarantined_not_published(fresh_sessions):
    sessions, _ = fresh_sessions
    adapter = SampleAdapter()
    bundle = adapter.fetch()
    rejected_id = bundle.players[0].source_player_id
    bundle.players[0].primary_position = "SWEEPER"
    with sessions() as session:
        result = ingest_bundle(session, bundle, adapter=adapter)
        assert result["status"] == "completed_with_warnings"
        quarantine = session.scalar(
            select(QuarantineRecord).where(
                QuarantineRecord.reason_code == "unsupported_position_mapping"
            )
        )
        assert quarantine.external_id == rejected_id
        assert (
            session.scalar(
                select(func.count())
                .select_from(PlayerSourceId)
                .where(PlayerSourceId.source_player_id == rejected_id)
            )
            == 0
        )


def test_duplicate_source_record_is_quarantined_as_blocking(fresh_sessions):
    sessions, _ = fresh_sessions
    adapter = SampleAdapter()
    bundle = adapter.fetch()
    bundle.players.append(deepcopy(bundle.players[0]))
    with sessions() as session, pytest.raises(ValueError, match="duplicate_player_source_ids"):
        ingest_bundle(session, bundle, adapter=adapter)
    with sessions() as session:
        quarantine = session.scalar(select(QuarantineRecord))
        assert quarantine.reason_code == "duplicate_source_record"
        assert _count(session, Player) == 0


def test_snapshot_diff_freshness_and_coverage_are_deterministic(fresh_sessions):
    sessions, _ = fresh_sessions
    adapter = SampleAdapter()
    with sessions() as session:
        execute_ingestion(session, adapter)
        changed = deepcopy(adapter.fetch())
        changed.metrics[0].metric_value += 2
        ingest_bundle(session, changed, adapter=adapter)
        snapshots = list(session.scalars(select(SourceSnapshot).order_by(SourceSnapshot.id)))
        first = snapshot_diff(session, snapshots[0].id, snapshots[1].id)
        second = snapshot_diff(session, snapshots[0].id, snapshots[1].id)
        assert first == second
        assert len(first["metrics"]["updated"]) == 1
        assert freshness_category(snapshots[0], today=date(2024, 6, 1)) == "demo_only"
        report = coverage_report(session)
        assert all(
            item["coverage_claim"]
            == "observed local snapshot only; not inferred full competition coverage"
            for item in report["snapshots"]
        )
        snapshots[1].provider = "different-provider"
        with pytest.raises(ValueError, match="same provider"):
            snapshot_diff(session, snapshots[0].id, snapshots[1].id)
        snapshots[1].provider = snapshots[0].provider
        snapshots[1].scope_json = {"different": "scope"}
        with pytest.raises(ValueError, match="same scope"):
            snapshot_diff(session, snapshots[0].id, snapshots[1].id)


def test_freshness_health_categories_are_deterministic():
    today = date(2026, 7, 22)
    snapshot = SourceSnapshot(snapshot_key="freshness-test", provider="test")
    assert freshness_category(snapshot, today=today) == "unknown"
    snapshot.as_of_date = date(2026, 7, 1)
    assert freshness_category(snapshot, today=today) == "healthy"
    snapshot.as_of_date = date(2026, 1, 1)
    assert freshness_category(snapshot, today=today) == "partial"
    snapshot.as_of_date = date(2024, 1, 1)
    assert freshness_category(snapshot, today=today) == "stale"
    snapshot.health_label = "blocked"
    assert freshness_category(snapshot, today=today) == "blocked"


def test_generated_5000_record_batch_and_benchmark_json(fresh_sessions):
    sessions, _ = fresh_sessions
    with sessions() as session:
        result = benchmark(session, size=5000)
        assert result["input_size"] == 5000
        assert result["input_metric_rows"] == 25_000
        assert result["records_written"] == 30_000
        assert result["records_quarantined"] == 0
        assert result["database_type"] == "sqlite"
        assert _count(session, Player) == 5000
        assert _count(session, PlayerMetricRaw) == 25_000
