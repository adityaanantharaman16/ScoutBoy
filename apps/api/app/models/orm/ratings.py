from __future__ import annotations

from typing import Optional

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin


class RoleDefinition(Base, TimestampMixin):
    __tablename__ = "role_definitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    role_key: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    position_group: Mapped[str] = mapped_column(String(10), index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class RoleWeightVersion(Base, TimestampMixin):
    __tablename__ = "role_weight_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    role_key: Mapped[str] = mapped_column(String(60), index=True)
    version: Mapped[str] = mapped_column(String(40), index=True)
    config_hash: Mapped[str] = mapped_column(String(40))
    weights_json: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="published")


class RoleRating(Base, TimestampMixin):
    __tablename__ = "role_ratings"
    __table_args__ = (
        UniqueConstraint("player_id", "role_key", "season_id", "version", name="uq_role_rating"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    role_key: Mapped[str] = mapped_column(String(60), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), index=True)
    version: Mapped[str] = mapped_column(String(40), index=True)
    raw_score: Mapped[float] = mapped_column(Float, default=0.0)
    context_adjusted_score: Mapped[float] = mapped_column(Float, default=0.0)
    final_score: Mapped[float] = mapped_column(Float, default=0.0, index=True)
    confidence: Mapped[str] = mapped_column(String(20), default="unknown")
    rank_in_peer_group: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    audit: Mapped[RatingAudit] = relationship(
        back_populates="role_rating", cascade="all, delete-orphan", uselist=False
    )


class RatingAudit(Base, TimestampMixin):
    __tablename__ = "rating_audits"

    id: Mapped[int] = mapped_column(primary_key=True)
    role_rating_id: Mapped[int] = mapped_column(
        ForeignKey("role_ratings.id", ondelete="CASCADE"), index=True
    )
    metric_breakdown_json: Mapped[dict] = mapped_column(JSON, default=dict)
    context_breakdown_json: Mapped[dict] = mapped_column(JSON, default=dict)
    confidence_breakdown_json: Mapped[dict] = mapped_column(JSON, default=dict)
    penalties_json: Mapped[dict] = mapped_column(JSON, default=dict)
    explanation_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    role_rating: Mapped[RoleRating] = relationship(back_populates="audit")
