from __future__ import annotations

from data_pipeline.adapters import SampleAdapter
from data_pipeline.adapters.base import (
    CanonicalAppearance,
    CanonicalMetric,
    CanonicalPlayer,
    IngestBundle,
)
from data_pipeline.quality import cohort_report
from data_pipeline.quality import report as quality_report
from data_pipeline.quality.checks import run_bundle_checks, run_rating_outlier_check
from data_pipeline.quality.cohort_report import build_cohort_report


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


class _RecordingSession:
    def __init__(self, scores):
        self.scores = scores
        self.added = []
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def scalars(self, statement):
        return iter(self.scores)

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.committed = True


def test_quality_report_builds_persists_and_flags_rating_outliers(monkeypatch):
    session = _RecordingSession([45.0, 101.0])
    monkeypatch.setattr(quality_report, "SessionLocal", lambda: session)
    monkeypatch.setattr(quality_report, "get_adapter", lambda source: SampleAdapter())

    result = quality_report.build_report("sample")

    assert result["has_errors"] is True
    assert _finding(result, "outlier_ratings")["count"] == 1
    assert session.committed is True
    assert len(session.added) == 1
    assert session.added[0].source_name == "sample"
    assert session.added[0].report_json == result


def test_quality_report_cli_prints_summary_and_returns_status(monkeypatch, capsys):
    monkeypatch.setattr(
        quality_report,
        "build_report",
        lambda source: {
            "player_count": 2,
            "metric_rows": 3,
            "findings": [{"check": "example", "severity": "ok", "count": 0, "details": []}],
            "has_errors": False,
        },
    )

    assert quality_report.main(["--source", "sample"]) == 0
    output = capsys.readouterr().out
    assert "2 players, 3 metric rows" in output
    assert "No blocking errors." in output


def test_cohort_report_exercises_fixture_backed_runtime_without_raw_files(db_session):
    result = build_cohort_report(db_session, "2023/24")

    assert result["status"] == "fail"
    assert result["scope"]["statsbomb_matches"] == 34
    assert result["coverage"]["eligible_u23_att_mid"] == 24
    assert len(result["eligible_players"]) == 24
    assert result["checks"]["all_eligible_players_rated"] is True
    assert result["checks"]["two_source_snapshots"] is False


def test_cohort_report_cli_writes_missing_season_report(
    fresh_sessions, monkeypatch, tmp_path, capsys
):
    session_factory, _ = fresh_sessions
    monkeypatch.setattr(cohort_report, "SessionLocal", session_factory)
    output_path = tmp_path / "cohort.json"

    status = cohort_report.main(
        ["--season", "missing-season", "--output", str(output_path), "--verify"]
    )

    assert status == 1
    assert '"status": "missing"' in output_path.read_text()
    assert '"season": "missing-season"' in capsys.readouterr().out
