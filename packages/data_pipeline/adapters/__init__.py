from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Optional

from .base import (
    CanonicalAppearance,
    CanonicalCompetition,
    CanonicalMetric,
    CanonicalPlayer,
    CanonicalSeason,
    CanonicalTeam,
    IngestBundle,
    SourceAdapter,
)
from .csv_adapter import PerformanceCsvAdapter
from .sample_adapter import SampleAdapter
from .statsbomb_pilot import StatsBombPilotAdapter
from .transfermarkt_adapter import TransfermarktAdapter

# Sources that need no external input path.
ADAPTERS = {"sample": SampleAdapter}

# Sources that require an --input-path (external data file/dir).
PATH_ADAPTERS = {"transfermarkt", "performance_csv", "statsbomb_pilot"}


def get_adapter(
    source: str,
    input_path: Optional[str] = None,
    *,
    target_competition_id: Optional[str] = None,
    target_season: Optional[int] = None,
    as_of_date: Optional[date] = None,
) -> SourceAdapter:
    """Resolve a source name (+ optional input path) to an adapter instance."""
    if source == "sample":
        return SampleAdapter()
    if source == "transfermarkt":
        if not input_path:
            raise ValueError("--input-path <csv_dir> is required for source 'transfermarkt'")
        kwargs = {}
        if target_competition_id is not None:
            kwargs["target_competition_id"] = target_competition_id
        if target_season is not None:
            kwargs["target_season"] = target_season
        if as_of_date is not None:
            kwargs["as_of_date"] = as_of_date
        return TransfermarktAdapter(csv_dir=Path(input_path), **kwargs)
    if source == "performance_csv":
        if not input_path:
            raise ValueError("--input-path <csv_file> is required for source 'performance_csv'")
        return PerformanceCsvAdapter(csv_path=Path(input_path))
    if source == "statsbomb_pilot":
        if not input_path:
            raise ValueError("--input-path <snapshot_dir> is required for source 'statsbomb_pilot'")
        root = Path(__file__).resolve().parents[3]
        return StatsBombPilotAdapter(
            snapshot_dir=Path(input_path),
            transfermarkt_dir=root / "data/raw/transfermarkt",
            overrides_path=root / "configs/identity/statsbomb_transfermarkt_overrides_v1.yaml",
        )
    raise ValueError(
        f"Unknown source '{source}'. Available: sample, transfermarkt, performance_csv, statsbomb_pilot"
    )


__all__ = [
    "SourceAdapter",
    "IngestBundle",
    "CanonicalPlayer",
    "CanonicalTeam",
    "CanonicalCompetition",
    "CanonicalAppearance",
    "CanonicalMetric",
    "CanonicalSeason",
    "SampleAdapter",
    "TransfermarktAdapter",
    "PerformanceCsvAdapter",
    "StatsBombPilotAdapter",
    "get_adapter",
    "ADAPTERS",
    "PATH_ADAPTERS",
]
