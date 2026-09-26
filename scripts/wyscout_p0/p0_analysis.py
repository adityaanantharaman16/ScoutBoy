"""P0 read-only feasibility analysis of the public Wyscout 2017/18 Big Five release.

Research tooling for Kanban card t_44597dd8 (P0 of docs/IMPLEMENTATION_PLAN.md). It is
NOT a ScoutBoy source adapter: it never writes to a ScoutBoy database, never publishes a
metric, and never decides a product threshold. Every threshold/state it uses is read from
``scripts/wyscout_p0/p0_policy.yaml`` and the unchanged ``configs/roles/*.yaml``.

It streams one league event file at a time from the pinned ``events.zip`` (bounded memory:
per-match/per-player counters, never a full event list) and writes:

* an aggregate, non-personal JSON report (``--output``; committed under data/reports/), and
* an optional local detail JSON with provider player IDs for reviewer spot-checks
  (``--local-detail``; keep under the gitignored data/raw/wyscout/ directory).

Usage (repo root; Python >= 3.9 with PyYAML, e.g. the project venv):

    python scripts/wyscout_p0/p0_analysis.py \\
        --raw data/raw/wyscout \\
        --output data/reports/wyscout_p0_feasibility.json \\
        --local-detail data/raw/wyscout/p0_local_detail.json
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import resource
import sys
import time
import zipfile
from array import array
from collections import Counter, defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import IO, Any, Optional

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_POLICY = Path(__file__).resolve().parent / "p0_policy.yaml"
DEFAULT_ROLES = REPO_ROOT / "configs" / "roles"

# --------------------------------------------------------------------------------------
# Streaming JSON
# --------------------------------------------------------------------------------------

_DECODER = json.JSONDecoder()


def iter_json_array(fh: IO[bytes], chunk_chars: int = 1 << 20) -> Iterator[Any]:
    """Yield elements of a top-level JSON array without materializing the whole array.

    Memory is bounded by ``chunk_chars`` plus the largest single element.
    """
    text = io.TextIOWrapper(fh, encoding="utf-8")
    buf = ""
    pos = 0
    eof = False
    started = False

    def refill() -> None:
        nonlocal buf, pos, eof
        more = text.read(chunk_chars)
        if more:
            buf = buf[pos:] + more
            pos = 0
        else:
            eof = True

    while True:
        if not eof and len(buf) - pos < chunk_chars:
            refill()
        while pos < len(buf) and buf[pos] in " \r\n\t":
            pos += 1
        if pos >= len(buf):
            if eof:
                raise ValueError("truncated JSON array")
            continue
        ch = buf[pos]
        if not started:
            if ch != "[":
                raise ValueError("top-level value is not a JSON array")
            started = True
            pos += 1
            continue
        if ch == "]":
            return
        if ch == ",":
            pos += 1
            continue
        try:
            obj, end = _DECODER.raw_decode(buf, pos)
        except json.JSONDecodeError:
            if eof:
                raise
            refill()
            continue
        # An array element must be followed by whitespace, "," or "]". Anything else (or
        # the buffer edge) means a scalar such as "-0" | ".25" was split across chunks.
        if end >= len(buf) or buf[end] not in " \r\n\t,]":
            if eof:
                if end >= len(buf):
                    raise ValueError("truncated JSON array")
                raise ValueError(f"unexpected character after array element at {end}")
            refill()
            continue
        pos = end
        yield obj


# --------------------------------------------------------------------------------------
# Pure helpers (golden-tested)
# --------------------------------------------------------------------------------------


def roster_minute(value: Any) -> Optional[int]:
    """Wyscout roster card fields hold "0" for none or the minute as a string."""
    if value is None:
        return None
    s = str(value).strip()
    if s in ("", "0", "null"):
        return None
    try:
        minute = int(s)
    except ValueError:
        return None
    return minute if minute > 0 else None


def parse_dob(value: Any) -> Optional[date]:
    if not isinstance(value, str) or len(value) != 10:
        return None
    try:
        dob = date.fromisoformat(value)
    except ValueError:
        return None
    if dob.year < 1960 or dob.year > 2010:
        return None
    return dob


def whole_years_on(dob: date, ref: date) -> int:
    years = ref.year - dob.year
    if (ref.month, ref.day) < (dob.month, dob.day):
        years -= 1
    return years


def event_clock_minute(period: str, event_sec: float, first_half_minutes: int = 45) -> float:
    """Map an event to the roster clock. 1H stoppage clamps to 45 (the roster clock never
    shows 45+x for 1H); 2H continues from 45 so 2H stoppage stays > 90, matching roster
    substitution minutes such as 93."""
    minute = float(event_sec) / 60.0
    if period == "1H":
        return min(minute, float(first_half_minutes))
    if period == "2H":
        return first_half_minutes + minute
    return math.inf  # extra time / penalties: outside the domestic regulation policy


@dataclass
class PlayerMatch:
    player_id: int
    team_id: int
    started: bool
    on: Optional[float] = None  # raw roster clock, None = unused
    off: Optional[float] = None  # raw roster clock, None = played to the end
    red_minute: Optional[int] = None
    issues: list[str] = field(default_factory=list)

    @property
    def appeared(self) -> bool:
        return self.on is not None

    def minutes(self, regulation: int = 90) -> float:
        if self.on is None:
            return 0.0
        start = min(max(self.on, 0.0), float(regulation))
        end = float(regulation) if self.off is None else min(max(self.off, 0.0), regulation)
        return max(0.0, end - start)

    def raw_minutes_unclipped(self, match_end: float) -> float:
        """Sensitivity only: exposure if 2H stoppage is credited, using an event-derived
        match end (45 + last 2H event minute). 1H stoppage is not on the roster clock."""
        if self.on is None:
            return 0.0
        end = max(match_end, self.on) if self.off is None else self.off
        return max(0.0, end - self.on)


def reconstruct_team_minutes(
    team_id: int, formation: dict, max_subs: int = 3
) -> tuple[dict[int, PlayerMatch], list[str]]:
    """Reconstruct per-player on/off intervals from a Wyscout match formation block.

    Returns (players, team_issues). Player-level problems are appended to the player's
    ``issues``; a non-empty ``team_issues`` means the whole team-match is structurally
    unreliable. Nothing is guessed: an invalid substitution leaves both players flagged.
    """
    team_issues: list[str] = []
    lineup = formation.get("lineup") or []
    bench = formation.get("bench") or []
    subs = formation.get("substitutions")
    if not isinstance(subs, list):
        subs = [] if subs in (None, "null", "") else None
    players: dict[int, PlayerMatch] = {}
    for row in lineup:
        pid = int(row["playerId"])
        if pid in players:
            team_issues.append("duplicate_roster_player")
        players[pid] = PlayerMatch(pid, team_id, started=True, on=0.0)
    for row in bench:
        pid = int(row["playerId"])
        if pid in players:
            team_issues.append("duplicate_roster_player")
            continue
        players[pid] = PlayerMatch(pid, team_id, started=False)
    if len(lineup) != 11:
        team_issues.append("starting_lineup_not_11")
    if subs is None:
        team_issues.append("substitutions_unparseable")
        subs = []
    if len(subs) > max_subs:
        team_issues.append("more_than_max_substitutions")

    for sub in sorted(subs, key=lambda s: s.get("minute", 0)):  # stable within a minute
        out_id, in_id = int(sub.get("playerOut", 0)), int(sub.get("playerIn", 0))
        minute = float(sub.get("minute", -1))
        out_p, in_p = players.get(out_id), players.get(in_id)
        out_ok = out_p is not None and out_p.on is not None and out_p.off is None
        in_ok = in_p is not None and not in_p.started and in_p.on is None
        if minute < 0:
            out_ok = in_ok = False
        if out_ok and in_ok:
            out_p.off = minute
            in_p.on = minute
            continue
        for p, ok in ((out_p, out_ok), (in_p, in_ok)):
            if p is not None:
                p.issues.append("invalid_substitution")
            elif not ok:
                team_issues.append("substitution_player_not_in_roster")

    for row in list(lineup) + list(bench):
        pid = int(row["playerId"])
        red = roster_minute(row.get("redCards"))
        if red is None or pid not in players:
            continue
        p = players[pid]
        p.red_minute = red
        if p.on is None:
            continue  # unused substitute dismissed from the bench: no minutes affected
        if red < p.on:
            p.issues.append("red_card_before_entry")
        elif p.off is None or red < p.off:
            p.off = float(red)
    return players, team_issues


def expected_team_minutes(players: dict, regulation: int = 90, on_pitch: int = 11) -> float:
    """Team exposure implied by the roster: 11 x regulation minus time lost to dismissals.

    Substitutions conserve on-pitch count, so any difference from the reconstructed sum
    reveals an overlapping/missing interval (a structural error), not a policy choice."""
    lost = 0.0
    for p in players.values():
        if p.red_minute is not None and p.on is not None and p.off == float(p.red_minute):
            lost += max(0.0, regulation - min(float(p.red_minute), float(regulation)))
    return on_pitch * float(regulation) - lost


def per90(count: float, minutes: float) -> Optional[float]:
    if minutes <= 0:
        return None
    return count * 90.0 / minutes


def pct(num: float, den: float) -> Optional[float]:
    if den <= 0:
        return None
    return 100.0 * num / den


def to_frame(pos: dict, geo: dict) -> tuple[float, float]:
    return float(pos["x"]) * geo["x_scale"], float(pos["y"]) * geo["y_scale"]


def in_box(pt: tuple[float, float], geo: dict) -> bool:
    return pt[0] >= geo["box_min_x"] and geo["box_min_y"] <= pt[1] <= geo["box_max_y"]


def dist_goal(pt: tuple[float, float], geo: dict) -> float:
    return math.hypot(geo["goal_x"] - pt[0], geo["goal_y"] - pt[1])


PLACEHOLDER_POINTS = ((0, 0), (100, 100))


def is_placeholder_point(pos: dict) -> bool:
    """Wyscout public data uses (0,0)/(100,100) where a location was not recorded (e.g.
    every goal-kick start and every shot end in the probe). A real corner-flag start at
    (100,100) is indistinguishable, so P0 conservatively treats both as unusable."""
    return (pos.get("x"), pos.get("y")) in PLACEHOLDER_POINTS


def is_placeholder_end(positions: list) -> bool:
    if len(positions) < 2:
        return True
    return is_placeholder_point(positions[1])


def pass_geometry_usable(positions: list) -> bool:
    return len(positions) >= 2 and not any(is_placeholder_point(p) for p in positions[:2])


# Counter names accumulated per player-match.
COUNTERS = (
    "passes",
    "passes_accuracy_known",
    "passes_completed",
    "key_passes",
    "through_balls",
    "crosses",
    "prog_passes",
    "final_third_passes",
    "long_passes_completed",
    "pass_geometry_unusable",
    "shots_np",
    "goals_np",
    "penalties",
    "takeon_attempts",
    "takeon_won",
    "ground_duels",
    "ground_duels_won",
    "aerial_duels",
    "aerial_won",
    "interceptions",
    "fouls",
    "exp_box_events",
    "exp_defending_duels_won",
    "exp_sliding_tackles",
    "exp_lost_attacking_duels",
    "exp_missed_ball",
)


def count_event(c: Counter, e: dict, policy: dict) -> None:
    """Accumulate one player's event into P0 candidate counters (policy-driven IDs)."""
    ev, tg, geo = policy["events"], policy["tags"], policy["geometry"]
    eid, sub = e.get("eventId"), e.get("subEventId")
    tags = {t.get("id") for t in e.get("tags") or []}
    positions = e.get("positions") or []
    start = (
        to_frame(positions[0], geo)
        if positions and not is_placeholder_point(positions[0])
        else None
    )
    is_pass = eid == ev["pass_event_id"] or sub in ev["restart_pass_sub_event_ids"]
    if start is not None and in_box(start, geo):
        c["exp_box_events"] += 1
    if is_pass:
        c["passes"] += 1
        acc = tg["accurate"] in tags
        if acc or tg["not_accurate"] in tags:
            c["passes_accuracy_known"] += 1
        if acc:
            c["passes_completed"] += 1
        if tg["key_pass"] in tags or tg["assist"] in tags:
            c["key_passes"] += 1
        if tg["through"] in tags:
            c["through_balls"] += 1
        if sub in ev["cross_sub_event_ids"]:
            c["crosses"] += 1
        if acc:
            if not pass_geometry_usable(positions):
                c["pass_geometry_unusable"] += 1
            else:
                start = to_frame(positions[0], geo)
                end = to_frame(positions[1], geo)
                if start[0] < geo["final_third_x"] <= end[0]:
                    c["final_third_passes"] += 1
                gain = dist_goal(start, geo) - dist_goal(end, geo)
                if gain >= geo["progressive_pass_gain"] and end[0] >= geo["opp_half_x"]:
                    c["prog_passes"] += 1
                if math.hypot(end[0] - start[0], end[1] - start[1]) >= geo["long_pass_min_length"]:
                    c["long_passes_completed"] += 1
    if sub == ev["penalty_sub_event_id"]:
        c["penalties"] += 1
    elif eid == ev["shot_event_id"] or sub == ev["free_kick_shot_sub_event_id"]:
        c["shots_np"] += 1
        if tg["goal"] in tags and tg["own_goal"] not in tags:
            c["goals_np"] += 1
    if eid == ev["duel_event_id"]:
        won = tg["won"] in tags
        if sub == ev["air_duel_sub_event_id"]:
            c["aerial_duels"] += 1
            c["aerial_won"] += int(won)
        else:
            c["ground_duels"] += 1
            c["ground_duels_won"] += int(won)
            if sub == ev["ground_attacking_duel_sub_event_id"]:
                if tags & set(tg["take_on"]):
                    c["takeon_attempts"] += 1
                    c["takeon_won"] += int(won)
                if tg["lost"] in tags:
                    c["exp_lost_attacking_duels"] += 1
            if sub == ev["ground_defending_duel_sub_event_id"] and won:
                c["exp_defending_duels_won"] += 1
    if tg["interception"] in tags:
        c["interceptions"] += 1
    if tg["sliding_tackle"] in tags:
        c["exp_sliding_tackles"] += 1
    if eid == ev["foul_event_id"] and sub in ev["foul_sub_event_ids"]:
        c["fouls"] += 1
    if tg["missed_ball"] in tags:
        c["exp_missed_ball"] += 1


