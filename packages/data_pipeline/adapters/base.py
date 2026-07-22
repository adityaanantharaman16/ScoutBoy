"""Source adapter port.

Every data source maps its raw records into these canonical dataclasses. Provider
-specific field names must NOT leak past the adapter — the rest of the pipeline and
app only ever see canonical records. Source-specific ids live on CanonicalPlayer and
are stored in player_source_ids so more sources can be added without duplicating
players.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional

from scoutboy_shared import METRIC_REGISTRY

PROVIDER_TYPES = frozenset(
    {"fixture", "market_identity", "basic_statistics", "event", "tracking", "commercial"}
)
INGESTION_MODES = frozenset({"local_snapshot", "file_import", "api_ready"})
SUPPORTED_ENTITIES = frozenset(
    {
        "players",
        "teams",
        "competitions",
        "seasons",
        "appearances",
        "lineups",
        "matches",
        "events",
        "valuations",
        "transfers",
    }
)
COVERAGE_DIMENSIONS = frozenset(
    {"competition", "season", "team", "match", "player", "event_location"}
)
METRIC_FAMILIES = frozenset({"performance", "market", "identity", "context", "event"})


@dataclass(frozen=True)
class ProviderCapabilities:
    """Provider-neutral declaration consumed by validation and operator surfaces."""

    provider_id: str
    display_name: str
    provider_type: str
    ingestion_mode: str
    credentials_required: bool
    supported_entities: frozenset[str] = frozenset()
    supported_metric_keys: frozenset[str] = frozenset()
    supported_metric_families: frozenset[str] = frozenset()
    coverage_dimensions: frozenset[str] = frozenset()
    freshness_semantics: str = "unknown"
    attribution_required: bool = False
    attribution: Optional[str] = None
    license_url: Optional[str] = None
    known_limitations: tuple[str, ...] = ()
    fixture_data: bool = False
    metric_only: bool = False
    credential_env_vars: tuple[str, ...] = ()

    def validate(self) -> list[str]:
        errors: list[str] = []
        if not self.provider_id or self.provider_id != self.provider_id.strip().lower():
            errors.append("provider_id must be a deterministic lowercase slug")
        if not self.display_name.strip():
            errors.append("display_name is required")
        if self.provider_type not in PROVIDER_TYPES:
            errors.append(f"unsupported provider_type: {self.provider_type}")
        if self.ingestion_mode not in INGESTION_MODES:
            errors.append(f"unsupported ingestion_mode: {self.ingestion_mode}")
        unknown_entities = self.supported_entities - SUPPORTED_ENTITIES
        if unknown_entities:
            errors.append(f"unsupported entities: {sorted(unknown_entities)}")
        unknown_dimensions = self.coverage_dimensions - COVERAGE_DIMENSIONS
        if unknown_dimensions:
            errors.append(f"unsupported coverage dimensions: {sorted(unknown_dimensions)}")
        unknown_families = self.supported_metric_families - METRIC_FAMILIES
        if unknown_families:
            errors.append(f"unsupported metric families: {sorted(unknown_families)}")
        allowed_metric_keys = set(METRIC_REGISTRY) | {
            "public_value_eur",
            "contract_until",
            "international_caps",
            "hype_index",
            "recent_form_index",
        }
        unknown_metrics = self.supported_metric_keys - allowed_metric_keys
        if unknown_metrics:
            errors.append(f"unknown canonical metric keys: {sorted(unknown_metrics)}")
        if self.credentials_required and not self.credential_env_vars:
            errors.append("credential-required providers must declare credential_env_vars")
        if self.attribution_required and not self.attribution:
            errors.append("attribution_required providers must provide attribution text")
        return errors

    def to_dict(self) -> dict:
        return {
            "provider_id": self.provider_id,
            "display_name": self.display_name,
            "provider_type": self.provider_type,
            "ingestion_mode": self.ingestion_mode,
            "credentials_required": self.credentials_required,
            "credential_env_vars": list(self.credential_env_vars),
            "supported_entities": sorted(self.supported_entities),
            "supported_metric_keys": sorted(self.supported_metric_keys),
            "supported_metric_families": sorted(self.supported_metric_families),
            "coverage_dimensions": sorted(self.coverage_dimensions),
            "freshness_semantics": self.freshness_semantics,
            "attribution_required": self.attribution_required,
            "attribution": self.attribution,
            "license_url": self.license_url,
            "known_limitations": list(self.known_limitations),
            "fixture_data": self.fixture_data,
            "metric_only": self.metric_only,
        }


@dataclass
class CanonicalCompetition:
    slug: str
    name: str
    country: Optional[str] = None
    competition_type: Optional[str] = None
    tier: Optional[int] = None
    is_european: bool = True


@dataclass
class CanonicalTeam:
    slug: str
    name: str
    competition_slug: str
    country: Optional[str] = None
    strength_tier: Optional[str] = None


@dataclass
class CanonicalPlayer:
    source_name: str
    source_player_id: str
    canonical_name: str
    birth_date: Optional[str] = None  # ISO YYYY-MM-DD
    nationality: Optional[str] = None
    preferred_foot: Optional[str] = None
    height_cm: Optional[int] = None
    primary_position: Optional[str] = None
    secondary_positions: list = field(default_factory=list)
    source_url: Optional[str] = None
    raw_name: Optional[str] = None


@dataclass
class CanonicalAppearance:
    source_player_id: str
    team_slug: str
    competition_slug: str
    season_label: str
    minutes: int = 0
    appearances: int = 0
    starts: int = 0
    position_group: Optional[str] = None
    role_usage_raw: Optional[float] = None


@dataclass
class CanonicalMetric:
    source_player_id: str
    season_label: str
    metric_name: str
    metric_value: Optional[float]
    unit: Optional[str] = None
    raw_payload: dict = field(default_factory=dict)
    # Identity source used to resolve this metric's player via player_source_ids.
    # Defaults to the bundle's source_name when None (set by metric-only sources like
    # the performance CSV, whose rows carry their own identity source_name).
    id_source_name: Optional[str] = None
    metric_provider: Optional[str] = None
    scope: Optional[str] = None


@dataclass
class CanonicalSeason:
    label: str
    is_current: bool = False
    start_date: Optional[str] = None
    end_date: Optional[str] = None


@dataclass
class CanonicalProvider:
    slug: str
    name: str
    provider_type: str = "event"
    license_url: Optional[str] = None
    attribution: Optional[str] = None


@dataclass
class CanonicalProviderIdentifier:
    provider_slug: str
    entity_type: str
    scoutboy_key: str
    provider_entity_id: str
    provider_entity_name: Optional[str] = None
    raw_payload: dict = field(default_factory=dict)


@dataclass
class CanonicalRegistration:
    source_player_id: str
    team_slug: str
    competition_slug: str
    season_label: str
    provider_slug: str
    provider_registration_id: Optional[str] = None
    provenance: dict = field(default_factory=dict)


@dataclass
class CanonicalMatch:
    provider_slug: str
    provider_match_id: str
    competition_slug: str
    season_label: str
    home_team_slug: Optional[str] = None
    away_team_slug: Optional[str] = None
    match_date: Optional[str] = None
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    match_status: Optional[str] = None
    raw_payload: dict = field(default_factory=dict)


@dataclass
class CanonicalLineupAppearance:
    provider_slug: str
    provider_match_id: str
    source_player_id: str
    team_slug: str
    jersey_number: Optional[int] = None
    position_name: Optional[str] = None
    position_group: Optional[str] = None
    minutes: int = 0
    starter: bool = False
    lineup_available: bool = True
    raw_payload: dict = field(default_factory=dict)


@dataclass
class CanonicalEvent:
    provider_slug: str
    provider_event_id: str
    provider_match_id: str
    source_player_id: Optional[str]
    team_slug: Optional[str]
    event_type: str
    minute: Optional[int] = None
    second: Optional[int] = None
    possession: Optional[int] = None
    location: Optional[list] = None
    raw_payload: dict = field(default_factory=dict)


@dataclass
class CanonicalDataCoverage:
    provider_slug: str
    competition_slug: str
    season_label: str
    matches_covered: int
    known_total_matches: Optional[int] = None
    events_available: int = 0
    lineups_available: int = 0
    three_sixty_available: int = 0
    coverage_pct: Optional[float] = None
    last_match_date: Optional[str] = None
    confidence: dict = field(default_factory=dict)


@dataclass
class CanonicalPlayerEvidence:
    provider_slug: str
    source_player_id: str
    competition_slug: str
    season_label: str
    minutes: int
    appearances: int
    starts: int
    matches_covered: int
    known_total_matches: Optional[int] = None
    competition_coverage_pct: Optional[float] = None
    data_recency_days: Optional[int] = None
    sample_size_confidence: str = "unknown"
    coverage_confidence: str = "unknown"
    league_adjustment_confidence: str = "low"
    role_similarity_confidence: str = "unknown"
    overall_rating_confidence: str = "unknown"
    explanation: dict = field(default_factory=dict)


@dataclass
class IngestBundle:
    source_name: str
    source_snapshot_id: str
    providers: list[CanonicalProvider] = field(default_factory=list)
    seasons: list[CanonicalSeason] = field(default_factory=list)
    competitions: list[CanonicalCompetition] = field(default_factory=list)
    teams: list[CanonicalTeam] = field(default_factory=list)
    players: list[CanonicalPlayer] = field(default_factory=list)
    appearances: list[CanonicalAppearance] = field(default_factory=list)
    metrics: list[CanonicalMetric] = field(default_factory=list)
    provider_identifiers: list[CanonicalProviderIdentifier] = field(default_factory=list)
    registrations: list[CanonicalRegistration] = field(default_factory=list)
    matches: list[CanonicalMatch] = field(default_factory=list)
    lineup_appearances: list[CanonicalLineupAppearance] = field(default_factory=list)
    events: list[CanonicalEvent] = field(default_factory=list)
    coverages: list[CanonicalDataCoverage] = field(default_factory=list)
    player_evidence: list[CanonicalPlayerEvidence] = field(default_factory=list)
    # Adapter-level quality findings (e.g. rows an adapter quarantined during parsing).
    # Merged into the data-quality report by the ingest job.
    adapter_warnings: list = field(default_factory=list)
    # Optional first-class provenance for immutable external snapshots. The ingest job
    # upserts this into source_snapshots and links persisted observations to it.
    snapshot_metadata: dict = field(default_factory=dict)
    # Rejected source records represented without retaining full provider payloads.
    quarantine_candidates: list = field(default_factory=list)


class SourceAdapter(ABC):
    """Port implemented by every data source."""

    name: str = "base"
    capabilities: ProviderCapabilities

    def validate_contract(self) -> list[str]:
        if not hasattr(self, "capabilities"):
            return ["adapter does not declare capabilities"]
        errors = self.capabilities.validate()
        if self.name != self.capabilities.provider_id:
            errors.append("adapter name must match capability provider_id")
        return errors

    @abstractmethod
    def fetch(self) -> IngestBundle:
        """Return a fully-canonical bundle. Adapters own all source-specific parsing."""
        raise NotImplementedError
