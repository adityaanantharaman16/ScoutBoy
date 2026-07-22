"""Deterministic high-volume fixture used only for batching and benchmark validation."""

from __future__ import annotations

from .base import (
    CanonicalAppearance,
    CanonicalCompetition,
    CanonicalMetric,
    CanonicalPlayer,
    CanonicalSeason,
    CanonicalTeam,
    IngestBundle,
    ProviderCapabilities,
    SourceAdapter,
)

SOURCE_NAME = "generated_fixture"


class GeneratedFixtureAdapter(SourceAdapter):
    name = SOURCE_NAME
    capabilities = ProviderCapabilities(
        provider_id=SOURCE_NAME,
        display_name="Generated scale fixture",
        provider_type="fixture",
        ingestion_mode="local_snapshot",
        credentials_required=False,
        supported_entities=frozenset(
            {"players", "teams", "competitions", "seasons", "appearances"}
        ),
        supported_metric_families=frozenset({"performance"}),
        coverage_dimensions=frozenset({"competition", "season", "team", "player"}),
        freshness_semantics="deterministic generator version",
        known_limitations=("Generated data for performance testing only.",),
        fixture_data=True,
    )

    def __init__(self, size: int = 5000):
        if size < 1:
            raise ValueError("generated fixture size must be positive")
        self.size = size

    def fetch(self) -> IngestBundle:
        season = "2023/24"
        bundle = IngestBundle(
            source_name=SOURCE_NAME,
            source_snapshot_id=f"generated_fixture@v1:{self.size}",
            seasons=[CanonicalSeason(label=season)],
            competitions=[CanonicalCompetition(slug="generated_league", name="Generated League")],
            teams=[
                CanonicalTeam(
                    slug="generated_team",
                    name="Generated Team",
                    competition_slug="generated_league",
                )
            ],
            snapshot_metadata={
                "provider": SOURCE_NAME,
                "dataset_version": "generator-v1",
                "target_season": season,
                "row_counts": {"player_seasons": self.size, "metrics": self.size * 5},
                "metadata": {"fixture_data": True, "generated": True},
            },
        )
        metric_names = (
            "non_penalty_xg_per90",
            "shots_per90",
            "progressive_carries_per90",
            "progressive_passes_per90",
            "pass_completion_pct",
        )
        for index in range(self.size):
            source_id = f"generated-{index:06d}"
            position = "CF" if index % 2 == 0 else "CM"
            bundle.players.append(
                CanonicalPlayer(
                    source_name=SOURCE_NAME,
                    source_player_id=source_id,
                    canonical_name=f"Generated Player {index:06d}",
                    birth_date=f"2002-{(index % 12) + 1:02d}-{(index % 27) + 1:02d}",
                    primary_position=position,
                )
            )
            bundle.appearances.append(
                CanonicalAppearance(
                    source_player_id=source_id,
                    team_slug="generated_team",
                    competition_slug="generated_league",
                    season_label=season,
                    minutes=900 + index % 900,
                    appearances=20,
                    starts=10,
                    position_group="ATT" if position == "CF" else "MID",
                )
            )
            values = (
                0.1 + index % 50 / 100,
                1 + index % 40 / 10,
                1 + index % 60 / 10,
                1 + index % 70 / 10,
                70 + index % 25,
            )
            for metric_name, value in zip(metric_names, values):
                bundle.metrics.append(
                    CanonicalMetric(
                        source_player_id=source_id,
                        season_label=season,
                        metric_name=metric_name,
                        metric_value=float(value),
                        raw_payload={"generated": True},
                    )
                )
        return bundle