def metric_values(c: Counter, minutes: float) -> dict[str, Optional[float]]:
    """P0 metric values for one player-season (counts summed before dividing)."""
    return {
        "passes_per90": per90(c["passes"], minutes),
        "pass_completion_pct": pct(c["passes_completed"], c["passes_accuracy_known"]),
        "key_passes_per90": per90(c["key_passes"], minutes),
        "through_balls_per90": per90(c["through_balls"], minutes),
        "crosses_per90": per90(c["crosses"], minutes),
        "shots_per90": per90(c["shots_np"], minutes),
        "successful_take_ons_per90": per90(c["takeon_won"], minutes),
        "take_on_success_pct": pct(c["takeon_won"], c["takeon_attempts"]),
        "interceptions_per90": per90(c["interceptions"], minutes),
        "ground_duels_won_pct": pct(c["ground_duels_won"], c["ground_duels"]),
        "aerial_duels_won_pct": pct(c["aerial_won"], c["aerial_duels"]),
        "fouls_per90": per90(c["fouls"], minutes),
        "progressive_passes_per90": per90(c["prog_passes"], minutes),
        "passes_into_final_third_per90": per90(c["final_third_passes"], minutes),
        "long_passes_completed_per90": per90(c["long_passes_completed"], minutes),
        # experimental proxies: computed for magnitude only, never counted as present
        "touches_in_box_per90": per90(c["exp_box_events"], minutes),
        "tackles_per90": per90(c["exp_defending_duels_won"], minutes),
        "dispossessed_per90": per90(c["exp_lost_attacking_duels"], minutes),
        "miscontrols_per90": per90(c["exp_missed_ball"], minutes),
    }


