from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, utcnow


class SourceSnapshot(Base, TimestampMixin):
    __tablename__ = "source_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    snapshot_key: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    provider: Mapped[str] = mapped_column(String(80), index=True)
    dataset_version: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    as_of_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    target_season: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    local_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    checksum: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    fingerprint: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    scope_json: Mapped[dict] = mapped_column(JSON, default=dict)
    source_type: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    health_label: Mapped[str] = mapped_column(String(20), default="unknown", index=True)
    known_limitation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    attribution: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    license_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    row_counts_json: Mapped[dict] = mapped_column(JSON, default=dict)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    ingested_run_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rating_runs.id"), nullable=True
    )


class PlayerUniverseMembership(Base, TimestampMixin):
    """Materialized MVP-universe membership per player-season (non-destructive filter).
    eligible=True means the player passes the U23 / attacker-midfielder / Europe / minutes
    filter for the given universe_key."""

    __tablename__ = "player_universe_memberships"
    __table_args__ = (
        UniqueConstraint("player_id", "season_id", "universe_key", name="uq_universe_membership"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), index=True)
    universe_key: Mapped[str] = mapped_column(String(60), index=True, default="mvp_u23_att_mid_eu")
    eligible: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    reasons_json: Mapped[dict] = mapped_column(JSON, default=dict)


class SimilarityVector(Base, TimestampMixin):
    __tablename__ = "similarity_vectors"

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), index=True)
    vector_type: Mapped[str] = mapped_column(String(20), index=True)  # style | quality
    vector_json: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[str] = mapped_column(String(20), index=True)


class RatingRun(Base):
    __tablename__ = "rating_runs"
    __table_args__ = (
        Index(
            "ix_ingest_provider_fingerprint_status",
            "provider",
            "snapshot_fingerprint",
            "status",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    run_type: Mapped[str] = mapped_column(String(30), index=True)  # ingest | recompute
    version: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(32), default="running", index=True)
    source_snapshot_ids_json: Mapped[list] = mapped_column(JSON, default=list)
    config_hashes_json: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    affected_players_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    provider: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, index=True)
    ingestion_mode: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    snapshot_fingerprint: Mapped[Optional[str]] = mapped_column(
        String(128), nullable=True, index=True
    )
    scope_json: Mapped[dict] = mapped_column(JSON, default=dict)
    summary_json: Mapped[dict] = mapped_column(JSON, default=dict)
    failure_details_json: Mapped[dict] = mapped_column(JSON, default=dict)
    replay_of_run_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rating_runs.id"), nullable=True, index=True
    )


class DataQualityReport(Base, TimestampMixin):
    __tablename__ = "data_quality_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_name: Mapped[str] = mapped_column(String(50), index=True)
    run_id: Mapped[Optional[int]] = mapped_column(ForeignKey("rating_runs.id"), nullable=True)
    report_json: Mapped[dict] = mapped_column(JSON, default=dict)


class QuarantineRecord(Base, TimestampMixin):
    """Safe diagnostic record for a rejected provider row; full payloads are not retained."""

    __tablename__ = "quarantine_records"
    __table_args__ = (
        UniqueConstraint(
            "provider",
            "snapshot_fingerprint",
            "entity_type",
            "external_id",
            "reason_code",
            "payload_fingerprint",
            name="uq_quarantine_source_record",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    ingestion_run_id: Mapped[int] = mapped_column(
        ForeignKey("rating_runs.id", ondelete="CASCADE"), index=True
    )
    source_snapshot_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("source_snapshots.id"), nullable=True, index=True
    )
    provider: Mapped[str] = mapped_column(String(80), index=True)
    source_name: Mapped[str] = mapped_column(String(80), index=True)
    snapshot_fingerprint: Mapped[str] = mapped_column(String(128), index=True)
    entity_type: Mapped[str] = mapped_column(String(40), index=True)
    external_id: Mapped[Optional[str]] = mapped_column(String(160), nullable=True, index=True)
    reason_code: Mapped[str] = mapped_column(String(80), index=True)
    severity: Mapped[str] = mapped_column(String(20), default="warning", index=True)
    payload_fingerprint: Mapped[str] = mapped_column(String(128))
    diagnostic_context_json: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    replayed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    replay_run_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rating_runs.id"), nullable=True, index=True
    )
