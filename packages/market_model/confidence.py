"""Market-model confidence.

Confidence reflects how much of the model is *measured* vs *guessed*: public value
present, contract data present, sample size, and whether RoleFit exists. Missing
contract/public data creates a transparent penalty (US-6.6)."""

from __future__ import annotations

from scoutboy_shared import ConfidenceLevel, confidence_from_score

from .models import MarketInputs


def market_confidence(inp: MarketInputs) -> tuple[ConfidenceLevel, dict]:
    score = 0.35  # base
    notes = []

    if inp.public_value_eur is not None:
        score += 0.2
    else:
        notes.append("No public market value — confidence reduced.")

    if inp.contract_years_remaining is not None:
        score += 0.15
    else:
        notes.append("No contract data — range widened and confidence reduced.")

    if inp.best_rolefit is not None:
        score += 0.15
    else:
        notes.append("No RoleFit score available.")

    if inp.age is None:
        score -= 0.1
        notes.append("No birth date — age premium not applied.")

    if inp.minutes >= 1800:
        score += 0.1
    elif inp.minutes < 450:
        score -= 0.1
        notes.append("Very small minutes sample.")

    score = max(0.0, min(1.0, score))
    level = confidence_from_score(score)
    return level, {"score": round(score, 3), "level": level.value, "notes": notes}
