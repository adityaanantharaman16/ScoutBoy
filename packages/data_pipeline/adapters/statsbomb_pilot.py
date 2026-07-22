"""StatsBomb Open Data → canonical player-season metrics (pilot).

Implements docs/metric_definitions_statsbomb_v1.md deterministically. Reads a local,
immutable snapshot directory (no runtime fetching), computes per-match minutes and event
counts, aggregates to player-season, and converts to canonical per-90 / weighted-pct
metrics. Missing ⇒ null (omitted), never zero.

Public:
    derive_player_seasons(snapshot_dir, competition_id, season_id, season_label) -> list[dict]
    StatsBombPilotAdapter(...).fetch() -> IngestBundle  (CanonicalMetric rows, id_source=statsbomb)
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Optional

import yaml

from .base import (
    CanonicalMetric,
    CanonicalPlayer,
    CanonicalSeason,
    IngestBundle,
    ProviderCapabilities,
    SourceAdapter,
)
from .transfermarkt_adapter import map_player_row

SOURCE_NAME = "statsbomb"

# pitch constants (StatsBomb 120 x 80; attacking toward x=120)
FINAL_THIRD_X = 80.0
BOX_X, BOX_Y_LO, BOX_Y_HI = 102.0, 18.0, 62.0
PROG_PASS_GAIN, PROG_CARRY_GAIN, OPP_HALF_X = 10.0, 5.0, 60.0
ON_TARGET = {"Goal", "Saved", "Saved To Post"}
GROUND_DUEL_WON = {"Won", "Success", "Success In Play", "Success Out"}


def _name_key(value: Optional[str]) -> str:
    value = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _load_tm_players(path: Path) -> tuple[dict[str, dict], dict[str, list[dict]]]:
    by_id, by_name = {}, defaultdict(list)
    with open(path / "players.csv", newline="") as f:
        for row in csv.DictReader(f):
            by_id[row["player_id"]] = row
            by_name[_name_key(row["name"])].append(row)
    return by_id, by_name


def _match_tm_player(
    player_name: str, by_id: dict[str, dict], by_name: dict[str, list[dict]], overrides: dict
) -> tuple[Optional[dict], str]:
    override_id = str(overrides.get(player_name, ""))
    if override_id:
        return by_id.get(override_id), "manual_override"
    key = _name_key(player_name)
    exact = by_name.get(key, [])
    if len(exact) == 1:
        return exact[0], "exact_normalized_name"
    contained = []
    for candidate_key, rows in by_name.items():
        if len(candidate_key) >= 8 and (candidate_key in key or key in candidate_key):
            contained.extend(rows)
    if len(contained) == 1:
        return contained[0], "unique_contained_name"
    return None, "ambiguous" if exact or contained else "unmatched"


def _dist_goal(loc) -> float:
    return math.hypot(120.0 - loc[0], 40.0 - loc[1])


def _in_box(loc) -> bool:
    return bool(loc) and loc[0] >= BOX_X and BOX_Y_LO <= loc[1] <= BOX_Y_HI


def _match_minutes(events: list[dict]) -> tuple[dict, float]:
    """player_id -> minutes on pitch, plus full-time minute, from events."""
    half_end = [e["minute"] for e in events if e["type"]["name"] == "Half End"]
    ft = float(max(half_end)) if half_end else float(max(e["minute"] for e in events))
    on: dict[int, float] = {}
    off: dict[int, float] = {}
    for e in events:
        t = e["type"]["name"]
        if t == "Starting XI":
            for pl in e.get("tactics", {}).get("lineup", []):
                on[pl["player"]["id"]] = 0.0
        elif t == "Substitution":
            off[e["player"]["id"]] = float(e["minute"])
            rep = e.get("substitution", {}).get("replacement")
            if rep:
                on[rep["id"]] = float(e["minute"])
        elif t in ("Foul Committed", "Bad Behaviour"):
            block = e.get("foul_committed") or e.get("bad_behaviour") or {}
            card = (block.get("card") or {}).get("name", "")
            if ("Red" in card or "Second Yellow" in card) and e.get("player"):
                off[e["player"]["id"]] = float(e["minute"])
    mins = {pid: max(0.0, min(ft, off.get(pid, ft)) - onm) for pid, onm in on.items()}
    return mins, ft


def _blank_counts() -> dict:
    keys = [
        "np_goals",
        "np_xg",
        "shots",
        "shots_on_target",
        "touches_in_box",
        "assists",
        "xa",
        "key_passes",
        "sca",
        "passes_final_third",
        "passes_box",
        "through_balls",
        "crosses",
        "prog_passes",
        "passes_under_pressure",
        "passes",
        "passes_completed",
        "prog_carries",
        "carries_final_third",
        "carries_box",
        "dribbles",
        "dribbles_complete",
        "miscontrols",
        "dispossessed",
        "tackles",
        "interceptions",
        "blocks",
        "recoveries",
        "clearances",
        "pressures",
        "counterpressures",
        "fouls",
        "aerial_won",
        "aerial_lost",
        "ground_duels",
        "ground_duels_won",
    ]
    return {k: 0.0 for k in keys}


def _accumulate_match(events: list[dict], counts: dict, names: dict, teams: dict) -> None:
    # precompute xA (shot.key_pass_id -> xg) and SCA (2 actions before each shot)
    pass_player = {e["id"]: e for e in events if e["type"]["name"] == "Pass"}
    for e in events:
        if e["type"]["name"] == "Shot":
            kp = e.get("shot", {}).get("key_pass_id")
            if kp and kp in pass_player and e["shot"].get("type", {}).get("name") != "Penalty":
                ap = pass_player[kp]
                counts[ap["player"]["id"]]["xa"] += float(e["shot"].get("statsbomb_xg", 0) or 0)
    # SCA: up to 2 offensive actions in the same possession immediately before a shot
    by_possession: dict[int, list[dict]] = defaultdict(list)
    for e in events:
        by_possession[e.get("possession")].append(e)
    for e in events:
        if e["type"]["name"] != "Shot":
            continue
        seq = by_possession.get(e.get("possession"), [])
        idx = seq.index(e)
        credited = 0
        j = idx - 1
        while j >= 0 and credited < 2:
            a = seq[j]
            if a["type"]["name"] in ("Pass", "Carry", "Dribble") and a.get("player"):
                counts[a["player"]["id"]]["sca"] += 1
                credited += 1
            j -= 1

    for e in events:
        pl = e.get("player")
        if not pl:
            continue
        pid = pl["id"]
        names.setdefault(pid, pl.get("name"))
        if e.get("team"):
            teams[pid] = e["team"]["name"]
        c = counts[pid]
        t = e["type"]["name"]
        loc = e.get("location")
        up = e.get("under_pressure", False)
        if loc and _in_box(loc) and t in ("Pass", "Ball Receipt*", "Carry", "Shot", "Dribble"):
            c["touches_in_box"] += 1
        if t == "Shot":
            sh = e["shot"]
            if sh.get("type", {}).get("name") != "Penalty":
                c["shots"] += 1
                c["np_xg"] += float(sh.get("statsbomb_xg", 0) or 0)
                if sh.get("outcome", {}).get("name") == "Goal":
                    c["np_goals"] += 1
                if sh.get("outcome", {}).get("name") in ON_TARGET:
                    c["shots_on_target"] += 1
        elif t == "Pass":
            p = e["pass"]
            c["passes"] += 1
            completed = "outcome" not in p  # incomplete passes carry an outcome
            if completed:
                c["passes_completed"] += 1
            if up:
                c["passes_under_pressure"] += 1
            if p.get("goal_assist"):
                c["assists"] += 1
            if p.get("shot_assist") or p.get("goal_assist"):
                c["key_passes"] += 1
            if p.get("cross"):
                c["crosses"] += 1
            if p.get("technique", {}).get("name") == "Through Ball":
                c["through_balls"] += 1
            end = p.get("end_location")
            if completed and loc and end:
                if loc[0] < FINAL_THIRD_X <= end[0]:
                    c["passes_final_third"] += 1
                if _in_box(end) and not _in_box(loc):
                    c["passes_box"] += 1
                if _dist_goal(loc) - _dist_goal(end) >= PROG_PASS_GAIN and end[0] >= OPP_HALF_X:
                    c["prog_passes"] += 1
        elif t == "Carry":
            end = e.get("carry", {}).get("end_location")
            if loc and end:
                if loc[0] < FINAL_THIRD_X <= end[0]:
                    c["carries_final_third"] += 1
                if _in_box(end) and not _in_box(loc):
                    c["carries_box"] += 1
                if _dist_goal(loc) - _dist_goal(end) >= PROG_CARRY_GAIN and end[0] >= OPP_HALF_X:
                    c["prog_carries"] += 1
        elif t == "Dribble":
            c["dribbles"] += 1
            if e.get("dribble", {}).get("outcome", {}).get("name") == "Complete":
                c["dribbles_complete"] += 1
        elif t == "Miscontrol":
            c["miscontrols"] += 1
        elif t == "Dispossessed":
            c["dispossessed"] += 1
        elif t == "Interception":
            if not e.get("interception", {}).get("outcome", {}).get("name", "").startswith("Lost"):
                c["interceptions"] += 1
        elif t == "Block":
            c["blocks"] += 1
        elif t == "Ball Recovery":
            if not e.get("ball_recovery", {}).get("recovery_failure"):
                c["recoveries"] += 1
        elif t == "Clearance":
            c["clearances"] += 1
        elif t == "Pressure":
            c["pressures"] += 1
            if e.get("counterpress"):
                c["counterpressures"] += 1
        elif t == "Foul Committed":
            c["fouls"] += 1
        elif t == "Duel":
            d = e.get("duel", {}).get("type", {}).get("name", "")
            outcome = e.get("duel", {}).get("outcome", {}).get("name", "")
            if d == "Tackle":
                c["tackles"] += 1
                c["ground_duels"] += 1
                if outcome in GROUND_DUEL_WON:
                    c["ground_duels_won"] += 1
            elif d == "Aerial Lost":
                c["aerial_lost"] += 1
        if e.get("counterpress") and t != "Pressure":
            pass  # counterpress flag on other events is not counted as a pressure
        if e.get("aerial_won"):
            c["aerial_won"] += 1


def _per90(count: float, minutes: float) -> Optional[float]:
    if minutes <= 0:
        return None
    return round(count * 90.0 / minutes, 3)


def _pct(num: float, den: float) -> Optional[float]:
    if den <= 0:
        return None
    return round(100.0 * num / den, 1)


def _canonical(c: dict, minutes: float) -> dict:
    m = {
        "non_penalty_goals_per90": _per90(c["np_goals"], minutes),
        "non_penalty_xg_per90": _per90(c["np_xg"], minutes),
        "shots_per90": _per90(c["shots"], minutes),
        "shots_on_target_pct": _pct(c["shots_on_target"], c["shots"]),
        "touches_in_box_per90": _per90(c["touches_in_box"], minutes),
        "assists_per90": _per90(c["assists"], minutes),
        "xa_per90": _per90(c["xa"], minutes),
        "key_passes_per90": _per90(c["key_passes"], minutes),
        "shot_creating_actions_per90": _per90(c["sca"], minutes),
        "passes_into_final_third_per90": _per90(c["passes_final_third"], minutes),
        "passes_into_penalty_area_per90": _per90(c["passes_box"], minutes),
        "through_balls_per90": _per90(c["through_balls"], minutes),
        "crosses_per90": _per90(c["crosses"], minutes),
        "progressive_passes_per90": _per90(c["prog_passes"], minutes),
        "progressive_carries_per90": _per90(c["prog_carries"], minutes),
        "carries_into_final_third_per90": _per90(c["carries_final_third"], minutes),
        "carries_into_penalty_area_per90": _per90(c["carries_box"], minutes),
        "successful_take_ons_per90": _per90(c["dribbles_complete"], minutes),
        "take_on_success_pct": _pct(c["dribbles_complete"], c["dribbles"]),
        "passes_per90": _per90(c["passes"], minutes),
        "pass_completion_pct": _pct(c["passes_completed"], c["passes"]),
        "passes_under_pressure_per90": _per90(c["passes_under_pressure"], minutes),
        "miscontrols_per90": _per90(c["miscontrols"], minutes),
        "dispossessed_per90": _per90(c["dispossessed"], minutes),
        "turnovers_per90": _per90(c["miscontrols"] + c["dispossessed"], minutes),
        "tackles_per90": _per90(c["tackles"], minutes),
        "interceptions_per90": _per90(c["interceptions"], minutes),
        "blocks_per90": _per90(c["blocks"], minutes),
        "pressures_per90": _per90(c["pressures"], minutes),
        "counterpressures_per90": _per90(c["counterpressures"], minutes),
        "ball_recoveries_per90": _per90(c["recoveries"], minutes),
        "defensive_actions_per90": _per90(
            c["tackles"] + c["interceptions"] + c["blocks"] + c["recoveries"] + c["clearances"],
            minutes,
        ),
        "ground_duels_won_pct": _pct(c["ground_duels_won"], c["ground_duels"]),
        "aerial_duels_won_pct": _pct(c["aerial_won"], c["aerial_won"] + c["aerial_lost"]),
        "fouls_per90": _per90(c["fouls"], minutes),
        "goals_minus_xg_per90": (
            _per90(c["np_goals"] - c["np_xg"], minutes) if minutes > 0 else None
        ),
    }
    return {k: v for k, v in m.items() if v is not None}


def derive_player_seasons(
    snapshot_dir: Path,
    competition_id: int,
    season_id: int,
    season_label: str,
) -> list[dict]:
    snapshot_dir = Path(snapshot_dir)
    matches = json.load(open(snapshot_dir / "matches" / str(competition_id) / f"{season_id}.json"))
    counts: dict[int, dict] = defaultdict(_blank_counts)
    minutes: dict[int, float] = defaultdict(float)
    match_ct: dict[int, int] = defaultdict(int)
    names: dict[int, str] = {}
    teams: dict[int, str] = {}
    for mt in matches:
        mid = mt["match_id"]
        ev_path = snapshot_dir / "events" / f"{mid}.json"
        if not ev_path.exists():
            continue
        events = json.load(open(ev_path))
        mm, _ft = _match_minutes(events)
        for pid, mn in mm.items():
            minutes[pid] += mn
            if mn > 0:
                match_ct[pid] += 1
        _accumulate_match(events, counts, names, teams)

    out = []
    for pid, mins in minutes.items():
        out.append(
            {
                "statsbomb_player_id": pid,
                "player_name": names.get(pid),
                "team_name": teams.get(pid),
                "minutes": round(mins, 1),
                "matches": match_ct[pid],
                "metrics": _canonical(counts[pid], mins),
            }
        )
    out.sort(key=lambda r: -r["minutes"])
    return out


class StatsBombPilotAdapter(SourceAdapter):
    name = SOURCE_NAME
    capabilities = ProviderCapabilities(
        provider_id=SOURCE_NAME,
        display_name="StatsBomb Open Data pilot mapping",
        provider_type="event",
        ingestion_mode="local_snapshot",
        credentials_required=False,
        supported_entities=frozenset({"players", "seasons", "appearances", "events"}),
        supported_metric_keys=frozenset({"performance_covered_minutes"}),
        supported_metric_families=frozenset({"performance", "event"}),
        coverage_dimensions=frozenset({"competition", "season", "match", "player"}),
        freshness_semantics="pinned manifest snapshot",
        attribution_required=True,
        attribution="StatsBomb Open Data",
        license_url="https://github.com/statsbomb/open-data/blob/master/LICENSE.pdf",
        known_limitations=("Bayer Leverkusen-centered 34-match Bundesliga 2023/24 pilot only.",),
    )

    def __init__(
        self,
        snapshot_dir: Path,
        competition_id: int = 9,
        season_id: int = 281,
        season_label: str = "2023/2024",
        min_minutes: int = 0,
        transfermarkt_dir: Optional[Path] = None,
        overrides_path: Optional[Path] = None,
    ):
        self.snapshot_dir = Path(snapshot_dir)
        self.competition_id = competition_id
        self.season_id = season_id
        self.season_label = season_label
        self.min_minutes = min_minutes
        self.transfermarkt_dir = Path(transfermarkt_dir) if transfermarkt_dir else None
        self.overrides_path = Path(overrides_path) if overrides_path else None

    def fetch(self) -> IngestBundle:
        rows = derive_player_seasons(
            self.snapshot_dir, self.competition_id, self.season_id, self.season_label
        )
        bundle = IngestBundle(
            source_name=SOURCE_NAME,
            source_snapshot_id=f"statsbomb@{self.competition_id}-{self.season_id}",
            seasons=[
                CanonicalSeason(
                    label=self.season_label,
                    is_current=True,
                    start_date="2023-08-01",
                    end_date="2024-06-30",
                )
            ],
        )
        manifest_path = (
            self.snapshot_dir.parent.parent / "manifests" / "statsbomb_bundesliga_2023_24.json"
        )
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text())
            bundle.snapshot_metadata = {
                "provider": manifest.get("provider", "StatsBomb Open Data"),
                "dataset_version": manifest.get("dataset_version_commit"),
                "as_of_date": "2024-06-30",
                "target_season": self.season_label,
                "local_path": str(self.snapshot_dir),
                "checksum": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
                "license_url": manifest.get("license_url"),
                "row_counts": manifest.get("counts", {}),
                "metadata": {
                    "source_url": manifest.get("source_url"),
                    "coverage": "34-match Bayer Leverkusen-centered vertical slice",
                },
            }

        by_id: dict[str, dict] = {}
        by_name: dict[str, list[dict]] = {}
        overrides = {}
        if self.transfermarkt_dir:
            by_id, by_name = _load_tm_players(self.transfermarkt_dir)
            if self.overrides_path and self.overrides_path.exists():
                overrides = yaml.safe_load(self.overrides_path.read_text()).get(
                    "statsbomb_to_transfermarkt", {}
                )
        unmatched, ambiguous, matched = [], [], 0
        for r in rows:
            if r["minutes"] < self.min_minutes:
                continue
            spid = str(r["statsbomb_player_id"])
            if by_id:
                tm_row, method = _match_tm_player(r["player_name"] or "", by_id, by_name, overrides)
                if tm_row is None:
                    (ambiguous if method == "ambiguous" else unmatched).append(
                        {"statsbomb_id": spid, "name": r["player_name"], "team": r["team_name"]}
                    )
                    bundle.quarantine_candidates.append(
                        {
                            "entity_type": "player",
                            "external_id": spid,
                            "reason_code": "unresolved_or_ambiguous_player_identity",
                            "severity": "warning",
                            "context": {
                                "match_method": method,
                                "provider_player_name": r["player_name"],
                                "provider_team_name": r["team_name"],
                            },
                        }
                    )
                    continue
                tm_player = map_player_row(tm_row)
                bundle.players.append(
                    CanonicalPlayer(
                        source_name=SOURCE_NAME,
                        source_player_id=spid,
                        canonical_name=tm_player.canonical_name,
                        birth_date=tm_player.birth_date,
                        nationality=tm_player.nationality,
                        preferred_foot=tm_player.preferred_foot,
                        height_cm=tm_player.height_cm,
                        primary_position=tm_player.primary_position,
                        source_url=tm_player.source_url,
                        raw_name=r["player_name"],
                    )
                )
                matched += 1
            payload = {
                "player_name": r["player_name"],
                "team_name": r["team_name"],
                "minutes": r["minutes"],
                "matches": r["matches"],
                "scope": "covered_matches",
            }
            bundle.metrics.append(
                CanonicalMetric(
                    source_player_id=spid,
                    season_label=self.season_label,
                    metric_name="performance_covered_minutes",
                    metric_value=r["minutes"],
                    unit="count",
                    id_source_name=SOURCE_NAME,
                    raw_payload=payload,
                    metric_provider=SOURCE_NAME,
                    scope="covered_matches",
                )
            )
            for name, value in r["metrics"].items():
                bundle.metrics.append(
                    CanonicalMetric(
                        source_player_id=spid,
                        season_label=self.season_label,
                        metric_name=name,
                        metric_value=value,
                        unit="pct" if name.endswith("_pct") else "per90",
                        id_source_name=SOURCE_NAME,
                        raw_payload=payload,
                        metric_provider=SOURCE_NAME,
                        scope="covered_matches",
                    )
                )
        bundle.adapter_warnings.extend(
            [
                {
                    "check": "statsbomb_identity_unmatched",
                    "severity": "warn" if unmatched else "ok",
                    "count": len(unmatched),
                    "details": unmatched[:10],
                },
                {
                    "check": "statsbomb_identity_ambiguous",
                    "severity": "warn" if ambiguous else "ok",
                    "count": len(ambiguous),
                    "details": ambiguous[:10],
                },
                {
                    "check": "statsbomb_identity_matched",
                    "severity": "ok",
                    "count": matched,
                    "details": [],
                },
            ]
        )
        return bundle


if __name__ == "__main__":  # smoke run on the real snapshot
    import sys

    from rolefit.paths import repo_root

    rows = derive_player_seasons(repo_root() / "data/raw/statsbomb", 9, 281, "2023/2024")
    covered = [r for r in rows if r["minutes"] >= 450]
    print(f"players with minutes>0: {len(rows)} | >=450 covered minutes: {len(covered)}")
    print(
        f"{'player':28} {'team':22} {'min':>5} {'npxg90':>7} {'prog_car':>8} {'kp90':>5} {'takeon%':>7}"
    )
    for r in covered[:20]:
        m = r["metrics"]
        print(
            f"{(r['player_name'] or '?')[:27]:28} {(r['team_name'] or '?')[:21]:22} "
            f"{r['minutes']:5.0f} {m.get('non_penalty_xg_per90', float('nan')):7.2f} "
            f"{m.get('progressive_carries_per90', float('nan')):8.2f} "
            f"{m.get('key_passes_per90', float('nan')):5.2f} "
            f"{m.get('take_on_success_pct', float('nan')):7.1f}"
        )
    sys.exit(0)
