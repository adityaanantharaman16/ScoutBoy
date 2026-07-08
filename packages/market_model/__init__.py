"""ScoutBoy market model v1 — transparent, rule-based, explainable.

Stores THREE separate concepts (never a single "true" number):
  1. public market value        (external, from the Transfermarkt-style dataset)
  2. model value range          (our performance-driven estimate)
  3. expected asking price range(what a selling club would realistically demand)

    from market_model import estimate_market, MarketInputs
    estimate = estimate_market(MarketInputs(...))
"""

from __future__ import annotations

from scoutboy_shared import ConfidenceLevel

from .asking_price import compute_asking_price, contract_unknown
from .confidence import market_confidence
from .guardrails import clamp_value, needs_manual_review
from .models import MarketEstimate, MarketInputs
from .value_model import compute_model_value

MARKET_VERSION = "market-v1"

__all__ = ["estimate_market", "MarketInputs", "MarketEstimate", "MARKET_VERSION"]

# Range half-widths by confidence level (fraction of the mid).
_MODEL_WIDTH = {"high": 0.15, "medium": 0.22, "low": 0.32, "unknown": 0.40}


def _label(asking_mid: float, model_low: float, model_high: float) -> str:
    if asking_mid < model_low:
        return "undervalued"
    if asking_mid <= model_high:
        return "fair"
    if asking_mid <= model_high * 1.4:
        return "inflated"
    return "high-risk"


def estimate_market(inp: MarketInputs) -> MarketEstimate:
    level, conf_expl = market_confidence(inp)

    model_mid, perf_base, value_factors = compute_model_value(inp)
    asking_mid, asking_factors = compute_asking_price(inp, model_mid)

    model_w = _MODEL_WIDTH[level.value]
    asking_w = model_w + 0.05 + (0.08 if contract_unknown(inp) else 0.0)

    model_low = clamp_value(model_mid * (1 - model_w))
    model_high = clamp_value(model_mid * (1 + model_w))
    asking_low = clamp_value(asking_mid * (1 - asking_w))
    asking_high = clamp_value(asking_mid * (1 + asking_w))

    manual, reasons = needs_manual_review(model_mid, asking_mid)

    if level == ConfidenceLevel.UNKNOWN:
        label = "unknown"
    else:
        label = _label(asking_mid, model_low, model_high)

    explanation = {
        "value_factors": value_factors,
        "asking_factors": asking_factors,
        "confidence": conf_expl,
        "range_widths": {"model": model_w, "asking": round(asking_w, 3)},
        "label_basis": (
            f"expected asking mid €{round(asking_mid):,} vs model range "
            f"€{round(model_low):,}–€{round(model_high):,}"
        ),
        "manual_review_reasons": reasons,
        "disclaimer": "Ranges, not exact values. Public value, model value, and asking "
        "price are distinct concepts.",
    }

    return MarketEstimate(
        public_value_eur=inp.public_value_eur,
        model_value_low_eur=round(model_low),
        model_value_high_eur=round(model_high),
        expected_asking_low_eur=round(asking_low),
        expected_asking_high_eur=round(asking_high),
        confidence=level.value,
        label=label,
        manual_review_required=manual,
        version=MARKET_VERSION,
        explanation=explanation,
    )
