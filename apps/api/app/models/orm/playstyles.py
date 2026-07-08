from __future__ import annotations

from typing import Optional

from sqlalchemy import JSON, Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class PlaystyleDefinition(Base, TimestampMixin):
    __tablename__ = "playstyle_definitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    playstyle_key: Mapped[str] = mapped_column(String(60), index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(40))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    version: Mapped[str] = mapped_column(String(20), index=True)
    thresholds_json: Mapped[dict] = mapped_column(JSON, default=dict)
    is_concern: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class PlayerPlaystyle(Base, TimestampMixin):
    __tablename__ = "player_playstyles"

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), index=True)
    playstyle_key: Mapped[str] = mapped_column(String(60), index=True)
    tier: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    confidence: Mapped[str] = mapped_column(String(20), default="unknown")
    is_concern: Mapped[bool] = mapped_column(Boolean, default=False)
    why_applied_json: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[str] = mapped_column(String(20), index=True)
