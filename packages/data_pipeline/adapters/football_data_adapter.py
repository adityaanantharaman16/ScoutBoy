"""Football-Data.co.uk adapter — match results for CONTEXT proxies only.

This is not player-level scouting data. It produces team-strength / stakes proxies
(points-per-game, goal difference) from season match results, feeding the context
layer rather than any playstyle or RoleFit metric.
"""

from __future__ import annotations

from collections import defaultdict


def build_team_context(matches: list[dict]) -> dict[str, dict]:
    """From rows with HomeTeam, AwayTeam, FTHG, FTAG, FTR compute per-team
    points-per-game and goal difference — a coarse team-strength proxy."""
    played: dict[str, int] = defaultdict(int)
    points: dict[str, int] = defaultdict(int)
    gd: dict[str, int] = defaultdict(int)

    for m in matches:
        h, a = m["HomeTeam"], m["AwayTeam"]
        hg, ag = int(m["FTHG"]), int(m["FTAG"])
        played[h] += 1
        played[a] += 1
        gd[h] += hg - ag
        gd[a] += ag - hg
        res = m.get("FTR") or ("H" if hg > ag else "A" if ag > hg else "D")
        if res == "H":
            points[h] += 3
        elif res == "A":
            points[a] += 3
        else:
            points[h] += 1
            points[a] += 1

    out: dict[str, dict] = {}
    for team, n in played.items():
        out[team] = {
            "matches": n,
            "points_per_game": round(points[team] / n, 3) if n else 0.0,
            "goal_difference": gd[team],
        }
    return out
