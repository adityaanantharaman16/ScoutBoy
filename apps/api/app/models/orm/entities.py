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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, utcnow


class Player(Base, TimestampMixin):
    __tablename__ = "players"

    id: Mapped[int] = mapped_column(primary_key=True)
    canonical_name: Mapped[str] = mapped_column(String(200), index=True)
    birth_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    nationality: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    preferred_foot: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    height_cm: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    primary_position: Mapped[Optional[str]] = mapped_column(String(10), index=True, nullable=True)
    secondary_positions: Mapped[list] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    source_ids: Mapped[list[PlayerSourceId]] = relationship(
        back_populates="player", cascade="all, delete-orphan"
    )


class PlayerSourceId(Base, TimestampMixin):
    __tablename__ = "player_source_ids"
    __table_args__ = (UniqueConstraint("source_name", "source_player_id", name="uq_source_player"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    source_name: Mapped[str] = mapped_column(String(50), index=True)
    source_player_id: Mapped[str] = mapped_column(String(100), index=True)
    source_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    raw_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    player: Mapped[Player] = relationship(back_populates="source_ids")


class Team(Base, TimestampMixin):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    canonical_name: Mapped[str] = mapped_column(String(200))
    country: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    league_id: Mapped[Optional[int]] = mapped_column(ForeignKey("competitions.id"), nullable=True)
    strength_tier: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)


class Competition(Base, TimestampMixin):
    __tablename__ = "competitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    country: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    competition_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    tier: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_european: Mapped[bool] = mapped_column(Boolean, default=True)


class Season(Base, TimestampMixin):
    __tablename__ = "seasons"

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)


class Appearance(Base, TimestampMixin):
    __tablename__ = "appearances"
    __table_args__ = (
        UniqueConstraint(
            "player_id", "team_id", "competition_id", "season_id", name="uq_appearance"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    competition_id: Mapped[int] = mapped_column(ForeignKey("competitions.id"), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), index=True)
    minutes: Mapped[int] = mapped_column(Integer, default=0)
    appearances: Mapped[int] = mapped_column(Integer, default=0)
    starts: Mapped[int] = mapped_column(Integer, default=0)
    position_group: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    role_usage_raw: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
