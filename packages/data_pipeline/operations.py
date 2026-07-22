"""Read-only operational reports and benchmark CLI for Milestone 5."""

from __future__ import annotations

import argparse
import json
import time
from datetime import date, datetime, timezone

from app.core.db import SessionLocal
from app.models.orm import (
    DataCoverage,
    QuarantineRecord,
    RatingRun,
    SourceSnapshot,
)
from rolefit import load_role_configs
from sqlalchemy import select
from sqlalchemy.orm import Session

from .adapters import GeneratedFixtureAdapter, provider_capabilities
from .jobs.ingest import execute_ingestion
from .jobs.recompute import recompute

HEALTH_LABELS = {"healthy", "partial", "stale", "blocked", "demo_only", "unknown"}


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _snapshot_inventory(snapshot: SourceSnapshot) -> dict:
    return (snapshot.metadata_json or {}).get("operational_inventory", {})


def _map_diff(before: dict, after: dict) -> dict:
    before_keys, after_keys = set(before), set(after)
    return {
        "added": sorted(after_keys - before_keys),
        "removed": sorted(before_keys - after_keys),
        "updated": sorted(key for key in before_keys & after_keys if before[key] != after[key]),
    }


def snapshot_diff(session: Session, before_id: int, after_id: int) -> dict:
    before = session.get(SourceSnapshot, before_id)
    after = session.get(SourceSnapshot, after_id)
    if before is None or after is None:
        raise ValueError("Both source snapshot ids must exist")
    if before.provider != after.provider:
        raise ValueError("Snapshot diff requires snapshots from the same provider")
    if (before.scope_json or {}) != (after.scope_json or {}):
        raise ValueError("Snapshot diff requires snapshots from the same scope")
    before_inventory, after_inventory = _snapshot_inventory(before), _snapshot_inventory(after)
    before_entities = before_inventory.get("entities", {})
    after_entities = after_inventory.get("entities", {})
    entity_types = sorted(set(before_entities) | set(after_entities))
    entity_changes = {
        entity_type: _map_diff(
            before_entities.get(entity_type, {}), after_entities.get(entity_type, {})
        )
        for entity_type in entity_types
    }
    before_stats = (before.metadata_json or {}).get("operational_stats", {})
    after_stats = (after.metadata_json or {}).get("operational_stats", {})
    return {
        "provider": before.provider,
        "scope": before.scope_json or after.scope_json or {},
        "before": {"id": before.id, "key": before.snapshot_key, "fingerprint": before.fingerprint},
        "after": {"id": after.id, "key": after.snapshot_key, "fingerprint": after.fingerprint},
        "entities": entity_changes,
        "metrics": _map_diff(
            before_inventory.get("metrics", {}), after_inventory.get("metrics", {})
        ),
        "coverage": _map_diff(
            before_inventory.get("coverage", {}), after_inventory.get("coverage", {})
        ),
        "identity_match_rate": {
            "before": before_stats.get("identity_match_rate"),
            "after": after_stats.get("identity_match_rate"),
        },
        "quarantine": {
            "before": before_stats.get("quarantine_count", 0),
            "after": after_stats.get("quarantine_count", 0),
        },
        "freshness": {
            "before": {
                "dataset_version": before.dataset_version,
                "as_of_date": _iso(before.as_of_date),
            },
            "after": {
                "dataset_version": after.dataset_version,
                "as_of_date": _iso(after.as_of_date),
            },
        },
    }


def freshness_category(snapshot: SourceSnapshot, *, today: date | None = None) -> str:
    metadata = snapshot.metadata_json or {}
    if (
        snapshot.health_label == "demo_only"
        or metadata.get("fixture_data")
        or metadata.get("demo_only")
    ):
        return "demo_only"
    if snapshot.health_label == "blocked":
        return "blocked"
    if snapshot.as_of_date is None:
        return "unknown"
    age_days = ((today or date.today()) - snapshot.as_of_date).days
    if age_days <= 90:
        return "healthy"
    if age_days <= 365:
        return "partial"
    return "stale"


