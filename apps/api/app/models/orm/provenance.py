from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, utcnow


class Provider(Base, TimestampMixin):
    __tablename__ = "providers"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    provider_type: Mapped[str] = mapped_column(String(40), default="event")
    license_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    attribution: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)


class ProviderIdentifier(Base, TimestampMixin):
    __tablename__ = "provider_identifiers"
    __table_args__ = (
        UniqueConstraint(
            "provider_id",
            "entity_type",
            "provider_entity_id",
            name="uq_provider_identifier",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), index=True)
    entity_type: Mapped[str] = mapped_column(String(40), index=True)
    entity_id: Mapped[int] = mapped_column(Integer, index=True)
    provider_entity_id: Mapped[str] = mapped_column(String(120), index=True)
    provider_entity_name: Mapped[Optional[str]] = mapped_column(String(240), nullable=True)
    source_snapshot_record_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("source_snapshots.id"), nullable=True, index=True
    )
    source_version: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    raw_payload_json: Mapped[dict] = mapped_column(JSON, default=dict)


class PlayerTeamSeasonRegistration(Base, TimestampMixin):
    __tablename__ = "player_team_season_registrations"
    __table_args__ = (
        UniqueConstraint(
            "player_id",
            "team_id",
            "competition_id",
            "season_id",
            "provider_id",
            name="uq_player_team_season_provider",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    competition_id: Mapped[int] = mapped_column(ForeignKey("competitions.id"), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), index=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), index=True)
    provider_registration_id: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    source_snapshot_record_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("source_snapshots.id"), nullable=True, index=True
    )
    provenance_json: Mapped[dict] = mapped_column(JSON, default=dict)


class Match(Base, TimestampMixin):
    __tablename__ = "matches"
    __table_args__ = (
        UniqueConstraint("provider_id", "provider_match_id", name="uq_provider_match"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), index=True)
    provider_match_id: Mapped[str] = mapped_column(String(120), index=True)
    competition_id: Mapped[int] = mapped_column(ForeignKey("competitions.id"), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), index=True)
    match_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    home_team_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teams.id"), nullable=True)
    away_team_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teams.id"), nullable=True)
    home_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    away_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    match_status: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    source_snapshot_record_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("source_snapshots.id"), nullable=True, index=True
    )
    raw_payload_json: Mapped[dict] = mapped_column(JSON, default=dict)


class MatchLineupAppearance(Base, TimestampMixin):
    __tablename__ = "match_lineup_appearances"
    __table_args__ = (
        UniqueConstraint("match_id", "player_id", "team_id", name="uq_match_player_team"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), index=True)
    jersey_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    position_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    position_group: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    minutes: Mapped[int] = mapped_column(Integer, default=0)
    starter: Mapped[bool] = mapped_column(Boolean, default=False)
    lineup_available: Mapped[bool] = mapped_column(Boolean, default=True)
    source_snapshot_record_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("source_snapshots.id"), nullable=True, index=True
    )
    raw_payload_json: Mapped[dict] = mapped_column(JSON, default=dict)


class Event(Base, TimestampMixin):
    __tablename__ = "events"
    __table_args__ = (
        UniqueConstraint("provider_id", "provider_event_id", name="uq_provider_event"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), index=True)
    provider_event_id: Mapped[str] = mapped_column(String(120), index=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    player_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("players.id", ondelete="SET NULL"), nullable=True, index=True
    )
    team_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("teams.id"), nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    minute: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    second: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    possession: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    location_json: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    source_snapshot_record_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("source_snapshots.id"), nullable=True, index=True
    )
    raw_payload_json: Mapped[dict] = mapped_column(JSON, default=dict)


class DataCoverage(Base, TimestampMixin):
    __tablename__ = "data_coverages"
    __table_args__ = (
        UniqueConstraint(
            "provider_id",
            "competition_id",
            "season_id",
            "source_snapshot_record_id",
            name="uq_data_coverage_snapshot",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), index=True)
    competition_id: Mapped[int] = mapped_column(ForeignKey("competitions.id"), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), index=True)
    source_snapshot_record_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("source_snapshots.id"), nullable=True, index=True
    )
    matches_covered: Mapped[int] = mapped_column(Integer, default=0)
    known_total_matches: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    events_available: Mapped[int] = mapped_column(Integer, default=0)
    lineups_available: Mapped[int] = mapped_column(Integer, default=0)
    three_sixty_available: Mapped[int] = mapped_column(Integer, default=0)
    coverage_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_match_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    confidence_json: Mapped[dict] = mapped_column(JSON, default=dict)


class PlayerEvidenceConfidence(Base, TimestampMixin):
    __tablename__ = "player_evidence_confidences"
    __table_args__ = (
        UniqueConstraint(
            "player_id",
            "competition_id",
            "season_id",
            "provider_id",
            name="uq_player_evidence_confidence",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    competition_id: Mapped[int] = mapped_column(ForeignKey("competitions.id"), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), index=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), index=True)
    source_snapshot_record_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("source_snapshots.id"), nullable=True, index=True
    )
    minutes: Mapped[int] = mapped_column(Integer, default=0)
    appearances: Mapped[int] = mapped_column(Integer, default=0)
    starts: Mapped[int] = mapped_column(Integer, default=0)
    matches_covered: Mapped[int] = mapped_column(Integer, default=0)
    known_total_matches: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    competition_coverage_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    data_recency_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sample_size_confidence: Mapped[str] = mapped_column(String(30), default="unknown")
    coverage_confidence: Mapped[str] = mapped_column(String(30), default="unknown")
    league_adjustment_confidence: Mapped[str] = mapped_column(String(30), default="low")
    role_similarity_confidence: Mapped[str] = mapped_column(String(30), default="unknown")
    overall_rating_confidence: Mapped[str] = mapped_column(String(30), default="unknown")
    explanation_json: Mapped[dict] = mapped_column(JSON, default=dict)
