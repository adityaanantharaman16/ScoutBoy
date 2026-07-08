from __future__ import annotations

from data_pipeline.adapters import SampleAdapter
from data_pipeline.adapters.base import (
    CanonicalAppearance,
    CanonicalMetric,
    CanonicalPlayer,
    IngestBundle,
)
from data_pipeline.quality.checks import run_bundle_checks, run_rating_outlier_check


def _finding(report, name):
    return next(f for f in report["findings"] if f["check"] == name)


def test_healthy_sample_bundle_has_no_errors():
    report = run_bundle_checks(SampleAdapter().fetch())
    assert not report["has_errors"], report["error_checks"]


def test_detects_duplicate_source_ids_and_dob():
    bundle = IngestBundle(source_name="x", source_snapshot_id="x")
    bundle.players = [
        CanonicalPlayer("x", "1", "A", birth_date="2003-01-01", primary_position="LW"),
        CanonicalPlayer("x", "1", "A dup", birth_date="1850-01-01", primary_position="CM"),
    ]
    bundle.metrics = [CanonicalMetric("1", "2023/24", "npxg_per90", -0.5)]
    report = run_bundle_checks(bundle)
    assert _finding(report, "duplicate_player_source_ids")["count"] == 1
    assert _finding(report, "impossible_birth_dates")["count"] == 1
    assert _finding(report, "negative_metrics")["count"] == 1
    assert report["has_errors"]


def test_detects_duplicate_player_season_rows():
    bundle = IngestBundle(source_name="x", source_snapshot_id="x")
    bundle.players = [CanonicalPlayer("x", "1", "A", primary_position="LW")]
    appr = CanonicalAppearance("1", "t", "c", "2023/24", minutes=900)
    bundle.appearances = [appr, appr]
    report = run_bundle_checks(bundle)
    assert _finding(report, "duplicate_player_season_rows")["count"] == 1


def test_schema_drift_flag_when_core_metrics_missing():
    bundle = IngestBundle(source_name="x", source_snapshot_id="x")
    bundle.players = [CanonicalPlayer("x", "1", "A", primary_position="LW")]
    bundle.metrics = [CanonicalMetric("1", "2023/24", "goals_per90", 0.5)]
    report = run_bundle_checks(bundle)
    assert _finding(report, "source_schema_drift")["count"] > 0
    assert report["has_errors"]


def test_outlier_rating_check():
    assert run_rating_outlier_check([50.0, 88.0])["count"] == 0
    assert run_rating_outlier_check([50.0, 120.0, -3.0])["count"] == 2
