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


class SourceAdapter(ABC):
    """Port implemented by every data source."""

    name: str = "base"

    @abstractmethod
    def fetch(self) -> IngestBundle:
        """Return a fully-canonical bundle. Adapters own all source-specific parsing."""
        raise NotImplementedError
