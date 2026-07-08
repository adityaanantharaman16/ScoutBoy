"""StatsBomb Open Data adapter (Phase 4) — statsbomb/open-data.

Used as a legal/open event-data sample and an adapter *proof*: it shows how future
event data maps into ScoutBoy's canonical per-90 metrics. The event→metric mapping is
pure and unit-tested; it is not wired into the MVP recompute path.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable


def events_to_metrics(events: Iterable[dict], player_name: str, minutes: float) -> dict[str, float]:
    """Derive a handful of canonical per-90 metrics from StatsBomb event JSON for one
    player. Demonstrates the mapping shape; extend for full coverage later."""
    counts: dict[str, float] = defaultdict(float)
    npxg = 0.0
    for ev in events:
        if ev.get("player", {}).get("name") != player_name:
            continue
        etype = ev.get("type", {}).get("name")
        if etype == "Shot":
            counts["shots"] += 1
            shot = ev.get("shot", {})
            if shot.get("type", {}).get("name") != "Penalty":
                npxg += float(shot.get("statsbomb_xg", 0.0) or 0.0)
        elif etype == "Pass":
            counts["passes"] += 1
            if ev.get("pass", {}).get("shot_assist"):
                counts["key_passes"] += 1
        elif etype == "Pressure":
            counts["pressures"] += 1
        elif etype in ("Dribble",):
            counts["take_ons_attempted"] += 1
            if ev.get("dribble", {}).get("outcome", {}).get("name") == "Complete":
                counts["take_ons_completed"] += 1

    per90 = 90.0 / minutes if minutes and minutes > 0 else 0.0
    out = {
        "shots_per90": round(counts["shots"] * per90, 3),
        "passes_per90": round(counts["passes"] * per90, 3),
        "key_passes_per90": round(counts["key_passes"] * per90, 3),
        "pressures_per90": round(counts["pressures"] * per90, 3),
        "non_penalty_xg_per90": round(npxg * per90, 3),
        "successful_take_ons_per90": round(counts["take_ons_completed"] * per90, 3),
    }
    if counts["take_ons_attempted"]:
        out["take_on_success_pct"] = round(
            100.0 * counts["take_ons_completed"] / counts["take_ons_attempted"], 1
        )
    return out
