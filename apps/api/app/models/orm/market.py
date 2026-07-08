from __future__ import annotations

from typing import Optional

from sqlalchemy import JSON, Boolean, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class MarketValue(Base, TimestampMixin):
    __tablename__ = "market_values"

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), index=True)
    public_value_eur: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    model_value_low_eur: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    model_value_high_eur: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    expected_asking_low_eur: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    expected_asking_high_eur: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    confidence: Mapped[str] = mapped_column(String(20), default="unknown")
    label: Mapped[str] = mapped_column(String(20), default="unknown")
    manual_review_required: Mapped[bool] = mapped_column(Boolean, default=False)
    explanation_json: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[str] = mapped_column(String(20), index=True)
