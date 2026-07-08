"""Sample fixture adapter (Phase 1).

Reads the synthetic bundle in data/sample/ (players.json + sample_metrics.csv) and
maps it into canonical records. Market inputs (public value, contract, caps, hype)
are emitted as CanonicalMetric rows so they flow through the same raw-metric storage
as performance metrics.
"""

from __future__ import annotations

import json
from pathlib import Path

from rolefit.paths import repo_root

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
from .csv_adapter import read_metrics_csv

SOURCE_NAME = "sample"


class SampleAdapter(SourceAdapter):
    name = SOURCE_NAME

    def __init__(self, data_dir: Path | None = None):
        self.data_dir = data_dir or (repo_root() / "data" / "sample")

    def fetch(self) -> IngestBundle:
        with open(self.data_dir / "players.json") as f:
            data = json.load(f)

        season_label = data["season"]
        bundle = IngestBundle(
            source_name=SOURCE_NAME,
            source_snapshot_id=f"sample@{season_label}",
            seasons=[
                CanonicalSeason(
                    label=season_label,
                    is_current=True,
                    start_date="2023-08-01",
                    end_date="2024-05-31",
                )
            ],
        )

        for slug, comp in data["leagues"].items():
            bundle.competitions.append(
                CanonicalCompetition(
                    slug=slug,
                    name=comp["name"],
                    country=comp["country"],
                    competition_type=comp["competition_type"],
                    tier=comp["tier"],
                    is_european=comp["is_european"],
                )
            )
        for slug, club in data["clubs"].items():
            bundle.teams.append(
                CanonicalTeam(
                    slug=slug, name=club["name"], competition_slug=club["competition_slug"]
                )
            )

        for p in data["players"]:
            bundle.players.append(
                CanonicalPlayer(
                    source_name=SOURCE_NAME,
                    source_player_id=p["source_player_id"],
                    canonical_name=p["canonical_name"],
                    birth_date=p["birth_date"],
                    nationality=p["nationality"],
                    preferred_foot=p["preferred_foot"],
                    height_cm=p["height_cm"],
                    primary_position=p["primary_position"],
                    secondary_positions=p.get("secondary_positions", []),
                    raw_name=p["canonical_name"],
                )
            )
            bundle.appearances.append(
                CanonicalAppearance(
                    source_player_id=p["source_player_id"],
                    team_slug=p["club_slug"],
                    competition_slug=p["competition_slug"],
                    season_label=season_label,
                    minutes=p["minutes"],
                    appearances=p["appearances"],
                    starts=p["starts"],
                    position_group=p["position_group"],
                )
            )
            # market inputs -> raw metrics
            m = p["market"]
            for name, value, unit in [
                ("public_value_eur", m.get("public_value_eur"), "eur"),
                ("contract_until", m.get("contract_until"), "year"),
                ("international_caps", m.get("international_caps"), "count"),
                ("hype_index", m.get("hype_index"), "index"),
            ]:
                if value is not None:
                    bundle.metrics.append(
                        CanonicalMetric(
                            source_player_id=p["source_player_id"],
                            season_label=season_label,
                            metric_name=name,
                            metric_value=float(value),
                            unit=unit,
                        )
                    )

        # performance metrics from the CSV
        bundle.metrics.extend(
            read_metrics_csv(self.data_dir / "sample_metrics.csv", source_name=SOURCE_NAME)
        )
        return bundle
