from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class MarketPanel(BaseModel):
    public_value_eur: Optional[float] = None
    model_value_low_eur: Optional[float] = None
    model_value_high_eur: Optional[float] = None
    expected_asking_low_eur: Optional[float] = None
    expected_asking_high_eur: Optional[float] = None
    confidence: str = "unknown"
    label: str = "unknown"
    manual_review_required: bool = False
    version: Optional[str] = None
    explanation: dict = {}
