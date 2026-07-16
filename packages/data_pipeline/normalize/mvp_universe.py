"""MVP player-universe membership.

Materializes (non-destructively) which player-seasons belong to the MVP universe:
U23 + attacker/midfielder + European competition + minutes >= threshold. Nothing is
deleted from the DB; the API filters search to eligible members by default.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from scoutboy_shared import DEFAULT_MIN_MINUTES, MVP_UNIVERSE_KEY

UNIVERSE_KEY = MVP_UNIVERSE_KEY
MAX_AGE = 23
ELIGIBLE_POSITION_GROUPS = ("ATT", "MID")


@dataclass(frozen=True)
class UniverseVerdict:
    eligible: bool
    reasons: dict


def evaluate_membership(
    *,
    age: Optional[float],
    position_group: Optional[str],
    minutes: int,
    is_european: Optional[bool],
    min_minutes: int = DEFAULT_MIN_MINUTES,
    max_age: int = MAX_AGE,
    performance_minutes: Optional[int] = None,
) -> UniverseVerdict:
    """Pure eligibility check. Every criterion is reported so the reason a player is in
    or out of the universe is always explainable."""
    covered_minutes = minutes if performance_minutes is None else performance_minutes
    checks = {
        "u23": age is not None and age <= max_age,
        "attacker_or_midfielder": position_group in ELIGIBLE_POSITION_GROUPS,
        "min_minutes": minutes >= min_minutes,
        "performance_coverage": covered_minutes >= min_minutes,
        "european": bool(is_european),
    }
    reasons = {
        **checks,
        "age": age,
        "position_group": position_group,
        "minutes": minutes,
        "performance_covered_minutes": covered_minutes,
        "min_minutes_threshold": min_minutes,
        "max_age": max_age,
    }
    return UniverseVerdict(eligible=all(checks.values()), reasons=reasons)
