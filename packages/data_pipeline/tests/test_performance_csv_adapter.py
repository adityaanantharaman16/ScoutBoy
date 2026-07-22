from __future__ import annotations

import pytest
from app.models.orm import PlayerMetricNormalized, PlayerMetricRaw
from data_pipeline.adapters import PerformanceCsvAdapter, TransfermarktAdapter
from data_pipeline.adapters.csv_adapter import CsvContractError
from data_pipeline.jobs.ingest import ingest_bundle
from data_pipeline.provider_contract import validate_adapter
from sqlalchemy import func, select


def _write_csv(path, rows, header=None):
    header = header or (
        "source_name,source_player_id,season,competition_name,team_name,metric_name,"
        "metric_value,unit,minutes,position_group,source_snapshot_id"
    )
    path.write_text(header + "\n" + "\n".join(rows) + "\n")
    return path


def test_valid_contract_loads(perf_csv):
    adapter = PerformanceCsvAdapter(csv_path=perf_csv)
    bundle = adapter.fetch()
    assert validate_adapter(adapter, bundle)["valid"] is True
    assert bundle.source_name == "performance_csv"
    assert bundle.metrics
    # every emitted metric resolves to a canonical performance metric
    from scoutboy_shared import resolve_metric

    assert all(resolve_metric(m.metric_name) for m in bundle.metrics)


def test_missing_required_column_raises(tmp_path):
    bad = tmp_path / "bad.csv"
    bad.write_text("source_name,source_player_id,metric_name,metric_value\ntm,1,shots_per90,1.0\n")
    with pytest.raises(CsvContractError):
        PerformanceCsvAdapter(csv_path=bad).fetch()


def test_unknown_metric_name_is_quarantined(tmp_path):
    csv = _write_csv(
        tmp_path / "m.csv",
        [
            "transfermarkt,1,2024-2025,PL,City,shots_per90,1.2,per90,900,ATT,s1",
            "transfermarkt,1,2024-2025,PL,City,vertical_leap_cm,70,count,900,ATT,s1",
        ],
    )
    bundle = PerformanceCsvAdapter(csv_path=csv).fetch()
    names = {m.metric_name for m in bundle.metrics}
    assert "shots_per90" in names and "vertical_leap_cm" not in names
    warn = {w["check"]: w for w in bundle.adapter_warnings}
    assert warn["invalid_metric_names"]["count"] == 1


def test_invalid_negative_metric_is_quarantined(tmp_path):
    csv = _write_csv(
        tmp_path / "m.csv",
        [
            "transfermarkt,1,2024-2025,PL,City,shots_per90,-2.0,per90,900,ATT,s1",
            "transfermarkt,1,2024-2025,PL,City,goals_minus_xg_per90,-0.1,per90,900,ATT,s1",
        ],
    )
    bundle = PerformanceCsvAdapter(csv_path=csv).fetch()
    # negative shots rejected; negative finishing-vs-xG allowed
    names = {m.metric_name for m in bundle.metrics}
    assert "goals_minus_xg_per90" in names and "shots_per90" not in names
    warn = {w["check"]: w for w in bundle.adapter_warnings}
    assert warn["invalid_negative_metrics"]["count"] == 1


def test_unknown_player_source_id_is_quarantined_not_crash(fresh_sessions, tm_dir, tmp_path):
    SessionLocal, _ = fresh_sessions
    # ingest identities first
    with SessionLocal() as s:
        ingest_bundle(s, TransfermarktAdapter(csv_dir=tm_dir).fetch())
    csv = _write_csv(
        tmp_path / "m.csv",
        [
            "transfermarkt,1001,2024-2025,L1,PSG,shots_per90,2.0,per90,2100,ATT,s1",
            "transfermarkt,999999,2024-2025,L1,Ghost,shots_per90,1.0,per90,900,ATT,s1",
        ],
    )
    with SessionLocal() as s:
        result = ingest_bundle(s, PerformanceCsvAdapter(csv_path=csv).fetch())
    assert result["quarantined"] == 1  # unknown id 999999
    checks = {f["check"]: f for f in result["report"]["findings"]}
    assert checks["unknown_source_player_ids"]["count"] == 1
    with SessionLocal() as s:
        # the matched row was stored; the unmatched one was not (scope to this source)
        n = s.scalar(
            select(func.count())
            .select_from(PlayerMetricRaw)
            .where(PlayerMetricRaw.source_name == "performance_csv")
        )
        assert n == 1


def test_metrics_normalize_after_recompute(fresh_sessions, tm_dir, perf_csv):
    from data_pipeline.jobs.recompute import recompute

    SessionLocal, _ = fresh_sessions
    with SessionLocal() as s:
        ingest_bundle(s, TransfermarktAdapter(csv_dir=tm_dir).fetch())
    with SessionLocal() as s:
        ingest_bundle(s, PerformanceCsvAdapter(csv_path=perf_csv).fetch())
    with SessionLocal() as s:
        recompute(s)
    with SessionLocal() as s:
        rows = list(s.scalars(select(PlayerMetricNormalized).limit(20)))
        assert rows
        # normalized rows only exist for present metrics; percentiles populated, never zeroed-in
        assert all(r.percentile is not None for r in rows)


def test_duplicate_metric_rows_are_deduped(fresh_sessions, tm_dir, tmp_path):
    SessionLocal, _ = fresh_sessions
    with SessionLocal() as s:
        ingest_bundle(s, TransfermarktAdapter(csv_dir=tm_dir).fetch())
    csv = _write_csv(
        tmp_path / "m.csv",
        [
            "transfermarkt,1001,2024-2025,L1,PSG,shots_per90,2.0,per90,2100,ATT,s1",
            "transfermarkt,1001,2024-2025,L1,PSG,shots_per90,2.0,per90,2100,ATT,s1",
        ],
    )
    with SessionLocal() as s:
        result = ingest_bundle(s, PerformanceCsvAdapter(csv_path=csv).fetch())
    checks = {f["check"]: f for f in result["report"]["findings"]}
    assert checks["duplicate_metric_rows"]["count"] == 1
    with SessionLocal() as s:
        n = s.scalar(
            select(func.count())
            .select_from(PlayerMetricRaw)
            .where(PlayerMetricRaw.source_name == "performance_csv")
        )
        assert n == 1
