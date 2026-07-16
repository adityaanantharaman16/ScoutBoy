"""Model value: a transparent, rule-based estimate (no black-box ML in the MVP).

A performance-driven base value is computed from RoleFit + age + league + scarcity +
minutes + international profile + form, then blended toward the public value when one
exists so the estimate stays grounded. Every factor is returned for explanation.
"""

from __future__ import annotations

from .models import MarketInputs

BASE_ANCHOR_EUR = 20_000_000.0  # value at a ~60 RoleFit reference player

# Position scarcity multipliers (attacking output is scarcer / more expensive).
SCARCITY = {
    "ST": 1.12,
    "CF": 1.12,
    "LW": 1.10,
    "RW": 1.10,
    "AM": 1.06,
    "CAM": 1.06,
    "CM": 1.0,
    "DM": 0.95,
}


def _rolefit_factor(best: float, avg_top3: float) -> float:
    blended = 0.6 * best + 0.4 * avg_top3
    # cubic growth so elite ratings command a premium; reference 60 -> 1.0
    return max(0.05, (blended / 60.0) ** 3)


def compute_model_value(inp: MarketInputs) -> tuple[float, float, dict]:
    """Return (mid, base_before_blend, factors)."""
    best = inp.best_rolefit if inp.best_rolefit is not None else 45.0
    avg = inp.avg_top3_rolefit if inp.avg_top3_rolefit is not None else best

    rolefit_factor = _rolefit_factor(best, avg)
    age_factor = 1.0 if inp.age is None else 1.0 + max(0.0, (23.0 - inp.age)) * 0.05
    league_factor = inp.league_multiplier**1.5
    scarcity = SCARCITY.get(inp.position.upper(), 1.0)
    minutes_factor = 0.7 + 0.3 * min(1.0, inp.minutes / 1800.0)
    intl_factor = 1.0 + min(inp.international_caps or 0, 20) * 0.005
    form_factor = 1.0 + ((inp.recent_form_index or 0.5) - 0.5) * 0.1

    base = (
        BASE_ANCHOR_EUR
        * rolefit_factor
        * age_factor
        * league_factor
        * scarcity
        * minutes_factor
        * intl_factor
        * form_factor
    )

    if inp.public_value_eur is not None:
        # Blend 50/50 toward the public value to stay grounded.
        mid = 0.5 * base + 0.5 * inp.public_value_eur
        blend = "50% performance model / 50% public value"
    else:
        mid = base
        blend = "performance model only (no public value)"

    factors = {
        "base_anchor_eur": BASE_ANCHOR_EUR,
        "rolefit_factor": round(rolefit_factor, 3),
        "age_factor": round(age_factor, 3),
        "age_known": inp.age is not None,
        "league_factor": round(league_factor, 3),
        "scarcity_factor": round(scarcity, 3),
        "minutes_factor": round(minutes_factor, 3),
        "international_factor": round(intl_factor, 3),
        "form_factor": round(form_factor, 3),
        "performance_base_eur": round(base),
        "blend": blend,
        "model_mid_eur": round(mid),
    }
    return mid, base, factors
