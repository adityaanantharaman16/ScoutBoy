from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class MarketInputs:
    """All market-model inputs. Anything unknown stays None and lowers confidence /
    widens the range rather than being guessed."""

    age: float
    position: str
    position_group: str
    minutes: int
    best_rolefit: Optional[float]
    avg_top3_rolefit: Optional[float]
    league_multiplier: float = 1.0
    team_tier: str = "mid"
    public_value_eur: Optional[float] = None
    recent_form_index: Optional[float] = None
    international_caps: Optional[int] = None
    contract_years_remaining: Optional[float] = None
    hype_index: Optional[float] = None


@dataclass(frozen=True)
class MarketEstimate:
    public_value_eur: Optional[float]
    model_value_low_eur: Optional[float]
    model_value_high_eur: Optional[float]
    expected_asking_low_eur: Optional[float]
    expected_asking_high_eur: Optional[float]
    confidence: str  # unknown | low | medium | high
    label: str  # undervalued | fair | inflated | high-risk | unknown
    manual_review_required: bool
    version: str
    explanation: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "public_value_eur": self.public_value_eur,
            "model_value_low_eur": self.model_value_low_eur,
            "model_value_high_eur": self.model_value_high_eur,
            "expected_asking_low_eur": self.expected_asking_low_eur,
            "expected_asking_high_eur": self.expected_asking_high_eur,
            "confidence": self.confidence,
            "label": self.label,
            "manual_review_required": self.manual_review_required,
            "version": self.version,
            "explanation_json": self.explanation,
        }
