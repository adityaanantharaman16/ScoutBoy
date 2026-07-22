"""Local fixture proving the commercial-provider adapter boundary without network access."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from rolefit.paths import repo_root

from .base import (
    CanonicalAppearance,
    CanonicalCompetition,
    CanonicalMetric,
    CanonicalPlayer,
    CanonicalProvider,
    CanonicalSeason,
    CanonicalTeam,
    IngestBundle,
    ProviderCapabilities,
    SourceAdapter,
)

SOURCE_NAME = "mock_commercial_provider"
TOKEN_ENV = "SCOUTBOY_MOCK_COMMERCIAL_TOKEN"


class MockCommercialProviderAdapter(SourceAdapter):
    name = SOURCE_NAME
    capabilities = ProviderCapabilities(
        provider_id=SOURCE_NAME,
        display_name="Mock commercial provider (fixture)",
        provider_type="commercial",
        ingestion_mode="api_ready",
        credentials_required=True,
        credential_env_vars=(TOKEN_ENV,),
        supported_entities=frozenset(
            {"players", "teams", "competitions", "seasons", "appearances"}
        ),
        supported_metric_families=frozenset({"performance"}),
        coverage_dimensions=frozenset({"competition", "season", "team", "player"}),
        freshness_semantics="fixture as-of date and version",
        attribution_required=True,
        attribution="ScoutBoy mock commercial provider — fixture/demo data only",
        known_limitations=(
            "Local demo fixture, not a real vendor and never suitable for scouting claims.",
            "No network client is implemented.",
        ),
        fixture_data=True,
    )

    def __init__(self, fixture_path: Path | None = None, *, credential_required_mode: bool = False):
        self.fixture_path = fixture_path or (
            repo_root() / "data" / "sample" / "mock_commercial_provider.json"
        )
        self.credential_required_mode = credential_required_mode

    def fetch(self) -> IngestBundle:
        if self.credential_required_mode and not os.environ.get(TOKEN_ENV):
            raise ValueError(f"{TOKEN_ENV} is required in credential-required mode")
        raw_bytes = self.fixture_path.read_bytes()
        payload = json.loads(raw_bytes)
        season = payload["season"]
        version = payload["snapshot_version"]
        bundle = IngestBundle(
            source_name=SOURCE_NAME,
            source_snapshot_id=f"{SOURCE_NAME}@{version}",
            providers=[
                CanonicalProvider(
                    slug=SOURCE_NAME,
                    name="Mock commercial provider (fixture)",
                    provider_type="commercial",
                    attribution=self.capabilities.attribution,
                )
            ],
            seasons=[CanonicalSeason(label=season)],
            competitions=[
                CanonicalCompetition(
                    slug="mock_league", name="Mock League (Fixture)", country="Testland"
                )
            ],
            teams=[
                CanonicalTeam(
                    slug="mock_city",
                    name="Mock City (Fixture)",
                    competition_slug="mock_league",
                )
            ],
            snapshot_metadata={
                "provider": SOURCE_NAME,
                "dataset_version": version,
                "as_of_date": payload["as_of_date"],
                "target_season": season,
                "checksum": hashlib.sha256(raw_bytes).hexdigest(),
                "local_path": str(self.fixture_path),
                "metadata": {"fixture_data": True, "demo_only": True},
            },
        )
        for row in payload["players"]:
            bundle.players.append(
                CanonicalPlayer(
                    source_name=SOURCE_NAME,
                    source_player_id=row["id"],
                    canonical_name=row["name"],
                    birth_date=row.get("birth_date"),
                    nationality=row.get("nationality"),
                    primary_position=row.get("position"),
                    raw_name=row["name"],
                )
            )
            bundle.appearances.append(
                CanonicalAppearance(
                    source_player_id=row["id"],
                    team_slug=row["team"],
                    competition_slug="mock_league",
                    season_label=season,
                    minutes=int(row["minutes"]),
                    appearances=10,
                    starts=10,
                    position_group="ATT" if row["position"] in {"CF", "ST", "LW", "RW"} else "MID",
                )
            )
            for metric_name, value in sorted(row["metrics"].items()):
                bundle.metrics.append(
                    CanonicalMetric(
                        source_player_id=row["id"],
                        season_label=season,
                        metric_name=metric_name,
                        metric_value=float(value),
                        metric_provider=SOURCE_NAME,
                        raw_payload={"fixture_data": True},
                    )
                )
        bundle.snapshot_metadata["row_counts"] = {
            "players": len(bundle.players),
            "metrics": len(bundle.metrics),
        }
        return bundle