def role_support(role: dict, states: dict, present_states: Iterable[str]) -> dict:
    """Exact required-metric fraction and weighted scoring support for one role config."""
    present = set(present_states)

    def ok(name: str) -> bool:
        return states.get(name, "unavailable") in present

    required = list(role.get("required_metrics", []))
    req_present = [m for m in required if ok(m)]
    weighted = 0.0
    lost_groups = []
    for gkey, g in role["metric_groups"].items():
        mets = g.get("metrics", [])
        default_w = 1.0 / len(mets) if mets else 0.0
        total = sum(float(m.get("weight", default_w)) for m in mets) or 1.0
        got = sum(float(m.get("weight", default_w)) for m in mets if ok(m["name"]))
        weighted += float(g["weight"]) * got / total
        if got == 0:
            lost_groups.append(gkey)
    fraction = len(req_present) / len(required) if required else 0.0
    return {
        "required_metrics": required,
        "required_present": req_present,
        "required_missing": {m: states.get(m, "unavailable") for m in required if not ok(m)},
        "required_fraction": fraction,
        "weighted_support": weighted,
        "groups_without_support": lost_groups,
    }


def select_pinned_sample(matches: list[dict]) -> dict[str, int]:
    """Earliest/middle/latest played match by (dateutc, wyId) for one league."""
    played = sorted(
        (m for m in matches if m.get("status") == "Played"),
        key=lambda m: (m["dateutc"], m["wyId"]),
    )
    if not played:
        return {}
    return {
        "earliest": played[0]["wyId"],
        "middle": played[(len(played) - 1) // 2]["wyId"],
        "latest": played[-1]["wyId"],
    }


def reconcile_goals(match: dict, team_event_goals: dict[int, int]) -> dict:
    """Compare published team score with goals derived from events (own goals credited to
    the opponent) and with the roster ``goals`` field."""
    out = {}
    teams = {int(t): d for t, d in match["teamsData"].items()}
    for tid, d in teams.items():
        roster_goals = 0
        for row in (d["formation"].get("lineup") or []) + (d["formation"].get("bench") or []):
            try:
                roster_goals += max(0, int(row.get("goals")))
            except (TypeError, ValueError):
                pass
        out[tid] = {
            "score": int(d["score"]),
            "event_goals": int(team_event_goals.get(tid, 0)),
            "roster_goals_field": roster_goals,
        }
    return out


# --------------------------------------------------------------------------------------
# Full analysis
# --------------------------------------------------------------------------------------


def rss_mb() -> float:
    kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(kb / 1024.0, 1) if sys.platform != "darwin" else round(kb / 1048576.0, 1)


def load_dictionaries(raw: Path) -> tuple[set, set]:
    with (raw / "eventid2name.csv").open(encoding="utf-8") as fh:
        pairs = {(int(r["event"]), int(r["subevent"])) for r in csv.DictReader(fh)}
    with (raw / "tags2name.csv").open(encoding="utf-8") as fh:
        tags = {int(r["Tag"]) for r in csv.DictReader(fh)}
    return pairs, tags


def analyze(raw: Path, policy: dict, roles_dir: Path, leagues: Optional[list] = None) -> tuple:
    t_start = time.time()
    resources: dict[str, Any] = {"phases": []}
    geo_ref = date.fromisoformat(policy["age_reference_date"])
    reg = int(policy["minutes"]["regulation_minutes"])
    first_half = int(policy["minutes"]["first_half_minutes"])
    tol = float(policy["minutes"]["interval_event_tolerance_minutes"])
    domestic = {int(k): v for k, v in policy["domestic_competitions"].items()}
    if leagues:
        domestic = {k: v for k, v in domestic.items() if v["stem"] in leagues}
    event_pairs, known_tags = load_dictionaries(raw)

    players_raw = json.loads((raw / "players.json").read_text(encoding="utf-8"))
    teams_raw = json.loads((raw / "teams.json").read_text(encoding="utf-8"))
    comps = json.loads((raw / "competitions.json").read_text(encoding="utf-8"))
    player_ids = Counter(int(p["wyId"]) for p in players_raw)
    players = {int(p["wyId"]): p for p in players_raw}
    team_ids = {int(t["wyId"]) for t in teams_raw}

    identity = {
        "players_json_records": len(players_raw),
        "players_json_duplicate_wyids": sum(1 for v in player_ids.values() if v > 1),
        "teams_json_records": len(teams_raw),
        "competitions": [
            {"wyId": c["wyId"], "name": c["name"], "format": c["format"]} for c in comps
        ],
    }
    name_dob = Counter()
    escaped = 0
    for p in players_raw:
        nm = f"{p.get('firstName', '')} {p.get('lastName', '')}".strip()
        if "\\u" in nm + str(p.get("shortName", "")):
            escaped += 1
        name_dob[(nm.casefold(), p.get("birthDate"))] += 1
    identity["name_dob_collisions_distinct_wyids"] = sum(1 for v in name_dob.values() if v > 1)
    # Names are stored with literal "\uXXXX" escape text inside already-decoded JSON strings
    # (double-escaped); a P1 adapter must decode them exactly once before display/matching.
    identity["names_with_literal_unicode_escape_text"] = escaped
    identity["coarse_roles"] = dict(
        Counter((p.get("role") or {}).get("code2") for p in players_raw).most_common()
    )
    identity["position_fields_available"] = sorted(
        {k for p in players_raw for k in p if "role" in k.lower() or "position" in k.lower()}
    )

    mz = zipfile.ZipFile(raw / "matches.zip")
    ez = zipfile.ZipFile(raw / "events.zip")
    match_files = {i.filename: i.file_size for i in mz.infolist()}
    event_files = {i.filename: i.file_size for i in ez.infolist()}

    season_pm: dict[int, dict] = defaultdict(
        lambda: {
            "season_minutes": 0.0,
            "covered_minutes": 0.0,
            "unclipped_minutes": 0.0,
            "clipped_minutes_all": 0.0,
            "appearances": 0,
            "starts": 0,
            "rostered_matches": 0,
            "uncertain_player_matches": 0,
            "uncertain_minutes_lost": 0.0,
            "teams": set(),
            "leagues": set(),
            "counters": Counter(),
        }
    )
    leagues_out: dict[str, Any] = {}
    all_match_ids: Counter = Counter()
    event_id_ranges = {}
    sample: dict[str, Any] = {"pinned": {}, "edge_cases": {}}
    edge_candidates: dict[str, list] = defaultdict(list)  # deduplicated at output time
    match_detail: dict[int, dict] = {}
    semantics = Counter()
    unknown_pairs: Counter = Counter()
    unknown_tags: Counter = Counter()
    pid0_by_type: Counter = Counter()
    global_event_ids = array("q")  # 8 bytes/event; ~25 MB for the domestic union
    roster_owngoal_values: Counter = Counter()
    shot_start_x: list = [0.0, 0]
    goal_kick_x: list = [0.0, 0]

    for comp_id, meta in sorted(domestic.items(), key=lambda kv: kv[1]["stem"]):
        stem = meta["stem"]
        t0 = time.time()
        matches = json.loads(mz.read(f"matches_{stem}.json"))
        lg: dict[str, Any] = {
            "competition_wyId": comp_id,
            "league": meta["league"],
            "s1_expected_matches": meta["s1_matches"],
            "s1_expected_events": meta["s1_events"],
        }
        lg["match_records"] = len(matches)
        lg["competition_ids_in_file"] = sorted({m["competitionId"] for m in matches})
        lg["season_ids_in_file"] = sorted({m["seasonId"] for m in matches})
        lg["status_counts"] = dict(Counter(m["status"] for m in matches))
        lg["duration_counts"] = dict(Counter(m["duration"] for m in matches))
        lg["has_formation_team_counts"] = dict(
            Counter(str(d.get("hasFormation")) for m in matches for d in m["teamsData"].values())
        )
        dates = sorted(m["dateutc"] for m in matches)
        lg["date_range_utc"] = [dates[0], dates[-1]] if dates else None
        sample["pinned"][stem] = select_pinned_sample(matches)
        teams_in_league = set()
        fixtures = Counter()
        rosters: dict[int, dict[int, PlayerMatch]] = {}
        match_teams: dict[int, set] = {}
        team_issue_counter = Counter()
        player_issue_counter = Counter()
        roster_red = 0
        for m in sorted(matches, key=lambda x: (x["dateutc"], x["wyId"])):
            mid = int(m["wyId"])
            all_match_ids[mid] += 1
            sides = {d["side"]: int(t) for t, d in m["teamsData"].items()}
            teams_in_league.update(sides.values())
            if "home" in sides and "away" in sides:
                fixtures[(sides["home"], sides["away"])] += 1
            match_teams[mid] = {int(t) for t in m["teamsData"]}
            pm_all: dict[int, PlayerMatch] = {}
            info = {"team_issues": {}, "subs": 0, "unused_bench": 0, "reds": 0, "ht_subs": 0}
            info["stoppage_subs"] = 0
            for t, d in m["teamsData"].items():
                tid = int(t)
                pms, tissues = reconstruct_team_minutes(
                    tid, d["formation"], policy["minutes"]["max_substitutions_per_team"]
                )
                for iss in tissues:
                    team_issue_counter[iss] += 1
                if tissues:
                    info["team_issues"][tid] = tissues
                    for p in pms.values():
                        p.issues.append("team_structure_invalid")
                else:
                    got = sum(p.minutes(reg) for p in pms.values())
                    want = expected_team_minutes(pms, reg)
                    if abs(got - want) > 1e-6:
                        team_issue_counter["team_minutes_not_conserved"] += 1
                        info["team_issues"][tid] = ["team_minutes_not_conserved"]
                        for p in pms.values():
                            p.issues.append("team_minutes_not_conserved")
                subs = d["formation"].get("substitutions") or []
                info["subs"] += len(subs) if isinstance(subs, list) else 0
                if isinstance(subs, list):
                    info["ht_subs"] += sum(1 for s in subs if s.get("minute") in (45, 46))
                    info["stoppage_subs"] += sum(1 for s in subs if s.get("minute", 0) > reg)
                for p in pms.values():
                    if not p.started and not p.appeared:
                        info["unused_bench"] += 1
                    if p.red_minute is not None:
                        info["reds"] += 1
                        roster_red += 1
                    if p.player_id in pm_all:
                        p.issues.append("player_on_both_teams")
                    pm_all[p.player_id] = p
            rosters[mid] = pm_all
            for d in m["teamsData"].values():
                for r in (d["formation"].get("lineup") or []) + (d["formation"].get("bench") or []):
                    roster_owngoal_values[str(r.get("ownGoals"))] += 1
            match_detail[mid] = {
                "league": stem,
                "dateutc": m["dateutc"],
                "label": m["label"],
                **info,
            }
            key = (m["dateutc"], mid)
            if info["subs"]:
                edge_candidates["substitution"].append(key)
            if info["unused_bench"]:
                edge_candidates["unused_bench"].append(key)
            if info["reds"]:
                edge_candidates["dismissal"].append(key)
            if info["ht_subs"]:
                edge_candidates["halftime_substitution"].append(key)
            if info["stoppage_subs"]:
                edge_candidates["stoppage_time_substitution"].append(key)
            if any(pid not in players for pid in pm_all):
                edge_candidates["roster_id_missing_from_players_json"].append(key)
        lg["teams"] = len(teams_in_league)
        n_t = len(teams_in_league)
        lg["fixture_pairs_expected_double_round_robin"] = n_t * (n_t - 1)
        lg["fixture_pairs_observed_unique"] = len(fixtures)
        lg["fixture_pairs_duplicated"] = sum(1 for v in fixtures.values() if v > 1)
        lg["teams_missing_from_teams_json"] = len(teams_in_league - team_ids)
        lg["team_structure_issues"] = dict(team_issue_counter)
        lg["roster_dismissals"] = roster_red

        # ---- stream events -------------------------------------------------------------
        name = f"events_{stem}.json"
        ev_count = 0
        per_match_events = Counter()
        per_match_team_events: dict[int, Counter] = defaultdict(Counter)
        team_goals: dict[int, Counter] = defaultdict(Counter)
        pm_counters: dict[tuple, Counter] = defaultdict(Counter)
        pm_violations: Counter = Counter()
        pm_bench_events: Counter = Counter()
        ref = Counter()
        league_first_index = len(global_event_ids)
        id_min, id_max = None, None
        event_reds = 0
        pairing: dict[tuple, set] = defaultdict(set)
        max_sec: dict[tuple, float] = defaultdict(float)
        with ez.open(name) as fh:
            for e in iter_json_array(fh):
                ev_count += 1
                eid_ = int(e["id"])
                global_event_ids.append(eid_)
                id_min = eid_ if id_min is None else min(id_min, eid_)
                id_max = eid_ if id_max is None else max(id_max, eid_)
                mid = int(e["matchId"])
                tid = int(e["teamId"])
                pid = int(e["playerId"])
                period = e["matchPeriod"]
                sec = float(e["eventSec"])
                tags = {t.get("id") for t in e.get("tags") or []}
                if (e.get("eventId"), e.get("subEventId")) not in event_pairs:
                    unknown_pairs[(e.get("eventId"), e.get("subEventId"))] += 1
                for tg in tags - known_tags:
                    unknown_tags[tg] += 1
                if not math.isfinite(sec) or sec < 0:
                    ref["invalid_event_sec"] += 1
                for p in e.get("positions") or []:
                    if not (0 <= p.get("x", -1) <= 100 and 0 <= p.get("y", -1) <= 100):
                        ref["coordinate_out_of_range"] += 1
                if len(e.get("positions") or []) < 2:
                    ref["events_with_fewer_than_2_positions"] += 1
                max_sec[(mid, period)] = max(max_sec[(mid, period)], sec)
                if mid not in rosters:
                    ref["event_match_not_in_league_matches"] += 1
                    continue
                per_match_events[mid] += 1
                per_match_team_events[mid][tid] += 1
                if tid not in match_teams[mid]:
                    ref["event_team_not_in_match"] += 1
                    continue
                if period not in ("1H", "2H"):
                    ref["events_outside_regulation_periods"] += 1
                if 1701 in tags or 1703 in tags:
                    event_reds += 1
                # Team goals: goal tag on any non-save-attempt event (save attempts carry 101
                # for a goal conceded); own goals credit the opponent.
                if (
                    101 in tags
                    and 102 not in tags
                    and e.get("eventId") != policy["events"]["save_attempt_event_id"]
                ):
                    team_goals[mid][tid] += 1
                if 102 in tags:
                    opp = [t for t in match_teams[mid] if t != tid]
                    if opp:
                        team_goals[mid][opp[0]] += 1
                    edge_candidates["own_goal_event"].append((match_detail[mid]["dateutc"], mid))
                if e.get("eventId") == policy["events"]["duel_event_id"]:
                    pairing[(mid, period, round(sec, 3))].add(tid)
                    semantics["duel_events"] += 1
                    if e.get("subEventId") == 11:
                        semantics["attacking_duels"] += 1
                        if tags & {503, 504}:
                            semantics["attacking_duels_with_take_on_tag"] += 1
                    wl = len(tags & {701, 702, 703})
                    semantics[f"duel_outcome_tags_{wl}"] += 1
                if e.get("eventId") == 8:
                    semantics["open_play_passes"] += 1
                    if not tags & {1801, 1802}:
                        semantics["passes_without_accuracy_tag"] += 1
                    if 1801 in tags and is_placeholder_end(e.get("positions") or []):
                        semantics["accurate_passes_placeholder_end"] += 1
                pos = e.get("positions") or []
                if pos and e.get("eventId") == 10:
                    shot_start_x[0] += pos[0]["x"]
                    shot_start_x[1] += 1
                    if is_placeholder_end(pos):
                        semantics["shots_with_placeholder_end"] += 1
                    semantics["shots"] += 1
                if pos and e.get("subEventId") == 34:
                    goal_kick_x[0] += pos[0]["x"]
                    goal_kick_x[1] += 1
                if pid == 0:
                    ref["events_player_id_0"] += 1
                    pid0_by_type[f"{e.get('eventName')}/{e.get('subEventName')}"] += 1
                    edge_candidates["unattributed_player_0"].append(
                        (match_detail[mid]["dateutc"], mid)
                    )
                    continue
                pmatch = rosters[mid].get(pid)
                if pmatch is None or pmatch.team_id != tid:
                    ref["events_player_not_in_team_roster"] += 1
                    continue
                ref["events_attributed_to_rostered_player"] += 1
                k = (mid, pid)
                if not pmatch.appeared:
                    pm_bench_events[k] += 1
                else:
                    t = event_clock_minute(period, sec, first_half)
                    late = pmatch.off is not None and t > pmatch.off + tol
                    if t < pmatch.on - tol or late:
                        pm_violations[k] += 1
                count_event(pm_counters[k], e, policy)
        event_id_ranges[stem] = (id_min, id_max)
        lg["events_file"] = name
        lg["events_file_uncompressed_bytes"] = event_files.get(name)
        lg["event_records"] = ev_count
        league_ids = sorted(global_event_ids[league_first_index:])
        lg["duplicate_event_ids"] = sum(
            1 for i in range(1, len(league_ids)) if league_ids[i] == league_ids[i - 1]
        )
        del league_ids
        lg["event_reference_counts"] = dict(ref)
        lg["event_red_card_tags"] = event_reds

        # ---- per-match acceptance and goal reconciliation --------------------------------
        accepted = set()
        goal_mismatch = 0
        goal_mismatch_ids: list[int] = []
        match_by_id = {int(m["wyId"]): m for m in matches}
        roster_goal_mismatch = 0
        no_events = 0
        one_team_events = 0
        for mid in rosters:
            if per_match_events[mid] == 0:
                no_events += 1
                continue
            if len(per_match_team_events[mid]) < 2:
                one_team_events += 1
                continue
            recon = reconcile_goals(match_by_id[mid], team_goals[mid])
            match_detail[mid]["goals"] = recon
            match_detail[mid]["events"] = per_match_events[mid]
            ok = all(v["score"] == v["event_goals"] for v in recon.values())
            if not all(v["score"] == v["roster_goals_field"] for v in recon.values()):
                roster_goal_mismatch += 1
            if not ok:
                goal_mismatch += 1
                goal_mismatch_ids.append(mid)
                edge_candidates["event_goals_not_equal_score"].append(
                    (match_detail[mid]["dateutc"], mid)
                )
                if policy["require_goal_reconciliation"]:
                    continue
            accepted.add(mid)
        periods = [v / 60.0 for (m_, p_), v in max_sec.items() if p_ in ("1H", "2H")]
        lg["matches_with_no_events"] = no_events
        lg["matches_with_events_for_one_team_only"] = one_team_events
        lg["matches_event_goals_not_equal_score"] = goal_mismatch
        lg["match_ids_event_goals_not_equal_score"] = sorted(goal_mismatch_ids)
        lg["match_ids_with_team_structure_issues"] = sorted(
            mid for mid in rosters if match_detail[mid]["team_issues"]
        )
        lg["matches_roster_goal_field_not_equal_score"] = roster_goal_mismatch
        lg["matches_accepted_for_coverage"] = len(accepted)
        lg["period_last_event_minutes_min_max"] = (
            [round(min(periods), 1), round(max(periods), 1)] if periods else None
        )
        paired = sum(1 for v in pairing.values() if len(v) == 2)
        semantics["duel_timestamps"] += len(pairing)
        semantics["duel_timestamps_both_teams"] += paired
        del pairing

        # ---- fold player-matches into season totals ----------------------------------------
        funnel = Counter()
        for mid, pms in rosters.items():
            for pid, p in pms.items():
                funnel["rostered_player_matches"] += 1
                s = season_pm[pid]
                s["rostered_matches"] += 1
                if not p.appeared:
                    if pm_bench_events[(mid, pid)]:
                        funnel["unused_bench_with_attributed_events"] += 1
                    continue
                funnel["appearances"] += 1
                mins = p.minutes(reg)
                funnel["reconstructed_minutes"] += mins
                s["teams"].add((comp_id, p.team_id))
                s["leagues"].add(stem)
                s["appearances"] += 1
                s["starts"] += int(p.started)
                s["unclipped_minutes"] += p.raw_minutes_unclipped(
                    max(float(reg), first_half + max_sec.get((mid, "2H"), 0.0) / 60.0)
                )
                s["clipped_minutes_all"] += mins
                structural = bool(p.issues)
                if structural:
                    for iss in p.issues:
                        player_issue_counter[iss] += 1
                    funnel["appearances_interval_invalid"] += 1
                    s["uncertain_player_matches"] += 1
                    s["uncertain_minutes_lost"] += mins
                    continue
                s["season_minutes"] += mins
                if mid not in accepted:
                    funnel["minutes_in_unaccepted_matches"] += mins
                    continue
                if pm_violations[(mid, pid)]:
                    funnel["appearances_event_clock_conflict"] += 1
                    funnel["minutes_lost_event_clock_conflict"] += mins
                    s["uncertain_player_matches"] += 1
                    s["uncertain_minutes_lost"] += mins
                    edge_candidates["event_clock_conflict"].append(
                        (match_detail[mid]["dateutc"], mid)
                    )
                    continue
                funnel["covered_appearances"] += 1
                funnel["covered_minutes"] += mins
                s["covered_minutes"] += mins
                pmc = pm_counters.get((mid, pid), Counter())
                s["counters"].update(pmc)
                tt = (
                    match_detail[mid]
                    .setdefault("team_totals", {})
                    .setdefault(
                        str(p.team_id),
                        {"covered_minutes": 0.0, "passes": 0, "passes_completed": 0, "shots_np": 0},
                    )
                )
                tt["covered_minutes"] += mins
                tt["passes"] += pmc["passes"]
                tt["passes_completed"] += pmc["passes_completed"]
                tt["shots_np"] += pmc["shots_np"]
        lg["player_match_funnel"] = {
            k: (round(v, 1) if isinstance(v, float) else v) for k, v in sorted(funnel.items())
        }
        lg["player_interval_issues"] = dict(player_issue_counter)
        del rosters, pm_counters
        elapsed = round(time.time() - t0, 2)
        resources["phases"].append(
            {"phase": f"league:{stem}", "wall_seconds": elapsed, "peak_rss_mb": rss_mb()}
        )
        leagues_out[stem] = lg

    # ---- cross-league checks ---------------------------------------------------------------
    missing = [pid for pid in season_pm if pid not in players]
    identity["roster_player_ids_missing_from_players_json"] = len(missing)
    identity["roster_player_ids_missing_from_players_json_that_appeared"] = sum(
        1 for pid in missing if season_pm[pid]["appearances"] > 0
    )
    ranges = sorted(v for v in event_id_ranges.values() if v[0] is not None)
    overlap = any(ranges[i][1] >= ranges[i + 1][0] for i in range(len(ranges) - 1))
    all_ids = sorted(global_event_ids)
    del global_event_ids
    cross_dups = sum(1 for i in range(1, len(all_ids)) if all_ids[i] == all_ids[i - 1])
    del all_ids
    integrity = {
        "match_files": match_files,
        "event_files": event_files,
        "duplicate_match_ids_across_domestic_files": sum(
            1 for v in all_match_ids.values() if v > 1
        ),
        # Numeric ID ranges interleave across league files; uniqueness is checked directly.
        "event_id_ranges_interleave_across_leagues": overlap,
        "duplicate_event_ids_across_domestic_union": cross_dups,
        "unknown_event_subevent_pairs": {f"{a}/{b}": n for (a, b), n in unknown_pairs.items()},
        "unknown_tag_ids": {str(k): v for k, v in unknown_tags.items()},
        "player_id_0_events_by_type": dict(pid0_by_type.most_common()),
        # The roster "ownGoals" field holds values such as "2" for thousands of player rows
        # in matches without own goals, so it is not an own-goal count; events are used.
        "roster_owngoals_field_value_counts": dict(roster_owngoal_values.most_common()),
    }
    semantics_out = dict(semantics)
    semantics_out["mean_shot_start_x_0_100"] = (
        round(shot_start_x[0] / shot_start_x[1], 2) if shot_start_x[1] else None
    )
    semantics_out["mean_goal_kick_start_x_0_100"] = (
        round(goal_kick_x[0] / goal_kick_x[1], 2) if goal_kick_x[1] else None
    )

    # ---- season population & G2 funnel ---------------------------------------------------
    states = policy["metric_states"]
    ub_states = policy["upper_bound_present_states"]
    role_cfgs = {}
    for path in sorted(roles_dir.glob("*.yaml")):
        cfg = yaml.safe_load(path.read_text(encoding="utf-8"))
        role_cfgs[cfg["role_key"]] = cfg
    group_map = policy["coarse_role_to_group"]
    min_m = float(policy["min_minutes"])
    gate = float(policy["required_coverage_gate"])
    g_funnel = Counter()
    league_funnel: dict[str, Counter] = defaultdict(Counter)
    per_role_ub = Counter()
    per_role_ub_by_league: dict[str, Counter] = defaultdict(Counter)
    ub_any_role = set()
    transfers_club = 0
    transfers_league = 0
    peer_counts: dict[str, Counter] = defaultdict(Counter)
    detail_players: dict[str, list] = defaultdict(list)
    stoppage_extra = 0.0
    total_clipped = 0.0
    ages_seen = Counter()

    role_eval = {
        rk: {
            "strict": role_support(cfg, states, []),
            "upper_bound": role_support(cfg, states, ub_states),
        }
        for rk, cfg in role_cfgs.items()
    }

    for pid, s in sorted(season_pm.items()):
        steps = []
        g_funnel["rostered_unique_players"] += 1
        steps.append("rostered")
        if s["appearances"] == 0:
            _bump(g_funnel, league_funnel, s, steps)
            continue
        if len({t for (_, t) in s["teams"]}) > 1:
            transfers_club += 1
            detail_players["inter_club_transfer"].append(pid)
        if len(s["leagues"]) > 1:
            transfers_league += 1
            detail_players["inter_league_transfer"].append(pid)
        stoppage_extra += s["unclipped_minutes"] - s["clipped_minutes_all"]
        total_clipped += s["clipped_minutes_all"]
        steps.append("appeared")
        p = players.get(pid)
        if p is None or player_ids[pid] != 1:
            _bump(g_funnel, league_funnel, s, steps)
            detail_players["appeared_identity_unresolved"].append(pid)
            continue
        steps.append("identity_resolved")
        dob = parse_dob(p.get("birthDate"))
        if dob is None:
            _bump(g_funnel, league_funnel, s, steps)
            continue
        steps.append("dob_known")
        age = whole_years_on(dob, geo_ref)
        ages_seen[age] += 1
        coarse = (p.get("role") or {}).get("code2")
        group = group_map.get(coarse)
        covered_ok = s["covered_minutes"] >= min_m
        season_ok = s["season_minutes"] >= min_m
        vals = metric_values(s["counters"], s["covered_minutes"]) if covered_ok else {}
        if covered_ok and group:
            for mk, v in vals.items():
                if v is not None:
                    peer_counts[group][mk] += 1
        if age > int(policy["max_age"]):
            _bump(g_funnel, league_funnel, s, steps)
            continue
        steps.append("age_le_23_at_2018_06_30")
        if group not in ("ATT", "MID"):
            _bump(g_funnel, league_funnel, s, steps)
            continue
        steps.append("coarse_att_or_mid")
        if not season_ok:
            _bump(g_funnel, league_funnel, s, steps)
            continue
        steps.append("season_minutes_ge_450")
        if not covered_ok:
            _bump(g_funnel, league_funnel, s, steps)
            continue
        steps.append("covered_minutes_ge_450")
        _bump(g_funnel, league_funnel, s, steps)
        g_funnel[f"minutes_eligible_u23_by_coarse_group:{group}"] += 1
        detail_players["u23_att_mid_minutes_eligible"].append(pid)
        # The public release carries no granular historical position (checked above), so
        # the strict G2 steps "granular_position_known" and "eligible_role_ge_70pct" are 0.
        for rk, cfg in role_cfgs.items():
            if cfg["position_group"] != group:
                continue
            ub = role_eval[rk]["upper_bound"]
            if ub["required_fraction"] < gate:
                continue
            if all(vals.get(m) is not None for m in cfg["required_metrics"]):
                per_role_ub[rk] += 1
                ub_any_role.add(pid)
                for lgn in s["leagues"]:
                    per_role_ub_by_league[lgn][rk] += 1

    order = [
        "rostered",
        "appeared",
        "identity_resolved",
        "dob_known",
        "age_le_23_at_2018_06_30",
        "coarse_att_or_mid",
        "season_minutes_ge_450",
        "covered_minutes_ge_450",
    ]
    g2 = {
        "unique_player_funnel": {k: g_funnel[f"reached:{k}"] for k in order},
        "minutes_eligible_u23_by_coarse_group": {
            grp: g_funnel[f"minutes_eligible_u23_by_coarse_group:{grp}"] for grp in ("ATT", "MID")
        },
        "unique_player_funnel_strict_tail": {
            "granular_historical_position_known": 0,
            "eligible_role_with_ge_70pct_validated_required_metrics": 0,
        },
        "strict_g2_unique_qualifying_u23": 0,
        "strict_g2_target": policy["g2_target_unique_players"],
        "per_league_membership_funnel": {
            lgn: {k: c[f"reached:{k}"] for k in order} for lgn, c in sorted(league_funnel.items())
        },
        "diagnostic_upper_bound_not_a_g2_count": {
            "definition": (
                "Unique U23 coarse ATT/MID players with >=450 season and covered minutes "
                "whose coarse group matches a role's position_group, where every required "
                "metric of that role is in an upper-bound candidate state AND non-null for "
                "the player. Ignores granular position eligibility and treats unvalidated "
                "candidate mappings as present. Not a G2 pass."
            ),
            "unique_players_any_role": len(ub_any_role),
            "per_role": dict(sorted(per_role_ub.items())),
            "per_league_membership_per_role": {
                k: dict(sorted(v.items())) for k, v in sorted(per_role_ub_by_league.items())
            },
        },
        "transfers": {
            "players_with_more_than_one_domestic_club": transfers_club,
            "players_in_more_than_one_domestic_league": transfers_league,
        },
        "minutes_policy_sensitivity": {
            "total_regulation_clipped_minutes": round(total_clipped, 1),
            "additional_minutes_if_stoppage_credited_literally": round(stoppage_extra, 1),
        },
        "age_distribution_counts_at_reference": dict(sorted(ages_seen.items())),
    }
    roles_out = {}
    for rk, cfg in sorted(role_cfgs.items()):
        ev = role_eval[rk]
        roles_out[rk] = {
            "position_group": cfg["position_group"],
            "eligible_positions": cfg.get("eligible_positions", []),
            "required_metrics": cfg["required_metrics"],
            "strict_required_fraction": round(ev["strict"]["required_fraction"], 4),
            "strict_weighted_support": round(ev["strict"]["weighted_support"], 4),
            "upper_bound_required_fraction": round(ev["upper_bound"]["required_fraction"], 4),
            "upper_bound_required_missing": ev["upper_bound"]["required_missing"],
            "upper_bound_weighted_support": round(ev["upper_bound"]["weighted_support"], 4),
            "upper_bound_groups_without_support": ev["upper_bound"]["groups_without_support"],
            "upper_bound_clears_70pct": ev["upper_bound"]["required_fraction"] >= gate,
            "granular_position_available": False,
        }
    resources["total_wall_seconds"] = round(time.time() - t_start, 2)
    resources["peak_rss_mb"] = rss_mb()
    report = {
        "identity": identity,
        "leagues": leagues_out,
        "integrity": integrity,
        "event_semantics_probes": semantics_out,
        "g2": g2,
        "roles": roles_out,
        "peer_counts_covered_ge_450_all_ages_by_coarse_group": {
            g: dict(sorted(c.items())) for g, c in sorted(peer_counts.items())
        },
        "metric_states": states,
    }
    sample["edge_cases"] = {
        k: sorted(set(v))[0][1] for k, v in sorted(edge_candidates.items()) if v
    }
    sample["edge_case_match_counts"] = {k: len(set(v)) for k, v in sorted(edge_candidates.items())}
    sample_ids = sorted(
        {m for d in sample["pinned"].values() for m in d.values()}
        | set(sample["edge_cases"].values())
    )
    sample["matches"] = {str(mid): match_detail.get(mid) for mid in sample_ids}
    report["sample"] = sample
    detail = {
        "note": "LOCAL ONLY - provider player IDs for reviewer spot-checks; never commit.",
        "players": {k: sorted(v) for k, v in detail_players.items()},
        "upper_bound_players": sorted(ub_any_role),
    }
    return report, resources, detail


def _bump(total: Counter, per_league: dict, s: dict, steps: list) -> None:
    for st in steps:
        total[f"reached:{st}"] += 1
        for lgn in s["leagues"] or {"(never_appeared)"}:
            per_league[lgn][f"reached:{st}"] += 1


def fingerprint(obj: Any) -> str:
    payload = json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Wyscout 2017/18 P0 feasibility analysis")
    ap.add_argument("--raw", default="data/raw/wyscout")
    ap.add_argument("--policy", default=str(DEFAULT_POLICY))
    ap.add_argument("--roles", default=str(DEFAULT_ROLES))
    ap.add_argument("--output", required=True)
    ap.add_argument("--local-detail")
    ap.add_argument("--leagues", nargs="*", help="subset of league stems (e.g. Germany)")
    args = ap.parse_args(argv)
    raw = Path(args.raw)
    policy = yaml.safe_load(Path(args.policy).read_text(encoding="utf-8"))
    acq = json.loads((raw / "acquisition_record.json").read_text(encoding="utf-8"))
    report, resources, detail = analyze(raw, policy, Path(args.roles), args.leagues)
    report["inputs"] = {
        "policy_version": policy["version"],
        "policy_sha256": hashlib.sha256(Path(args.policy).read_bytes()).hexdigest(),
        "files": [
            {k: f[k] for k in ("role", "doi", "file_id", "name", "size", "md5", "sha256")}
            for f in acq["files"]
        ],
        "leagues_requested": args.leagues or "all_domestic",
    }
    report["deterministic_fingerprint_sha256"] = fingerprint(report)
    report["resources_non_deterministic"] = resources
    report["resources_non_deterministic"]["raw_dir_bytes"] = sum(
        p.stat().st_size for p in raw.iterdir() if p.is_file()
    )
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=1, sort_keys=True, default=str) + "\n")
    if args.local_detail:
        Path(args.local_detail).write_text(json.dumps(detail, indent=1) + "\n")
    print(
        json.dumps(
            {
                "fingerprint": report["deterministic_fingerprint_sha256"],
                "strict_g2": report["g2"]["strict_g2_unique_qualifying_u23"],
                "upper_bound": report["g2"]["diagnostic_upper_bound_not_a_g2_count"][
                    "unique_players_any_role"
                ],
                "resources": resources,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
