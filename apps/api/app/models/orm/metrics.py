from __future__ import annotations

from typing import Optional

from sqlalchemy import JSON, Float, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class PlayerMetricRaw(Base, TimestampMixin):
    __tablename__ = "player_metrics_raw"
    __table_args__ = (
        # Avoid exact-duplicate metric rows for the same player/source/season/metric/snapshot.
        Index(
            "uq_metric_raw_dedupe",
            "player_id",
            "source_name",
            "season_id",
            "metric_name",
            "source_snapshot_id",
            unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    source_name: Mapped[str] = mapped_column(String(50), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), index=True)
    metric_name: Mapped[str] = mapped_column(String(80), index=True)
    metric_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    unit: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    raw_payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    source_snapshot_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    source_snapshot_record_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("source_snapshots.id"), nullable=True, index=True
    )
    metric_provider: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    scope: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)


class PlayerMetricNormalized(Base, TimestampMixin):
    __tablename__ = "player_metrics_normalized"
    __table_args__ = (
        Index(
            "ix_metric_normalized_player_season_metric",
            "player_id",
            "season_id",
            "metric_name",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), index=True)
    peer_group: Mapped[str] = mapped_column(String(20), index=True)
    metric_name: Mapped[str] = mapped_column(String(80), index=True)
    per90_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    percentile: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    z_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    confidence: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)


class ContextAdjustment(Base, TimestampMixin):
    __tablename__ = "context_adjustments"

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), index=True)
    league_strength: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    team_strength: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    opposition_quality: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    competition_stakes: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    role_usage: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sample_reliability: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    context_confidence: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    explanation_json: Mapped[dict] = mapped_column(JSON, default=dict)
