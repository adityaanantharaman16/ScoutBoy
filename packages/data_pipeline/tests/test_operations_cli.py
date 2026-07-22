from __future__ import annotations

import json
from copy import deepcopy

import pytest
from app.models.orm import QuarantineRecord
from data_pipeline import operations
from data_pipeline.adapters import SampleAdapter
from data_pipeline.jobs.ingest import execute_ingestion, ingest_bundle


def _invoke(capsys, argv: list[str]):
    capsys.readouterr()
    assert operations.main(argv) == 0
    return json.loads(capsys.readouterr().out)


def test_operations_cli_routes_emit_machine_readable_reports(fresh_sessions, monkeypatch, capsys):
    sessions, _ = fresh_sessions
    adapter = SampleAdapter()
    with sessions() as session:
        first = execute_ingestion(session, adapter)
        changed = deepcopy(adapter.fetch())
        changed.metrics[0].metric_value += 1
        second = ingest_bundle(session, changed, adapter=adapter)
        session.add(
            QuarantineRecord(
                ingestion_run_id=first["run_id"],
                provider="sample",
                source_name="sample",
                snapshot_fingerprint="operations-cli-quarantine",
                entity_type="player",
                external_id="cli-player",
                reason_code="unresolved_or_ambiguous_player_identity",
                severity="warning",
                payload_fingerprint="operations-cli-payload",
                diagnostic_context_json={"match_outcome": "test_fixture"},
            )
        )
        session.commit()

    monkeypatch.setattr(operations, "SessionLocal", sessions)

    providers = _invoke(capsys, ["providers"])
    assert "sample" in providers

    runs = _invoke(capsys, ["runs", "--limit", "2"])
    assert len(runs) == 2
    assert runs[0]["id"] == second["run_id"]

    run = _invoke(capsys, ["run", str(first["run_id"])])
    assert run["provider"] == "sample"
    with pytest.raises(ValueError, match="ingestion run not found"):
        operations.main(["run", "999999"])

    quarantine = _invoke(capsys, ["quarantine", "--status", "open", "--limit", "1"])
    assert quarantine[0]["external_id"] == "cli-player"
    assert quarantine[0]["diagnostic_context"] == {"match_outcome": "test_fixture"}

    diff = _invoke(capsys, ["diff", "1", "2"])
    assert diff["provider"] == "sample"
    assert len(diff["metrics"]["updated"]) == 1

    freshness = _invoke(capsys, ["freshness"])
    assert len(freshness["snapshots"]) == 2
    assert all(row["freshness_category"] == "demo_only" for row in freshness["snapshots"])

    coverage = _invoke(capsys, ["coverage"])
    assert len(coverage["snapshots"]) == 2
    assert all(
        row["coverage_claim"]
        == "observed local snapshot only; not inferred full competition coverage"
        for row in coverage["snapshots"]
    )

    benchmark = _invoke(capsys, ["benchmark", "--size", "2"])
    assert benchmark["input_size"] == 2
    assert benchmark["records_written"] == 12
