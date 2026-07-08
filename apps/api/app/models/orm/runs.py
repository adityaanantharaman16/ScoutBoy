from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, utcnow


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

    id: Mapped[int] = mapped_column(primary_key=True)
    run_type: Mapped[str] = mapped_column(String(30), index=True)  # ingest | recompute
    version: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="running", index=True)
    source_snapshot_ids_json: Mapped[list] = mapped_column(JSON, default=list)
    config_hashes_json: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    affected_players_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


class DataQualityReport(Base, TimestampMixin):
    __tablename__ = "data_quality_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_name: Mapped[str] = mapped_column(String(50), index=True)
    run_id: Mapped[Optional[int]] = mapped_column(ForeignKey("rating_runs.id"), nullable=True)
    report_json: Mapped[dict] = mapped_column(JSON, default=dict)
