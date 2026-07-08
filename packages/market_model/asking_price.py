"""Expected asking price: what a selling club would realistically demand.

This is deliberately separate from model value (US-6.1). It layers a negotiation
premium driven by selling-club leverage, contract length, scarcity, hype, and the
U23 premium on top of the higher of model value / public value.
"""

from __future__ import annotations

from .models import MarketInputs
from .value_model import SCARCITY

# Selling-club leverage by team tier: stronger clubs are under less pressure to sell.
LEVERAGE = {"elite": 0.25, "strong": 0.15, "mid": 0.10, "developing": 0.05, "weak": 0.0}


def compute_asking_price(inp: MarketInputs, model_mid: float) -> tuple[float, dict]:
    anchor = max(model_mid, inp.public_value_eur or 0.0)

    premium = 1.0
    factors: dict = {"anchor_eur": round(anchor)}

    lev = LEVERAGE.get(inp.team_tier, 0.10)
    premium += lev
    factors["selling_club_leverage"] = f"+{lev:.2f} (team tier '{inp.team_tier}')"

    contract = inp.contract_years_remaining
    if contract is None:
        contract_adj = 0.0
        factors["contract"] = "unknown — no premium adjustment, range widened"
    elif contract >= 3:
        contract_adj = 0.15
        factors["contract"] = f"+0.15 (long contract, {contract:.0f}y remaining)"
    elif contract >= 2:
        contract_adj = 0.08
        factors["contract"] = f"+0.08 ({contract:.0f}y remaining)"
    else:
        contract_adj = -0.10
        factors["contract"] = f"-0.10 (short contract, {contract:.1f}y — pressure to sell)"
    premium += contract_adj

    scarcity_adj = SCARCITY.get(inp.position.upper(), 1.0) - 1.0
    premium += scarcity_adj
    factors["scarcity"] = f"+{scarcity_adj:.2f} (position '{inp.position}')"

    hype_adj = (inp.hype_index or 0.0) * 0.20
    premium += hype_adj
    factors["hype"] = f"+{hype_adj:.2f}"

    premium += 0.05  # U23 premium
    factors["u23_premium"] = "+0.05"

    premium = max(0.7, premium)  # never below a floor
    asking_mid = anchor * premium
    factors["total_premium"] = round(premium, 3)
    factors["asking_mid_eur"] = round(asking_mid)
    return asking_mid, factors


def contract_unknown(inp: MarketInputs) -> bool:
    return inp.contract_years_remaining is None
