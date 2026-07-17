from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Optional

from .base import (
    CanonicalAppearance,
    CanonicalCompetition,
    CanonicalDataCoverage,
    CanonicalEvent,
    CanonicalLineupAppearance,
    CanonicalMatch,
    CanonicalMetric,
    CanonicalPlayer,
    CanonicalPlayerEvidence,
    CanonicalProvider,
    CanonicalProviderIdentifier,
    CanonicalRegistration,
    CanonicalSeason,
    CanonicalTeam,
    IngestBundle,
    SourceAdapter,
)
from .csv_adapter import PerformanceCsvAdapter
from .sample_adapter import SampleAdapter
from .statsbomb_open_data import StatsBombOpenDataAdapter
from .statsbomb_pilot import StatsBombPilotAdapter
from .transfermarkt_adapter import TransfermarktAdapter

# Sources that need no external input path.
ADAPTERS = {"sample": SampleAdapter}

# Sources that require an --input-path (external data file/dir).
PATH_ADAPTERS = {"transfermarkt", "performance_csv", "statsbomb_pilot", "statsbomb_open_data"}


def get_adapter(
    source: str,
    input_path: Optional[str] = None,
    *,
    target_competition_id: Optional[str] = None,
    target_season: Optional[int] = None,
    statsbomb_season_ids: Optional[list[int]] = None,
    recent_seasons: Optional[int] = None,
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
    if source == "statsbomb_open_data":
        if not input_path:
            raise ValueError(
                "--input-path <statsbomb_open_data_dir> is required for source 'statsbomb_open_data'"
            )
        return StatsBombOpenDataAdapter(
            root_dir=Path(input_path),
            competition_ids=(
                [int(target_competition_id)]
                if target_competition_id and str(target_competition_id).isdigit()
                else None
            ),
            season_ids=statsbomb_season_ids,
            recent_seasons=2 if recent_seasons is None else recent_seasons,
            as_of_date=as_of_date,
        )
    raise ValueError(
        f"Unknown source '{source}'. Available: sample, transfermarkt, performance_csv, statsbomb_pilot, statsbomb_open_data"
    )


__all__ = [
    "SourceAdapter",
    "IngestBundle",
    "CanonicalPlayer",
    "CanonicalTeam",
    "CanonicalCompetition",
    "CanonicalProvider",
    "CanonicalProviderIdentifier",
    "CanonicalRegistration",
    "CanonicalMatch",
    "CanonicalLineupAppearance",
    "CanonicalEvent",
    "CanonicalDataCoverage",
    "CanonicalPlayerEvidence",
    "CanonicalAppearance",
    "CanonicalMetric",
    "CanonicalSeason",
    "SampleAdapter",
    "TransfermarktAdapter",
    "PerformanceCsvAdapter",
    "StatsBombPilotAdapter",
    "StatsBombOpenDataAdapter",
    "get_adapter",
    "ADAPTERS",
    "PATH_ADAPTERS",
]
