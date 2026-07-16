"""CSV performance-metrics adapter (Phase 3).

Not every public dataset exposes every RoleFit metric, so manually-provided performance
metrics arrive via a strict long-format CSV contract
(`data/contracts/player_season_metrics_v1.csv`):

    source_name, source_player_id, season, competition_name, team_name,
    metric_name, metric_value, unit, minutes, position_group, source_snapshot_id
    [optional: source_url, provider_player_name, provider_team_id,
     provider_competition_id, match_scope, notes]

`PerformanceCsvAdapter` validates the contract and emits a metric-only IngestBundle:
each row is matched to a canonical player at ingest time via (source_name,
source_player_id) against player_source_ids. Invalid rows (unknown metric name,
unparseable / invalid-negative value) are quarantined into `adapter_warnings` rather
than crashing the run; unknown player ids are quarantined later by the ingest job.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Optional

from scoutboy_shared import metric_meta, resolve_metric

from .base import CanonicalMetric, CanonicalSeason, IngestBundle, SourceAdapter

REQUIRED_COLUMNS = (
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
OPTIONAL_COLUMNS = (
    "metric_provider",
    "scope",
    "source_url",
    "provider_player_name",
    "provider_team_id",
    "provider_competition_id",
    "match_scope",
    "notes",
)

SOURCE_NAME = "performance_csv"


class CsvContractError(ValueError):
    """Raised when the CSV is missing required contract columns."""


def read_metrics_csv(path: Path, source_name: str = "csv") -> list[CanonicalMetric]:
    """Lightweight long-format reader used by the synthetic sample adapter."""
    out: list[CanonicalMetric] = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            raw = row.get("metric_value", "")
            value: Optional[float] = None
            if raw not in (None, ""):
                try:
                    value = float(raw)
                except ValueError:
                    value = None
            out.append(
                CanonicalMetric(
                    source_player_id=row["source_player_id"],
                    season_label=row["season"],
                    metric_name=row["metric_name"],
                    metric_value=value,
                    unit=row.get("unit"),
                    raw_payload={"source": source_name},
                )
            )
    return out


def _allows_negative(metric_name: str) -> bool:
    meta = metric_meta(metric_name)
    # Only finishing-vs-xG style differentials are legitimately negative.
    return metric_meta("goals_minus_xg_per90") is meta


class PerformanceCsvAdapter(SourceAdapter):
    name = SOURCE_NAME

    def __init__(self, csv_path: Path):
        self.csv_path = Path(csv_path)

    def fetch(self) -> IngestBundle:
        if not self.csv_path.exists():
            raise FileNotFoundError(f"Performance CSV not found: {self.csv_path}")

        with open(self.csv_path, newline="") as f:
            reader = csv.DictReader(f)
            header = reader.fieldnames or []
            missing = [c for c in REQUIRED_COLUMNS if c not in header]
            if missing:
                raise CsvContractError(
                    f"Performance CSV missing required columns: {missing}. "
                    f"See docs/data_contracts/player_season_metrics_v1.md"
                )
            rows = list(reader)

        snapshots = [r.get("source_snapshot_id") for r in rows if r.get("source_snapshot_id")]
        bundle = IngestBundle(
            source_name=SOURCE_NAME,
            source_snapshot_id=snapshots[0] if snapshots else "performance_csv",
        )

        invalid_metric_names: set = set()
        invalid_values = 0
        invalid_negative = 0
        seasons: set = set()

        for r in rows:
            metric_name = (r.get("metric_name") or "").strip()
            canonical = resolve_metric(metric_name)
            if canonical is None:
                invalid_metric_names.add(metric_name)
                continue
            raw_val = (r.get("metric_value") or "").strip()
            try:
                value = float(raw_val)
            except ValueError:
                invalid_values += 1
                continue
            if value < 0 and not _allows_negative(canonical):
                invalid_negative += 1
                continue

            season = (r.get("season") or "").strip()
            seasons.add(season)
            bundle.metrics.append(
                CanonicalMetric(
                    source_player_id=(r.get("source_player_id") or "").strip(),
                    season_label=season,
                    metric_name=canonical,
                    metric_value=value,
                    unit=(r.get("unit") or None),
                    id_source_name=(r.get("source_name") or "").strip() or None,
                    raw_payload={
                        "competition_name": r.get("competition_name"),
                        "team_name": r.get("team_name"),
                        "minutes": r.get("minutes"),
                        "position_group": r.get("position_group"),
                        "source_url": r.get("source_url"),
                        "match_scope": r.get("match_scope"),
                        "notes": r.get("notes"),
                        "snapshot": r.get("source_snapshot_id"),
                    },
                    metric_provider=(r.get("metric_provider") or SOURCE_NAME).strip(),
                    scope=(r.get("scope") or r.get("match_scope") or "").strip() or None,
                )
            )

        bundle.seasons = [CanonicalSeason(label=s) for s in sorted(seasons) if s]
        bundle.adapter_warnings = [
            {
                "check": "invalid_metric_names",
                "severity": "warn" if invalid_metric_names else "ok",
                "count": len(invalid_metric_names),
                "details": sorted(invalid_metric_names)[:10],
            },
            {
                "check": "invalid_metric_values",
                "severity": "warn" if invalid_values else "ok",
                "count": invalid_values,
                "details": [],
            },
            {
                "check": "invalid_negative_metrics",
                "severity": "warn" if invalid_negative else "ok",
                "count": invalid_negative,
                "details": [],
            },
        ]
        return bundle
