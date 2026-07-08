from __future__ import annotations

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
from .transfermarkt_adapter import TransfermarktAdapter

# Sources that need no external input path.
ADAPTERS = {"sample": SampleAdapter}

# Sources that require an --input-path (external data file/dir).
PATH_ADAPTERS = {"transfermarkt", "performance_csv"}


def get_adapter(source: str, input_path: Optional[str] = None) -> SourceAdapter:
    """Resolve a source name (+ optional input path) to an adapter instance."""
    if source == "sample":
        return SampleAdapter()
    if source == "transfermarkt":
        if not input_path:
            raise ValueError("--input-path <csv_dir> is required for source 'transfermarkt'")
        return TransfermarktAdapter(csv_dir=Path(input_path))
    if source == "performance_csv":
        if not input_path:
            raise ValueError("--input-path <csv_file> is required for source 'performance_csv'")
        return PerformanceCsvAdapter(csv_path=Path(input_path))
    raise ValueError(
        f"Unknown source '{source}'. Available: sample, transfermarkt, performance_csv"
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
    "get_adapter",
    "ADAPTERS",
    "PATH_ADAPTERS",
]
