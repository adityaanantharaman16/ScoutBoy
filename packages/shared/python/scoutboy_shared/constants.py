from __future__ import annotations

import os

# Display scale for RoleFit ratings.
DISPLAY_SCALE_MAX = 99.9

# Default minimum minutes for a player-season to be eligible for scoring.
DEFAULT_MIN_MINUTES = int(os.environ.get("SCOUTBOY_MIN_MINUTES", "450"))

# Key for the materialized MVP player universe (U23 attackers/midfielders in Europe).
MVP_UNIVERSE_KEY = "mvp_u23_att_mid_eu"

# MVP position groups. Only attackers and midfielders are in scope.
POSITION_GROUPS = ("ATT", "MID")

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