def freshness_report(session: Session, *, today: date | None = None) -> dict:
    rows = []
    for snapshot in session.scalars(select(SourceSnapshot).order_by(SourceSnapshot.id)):
        rows.append(
            {
                "snapshot_id": snapshot.id,
                "provider": snapshot.provider,
                "source_type": snapshot.source_type or "unknown",
                "reference_season": snapshot.target_season,
                "snapshot_version": snapshot.dataset_version,
                "checksum": snapshot.checksum,
                "fingerprint": snapshot.fingerprint,
                "as_of_date": _iso(snapshot.as_of_date),
                "ingest_timestamp": _iso(snapshot.created_at),
                "freshness_category": freshness_category(snapshot, today=today),
                "known_limitation": snapshot.known_limitation,
                "attribution": snapshot.attribution,
                "license_url": snapshot.license_url,
            }
        )
    return {"generated_at": datetime.now(timezone.utc).isoformat(), "snapshots": rows}


def coverage_report(session: Session) -> dict:
    roles = load_role_configs()
    reports = []
    for snapshot in session.scalars(select(SourceSnapshot).order_by(SourceSnapshot.id)):
        inventory = _snapshot_inventory(snapshot)
        metric_map = inventory.get("metrics", {})
        available_metrics = sorted({key.rsplit(":", 1)[-1] for key in metric_map})
        role_availability = {}
        for role_key, role in roles.items():
            required = sorted(set(role.required_metrics))
            available = sorted(set(required) & set(available_metrics))
            role_availability[role_key] = {
                "required": required,
                "available": available,
                "availability_rate": round(len(available) / len(required), 6) if required else 1.0,
            }
        coverage_rows = []
        for row in session.scalars(
            select(DataCoverage).where(DataCoverage.source_snapshot_record_id == snapshot.id)
        ):
            coverage_rows.append(
                {
                    "competition_id": row.competition_id,
                    "season_id": row.season_id,
                    "matches_covered": row.matches_covered,
                    "known_total_matches": row.known_total_matches,
                    "coverage_pct": row.coverage_pct,
                    "events_available": row.events_available,
                    "lineups_available": row.lineups_available,
                }
            )
        stats = (snapshot.metadata_json or {}).get("operational_stats", {})
        counts = inventory.get("counts", {})
        metric_count = len(metric_map)
        player_count = counts.get("players", 0)
        quarantine_count = stats.get("quarantine_count", 0)
        input_rows = sum(counts.values()) if counts else 0
        reports.append(
            {
                "snapshot_id": snapshot.id,
                "provider": snapshot.provider,
                "health_label": freshness_category(snapshot),
                "competitions": counts.get("competitions", 0),
                "seasons": counts.get("seasons", 0),
                "teams": counts.get("teams", 0),
                "matches": counts.get("matches", 0),
                "players": player_count,
                "player_season_records": counts.get("appearances", 0),
                "event_coverage": coverage_rows,
                "metric_rows": metric_count,
                "metric_completeness": {
                    "available_metric_keys": available_metrics,
                    "average_metrics_per_player": (
                        round(metric_count / player_count, 3) if player_count else None
                    ),
                },
                "role_level_metric_availability": role_availability,
                "identity_match_rate": stats.get("identity_match_rate"),
                "quarantine_rate": (round(quarantine_count / input_rows, 6) if input_rows else 0.0),
                "confidence_limitations": (
                    [snapshot.known_limitation] if snapshot.known_limitation else []
                ),
                "coverage_claim": "observed local snapshot only; not inferred full competition coverage",
            }
        )
    return {"snapshots": reports}


def run_summary(run: RatingRun) -> dict:
    return {
        "id": run.id,
        "run_type": run.run_type,
        "version": run.version,
        "status": run.status,
        "provider": run.provider,
        "ingestion_mode": run.ingestion_mode,
        "snapshot_fingerprint": run.snapshot_fingerprint,
        "scope": run.scope_json or {},
        "started_at": _iso(run.started_at),
        "completed_at": _iso(run.completed_at),
        "summary": run.summary_json or {},
        "error_message": run.error_message,
        "failure_details": run.failure_details_json or {},
        "replay_of_run_id": run.replay_of_run_id,
    }


