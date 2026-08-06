from __future__ import annotations

import os

# Authoritative RoleFit scoring range. Every producer, guardrail and quality
# check reads these two constants rather than repeating a literal, so the scale
# has exactly one definition: 0-99 inclusive.
DISPLAY_SCALE_MIN = 0.0
DISPLAY_SCALE_MAX = 99.0

# Default minimum minutes for a player-season to be eligible for scoring.
DEFAULT_MIN_MINUTES = int(os.environ.get("SCOUTBOY_MIN_MINUTES", "450"))

# Technical safety ceiling for a *minutes* threshold, in minutes. Deliberately NOT
# derived from DISPLAY_SCALE_MAX: minutes and RoleFit are separate domains that
# once shared one 0-99 bound by mistake, which made realistic thresholds such as
# 450, 900 or 1,500 impossible to request. Even an ever-present player across a
# long domestic season plus cup runs stays far below 10,000, so this is a guard
# against absurd input rather than a football limit. Stored and displayed player
# minutes are never capped or altered by it.
MINUTES_FILTER_MAX = 10_000

# Key for the materialized MVP player universe (U23 attackers/midfielders in Europe).
MVP_UNIVERSE_KEY = "mvp_u23_att_mid_eu"

# MVP position groups. Only attackers and midfielders are in scope.
POSITION_GROUPS = ("ATT", "MID")

# Position groups that can appear on a discoverable player-season record. Broader
# than POSITION_GROUPS because Discovery spans every ingested record, while
# configured RoleFit models still cover attackers and midfielders only: a DEF or GK
# record is discoverable but unrated.
DISCOVERABLE_POSITION_GROUPS = ("ATT", "MID", "DEF", "GK")

# Canonical positions -> position group. MVP scope: attackers + midfielders only.
POSITIONS: dict[str, str] = {
    "ST": "ATT",
    "CF": "ATT",
    "LW": "ATT",
    "RW": "ATT",
    "AM": "MID",
    "CAM": "MID",
    "CM": "MID",
    "DM": "MID",
}


def position_group_for(position: str) -> str | None:
    """Return the position group for a canonical position, or None if out of scope."""
    if not position:
        return None
    return POSITIONS.get(position.upper())