def quarantine_summary(row: QuarantineRecord) -> dict:
    return {
        "id": row.id,
        "ingestion_run_id": row.ingestion_run_id,
        "source_snapshot_id": row.source_snapshot_id,
        "provider": row.provider,
        "source_name": row.source_name,
        "entity_type": row.entity_type,
        "external_id": row.external_id,
        "reason_code": row.reason_code,
        "severity": row.severity,
        "payload_fingerprint": row.payload_fingerprint,
        "diagnostic_context": row.diagnostic_context_json or {},
        "status": row.status,
        "created_at": _iso(row.created_at),
        "resolved_at": _iso(row.resolved_at),
        "replayed_at": _iso(row.replayed_at),
        "replay_run_id": row.replay_run_id,
    }


def benchmark(session: Session, *, size: int = 5000, include_recompute: bool = False) -> dict:
    adapter = GeneratedFixtureAdapter(size=size)
    input_bundle = adapter.fetch()
    started = time.perf_counter()
    result = execute_ingestion(session, adapter)
    ingest_duration = time.perf_counter() - started
    recompute_duration = None
    if include_recompute and result["status"] != "skipped_idempotent":
        started = time.perf_counter()
        recompute(session)
        recompute_duration = time.perf_counter() - started
    return {
        "input_size": size,
        "input_metric_rows": len(input_bundle.metrics),
        "ingest_duration_seconds": round(ingest_duration, 6),
        "recompute_duration_seconds": (
            round(recompute_duration, 6) if recompute_duration is not None else None
        ),
        "records_written": result["players"] + result["metrics"],
        "records_skipped": (
            size + len(input_bundle.metrics) if result["status"] == "skipped_idempotent" else 0
        ),
        "records_quarantined": result["quarantined"],
        "status": result["status"],
        "environment": "local deterministic generated fixture",
        "database_type": session.bind.dialect.name,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ScoutBoy data operations")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("providers")
    runs_parser = subparsers.add_parser("runs")
    runs_parser.add_argument("--limit", type=int, default=50)
    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("run_id", type=int)
    quarantine_parser = subparsers.add_parser("quarantine")
    quarantine_parser.add_argument("--status", default=None)
    quarantine_parser.add_argument("--limit", type=int, default=100)
    diff_parser = subparsers.add_parser("diff")
    diff_parser.add_argument("before_id", type=int)
    diff_parser.add_argument("after_id", type=int)
    subparsers.add_parser("freshness")
    subparsers.add_parser("coverage")
    benchmark_parser = subparsers.add_parser("benchmark")
    benchmark_parser.add_argument("--size", type=int, default=5000)
    benchmark_parser.add_argument("--include-recompute", action="store_true")
    args = parser.parse_args(argv)

    if args.command == "providers":
        output = {key: value.to_dict() for key, value in provider_capabilities().items()}
    else:
        with SessionLocal() as session:
            if args.command == "runs":
                rows = session.scalars(
                    select(RatingRun).order_by(RatingRun.id.desc()).limit(args.limit)
                )
                output = [run_summary(row) for row in rows]
            elif args.command == "run":
                row = session.get(RatingRun, args.run_id)
                if row is None:
                    raise ValueError("ingestion run not found")
                output = run_summary(row)
            elif args.command == "quarantine":
                statement = select(QuarantineRecord).order_by(QuarantineRecord.id.desc())
                if args.status:
                    statement = statement.where(QuarantineRecord.status == args.status)
                output = [
                    quarantine_summary(row) for row in session.scalars(statement.limit(args.limit))
                ]
            elif args.command == "diff":
                output = snapshot_diff(session, args.before_id, args.after_id)
            elif args.command == "freshness":
                output = freshness_report(session)
            elif args.command == "coverage":
                output = coverage_report(session)
            else:
                output = benchmark(
                    session, size=args.size, include_recompute=args.include_recompute
                )
    print(json.dumps(output, indent=2, sort_keys=True, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
