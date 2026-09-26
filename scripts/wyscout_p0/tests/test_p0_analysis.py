"""Golden/edge tests for the P0 Wyscout feasibility tooling (card t_44597dd8).

Synthetic, hand-computed inputs only: no Wyscout payload is committed or downloaded.
"""

from __future__ import annotations

import hashlib
import io
import json
import sys
import zipfile
from collections import Counter
from datetime import date
from pathlib import Path

import pytest
import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import fetch_sources  # noqa: E402
import p0_analysis as p0  # noqa: E402
import verify_counts  # noqa: E402

POLICY = yaml.safe_load((HERE.parent / "p0_policy.yaml").read_text(encoding="utf-8"))
ROLES_DIR = HERE.parents[2] / "configs" / "roles"


def load_role(key: str) -> dict:
    return yaml.safe_load((ROLES_DIR / f"{key}.yaml").read_text(encoding="utf-8"))


# ---------------------------------------------------------------- streaming parser


@pytest.mark.parametrize("chunk", [1, 3, 7, 64, 1 << 20])
def test_iter_json_array_matches_json_loads_at_any_chunk_boundary(chunk):
    data = [
        {"a": 1, "b": [1, 2, {"c": "x,]y"}]},
        12345678901,
        -0.25,
        "s\u00e9",
        [],
        {},
        True,
        None,
    ]
    raw = json.dumps(data).encode("utf-8")
    assert list(p0.iter_json_array(io.BytesIO(raw), chunk_chars=chunk)) == data


def test_iter_json_array_empty_and_rejects_non_array():
    assert list(p0.iter_json_array(io.BytesIO(b" [ ] "))) == []
    with pytest.raises(ValueError):
        list(p0.iter_json_array(io.BytesIO(b'{"a": 1}')))
    with pytest.raises((ValueError, json.JSONDecodeError)):
        list(p0.iter_json_array(io.BytesIO(b"[1, 2")))


# ---------------------------------------------------------------- scalar helpers


def test_roster_minute_semantics():
    assert p0.roster_minute("0") is None
    assert p0.roster_minute("null") is None
    assert p0.roster_minute(None) is None
    assert p0.roster_minute("71") == 71
    assert p0.roster_minute("x") is None


def test_age_reference_boundary_is_whole_years_on_2018_06_30():
    ref = date(2018, 6, 30)
    assert p0.whole_years_on(date(1994, 6, 30), ref) == 24  # birthday on the reference date
    assert p0.whole_years_on(date(1994, 7, 1), ref) == 23  # one day later: still 23
    assert p0.parse_dob("1994-07-01") == date(1994, 7, 1)
    assert p0.parse_dob("") is None
    assert p0.parse_dob("1994-13-01") is None


def test_event_clock_minute_maps_halves_to_roster_clock():
    assert p0.event_clock_minute("1H", 60) == 1.0
    assert p0.event_clock_minute("1H", 47 * 60) == 45.0  # 1H stoppage clamps to 45
    assert p0.event_clock_minute("2H", 48 * 60) == 93.0  # 2H stoppage stays beyond 90
    assert p0.event_clock_minute("E1", 1) == float("inf")


# ---------------------------------------------------------------- minutes


def roster(pid):
    return {"playerId": pid, "redCards": "0", "yellowCards": "0", "goals": "null", "ownGoals": "0"}


def formation(subs, reds=None, lineup=range(1, 12), bench=range(12, 19)):
    reds = reds or {}
    rows_l = [dict(roster(p), redCards=str(reds.get(p, 0))) for p in lineup]
    rows_b = [dict(roster(p), redCards=str(reds.get(p, 0))) for p in bench]
    return {"lineup": rows_l, "bench": rows_b, "substitutions": subs}


def test_minutes_substitution_unused_bench_halftime_and_stoppage():
    subs = [
        {"playerOut": 1, "playerIn": 12, "minute": 46},  # halftime change
        {"playerOut": 2, "playerIn": 13, "minute": 61},
        {"playerOut": 3, "playerIn": 14, "minute": 93},  # stoppage-time entry
    ]
    players, issues = p0.reconstruct_team_minutes(100, formation(subs))
    assert issues == []
    assert players[1].minutes() == 46 and players[12].minutes() == 44
    assert players[2].minutes() == 61 and players[13].minutes() == 29
    assert players[3].minutes() == 90  # clipped: leaves after regulation
    assert players[14].appeared and players[14].minutes() == 0  # appearance with 0 minutes
    assert not players[15].appeared and players[15].minutes() == 0  # unused bench
    assert sum(p.minutes() for p in players.values()) == 11 * 90
    assert p0.expected_team_minutes(players) == 990


def test_minutes_red_cards_starter_substitute_and_bench():
    subs = [{"playerOut": 4, "playerIn": 12, "minute": 60}]
    reds = {5: 70, 12: 80, 16: 85}  # starter, used sub, unused bench player
    players, issues = p0.reconstruct_team_minutes(100, formation(subs, reds))
    assert issues == []
    assert players[5].minutes() == 70
    assert players[12].minutes() == 20  # on 60, dismissed 80
    assert not players[16].appeared  # bench dismissal: no exposure invented
    total = sum(p.minutes() for p in players.values())
    assert total == p0.expected_team_minutes(players) == 990 - 20 - 10


def test_invalid_substitution_is_flagged_not_guessed():
    subs = [{"playerOut": 1, "playerIn": 0, "minute": 74}]  # observed in Italy 2017/18
    players, issues = p0.reconstruct_team_minutes(100, formation(subs))
    assert "substitution_player_not_in_roster" in issues
    assert "invalid_substitution" in players[1].issues
    assert players[1].off is None  # not silently subbed off


def test_same_player_subbed_off_twice_is_invalid():
    subs = [
        {"playerOut": 1, "playerIn": 12, "minute": 50},
        {"playerOut": 1, "playerIn": 13, "minute": 60},
    ]
    players, _ = p0.reconstruct_team_minutes(100, formation(subs))
    assert "invalid_substitution" in players[1].issues
    assert "invalid_substitution" in players[13].issues
    assert not players[13].appeared


def test_short_lineup_is_team_structure_issue():
    players, issues = p0.reconstruct_team_minutes(100, formation([], lineup=range(1, 11)))
    assert "starting_lineup_not_11" in issues


# ---------------------------------------------------------------- event counting


def ev(eid, sub, tags=(), pos=((50, 50), (60, 50))):
    return {
        "eventId": eid,
        "subEventId": sub,
        "tags": [{"id": t} for t in tags],
        "positions": [{"x": x, "y": y} for x, y in pos],
    }


def counts(*events):
    c = Counter()
    for e in events:
        p0.count_event(c, e, POLICY)
    return c


def test_pass_geometry_final_third_progressive_and_placeholder_exclusion():
    # (60,50)->(75,50) in 0-100 == (72,40)->(90,40) in 120x80: gain 18, crosses x=80
    c = counts(ev(8, 85, [1801], ((60, 50), (75, 50))))
    assert c["passes"] == 1 and c["passes_completed"] == 1
    assert c["final_third_passes"] == 1 and c["prog_passes"] == 1
    # (0,0) is a missing-location placeholder: counted as a pass, never as geometry
    c = counts(ev(8, 85, [1801], ((60, 50), (0, 0))), ev(3, 34, [1801], ((0, 0), (60, 50))))
    assert c["passes"] == 2 and c["pass_geometry_unusable"] == 2
    assert c["prog_passes"] == 0 and c["final_third_passes"] == 0
    # inaccurate pass: attempted but no completion or geometry credit
    c = counts(ev(8, 85, [1802], ((60, 50), (75, 50))))
    assert c["passes"] == 1 and c["passes_completed"] == 0 and c["prog_passes"] == 0


def test_shots_goals_penalties_and_own_goals():
    c = counts(
        ev(10, 100, [101, 1801]),  # open-play goal
        ev(3, 33, [1801]),  # free-kick shot
        ev(3, 35, [101, 1801]),  # penalty goal: excluded from non-penalty counts
        ev(7, 72, [102]),  # own goal touch: never the player's goal
    )
    assert c["shots_np"] == 2 and c["goals_np"] == 1 and c["penalties"] == 1


def test_duels_take_ons_air_and_interceptions():
    c = counts(
        ev(1, 11, [503, 703, 1801]),  # take-on won
        ev(1, 11, [504, 701, 1802]),  # take-on lost
        ev(1, 11, [702]),  # attacking duel without take-on tag
        ev(1, 10, [703]),  # air duel won
        ev(1, 12, [1401, 703]),  # defending duel won with interception tag
    )
    assert c["takeon_attempts"] == 2 and c["takeon_won"] == 1
    assert c["ground_duels"] == 4 and c["ground_duels_won"] == 2
    assert c["aerial_duels"] == 1 and c["aerial_won"] == 1
    assert c["interceptions"] == 1


def test_zero_denominators_are_unknown_not_zero():
    vals = p0.metric_values(Counter(), 0)
    assert all(v is None for v in vals.values())
    vals = p0.metric_values(Counter({"passes": 0}), 900)
    assert vals["pass_completion_pct"] is None  # zero attempts => unknown
    assert vals["passes_per90"] == 0.0  # observed zero with a valid denominator


# ---------------------------------------------------------------- roles / sample / goals


def test_role_support_exact_fractions_and_two_of_three_fails_the_gate():
    states = POLICY["metric_states"]
    ub = POLICY["upper_bound_present_states"]
    dlp = p0.role_support(load_role("deep_lying_playmaker"), states, ub)
    assert dlp["required_fraction"] == 1.0
    bwm = p0.role_support(load_role("ball_winning_midfielder"), states, ub)
    assert bwm["required_fraction"] == pytest.approx(2 / 3)
    assert bwm["required_fraction"] < POLICY["required_coverage_gate"]
    assert bwm["required_missing"] == {"tackles_per90": "experimental"}
    pf = p0.role_support(load_role("pressing_forward"), states, ub)
    assert pf["required_fraction"] == 0.0
    strict = p0.role_support(load_role("deep_lying_playmaker"), states, [])
    assert strict["required_fraction"] == 0.0 and strict["weighted_support"] == 0.0


def test_pinned_sample_is_deterministic_with_ties():
    ms = [
        {"wyId": 3, "dateutc": "2017-08-01 12:00:00", "status": "Played"},
        {"wyId": 2, "dateutc": "2017-08-01 12:00:00", "status": "Played"},
        {"wyId": 9, "dateutc": "2018-05-01 12:00:00", "status": "Played"},
        {"wyId": 5, "dateutc": "2017-12-01 12:00:00", "status": "Played"},
        {"wyId": 7, "dateutc": "2019-01-01 12:00:00", "status": "Postponed"},
    ]
    assert p0.select_pinned_sample(ms) == {"earliest": 2, "middle": 3, "latest": 9}
    assert p0.select_pinned_sample(list(reversed(ms))) == p0.select_pinned_sample(ms)


def test_reconcile_goals_ignores_null_roster_goal_strings():
    match = {
        "teamsData": {
            "1": {
                "score": 2,
                "formation": {"lineup": [{"goals": "2"}, {"goals": "null"}], "bench": []},
            },
            "2": {"score": 0, "formation": {"lineup": [{"goals": "0"}], "bench": []}},
        }
    }
    out = p0.reconcile_goals(match, {1: 2})
    assert out[1] == {"score": 2, "event_goals": 2, "roster_goals_field": 2}
    assert out[2]["event_goals"] == 0


# ---------------------------------------------------------------- synthetic end-to-end


def _write_raw(tmp: Path) -> None:
    """One synthetic 'Germany' league: 5 matches, team 10 v team 20, 0-0.

    Player 101 (MID, age 23 at reference) starts every match: 450 season minutes.
    Player 102 (MID, age 23) plays 90+90+90+90+89 = 449 minutes.
    Player 103 (MID, 24 on the reference date) plays 450 minutes.
    Player 104 (FW, age 20) plays 450 minutes but only as coarse FW.
    """
    lineup_a = [101, 102, 103, 104] + list(range(105, 112))
    lineup_b = list(range(201, 212))
    matches, events = [], []
    eid = 1
    for i in range(5):
        mid = 900 + i
        subs_a = [{"playerOut": 102, "playerIn": 150, "minute": 89}] if i == 4 else []
        form_a = formation(subs_a, lineup=lineup_a, bench=[150, 151])
        form_b = formation([], lineup=lineup_b, bench=[250])
        matches.append(
            {
                "wyId": mid,
                "status": "Played",
                "dateutc": f"2017-09-0{i + 1} 15:00:00",
                "label": "A - B, 0 - 0",
                "duration": "Regular",
                "seasonId": 1,
                "competitionId": 426,
                "teamsData": {
                    "10": {"side": "home", "score": 0, "hasFormation": 1, "formation": form_a},
                    "20": {"side": "away", "score": 0, "hasFormation": 1, "formation": form_b},
                },
            }
        )
        for pid, tid in ((101, 10), (102, 10), (103, 10), (104, 10), (201, 20)):
            for period, sec in (("1H", 60.0), ("2H", 600.0)):
                events.append(
                    {
                        "id": eid,
                        "matchId": mid,
                        "teamId": tid,
                        "playerId": pid,
                        "matchPeriod": period,
                        "eventSec": sec,
                        "eventId": 8,
                        "subEventId": 85,
                        "eventName": "Pass",
                        "subEventName": "Simple pass",
                        "tags": [{"id": 1801}],
                        "positions": [{"x": 60, "y": 50}, {"x": 75, "y": 50}],
                    }
                )
                eid += 1
    role = {"code2": "MD", "code3": "MID", "name": "Midfielder"}
    players = [
        {"wyId": 101, "birthDate": "1994-07-01", "role": role},
        {"wyId": 102, "birthDate": "1994-07-01", "role": role},
        {"wyId": 103, "birthDate": "1994-06-30", "role": role},
        {"wyId": 104, "birthDate": "1998-01-01", "role": dict(role, code2="FW")},
    ]
    for p in players:
        p.update(firstName="F", lastName=f"L{p['wyId']}", shortName="x")
    with zipfile.ZipFile(tmp / "matches.zip", "w") as z:
        z.writestr("matches_Germany.json", json.dumps(matches))
    with zipfile.ZipFile(tmp / "events.zip", "w") as z:
        z.writestr("events_Germany.json", json.dumps(events))
    (tmp / "players.json").write_text(json.dumps(players))
    (tmp / "teams.json").write_text(json.dumps([{"wyId": 10}, {"wyId": 20}]))
    (tmp / "competitions.json").write_text(
        json.dumps([{"wyId": 426, "name": "German first division", "format": "Domestic league"}])
    )
    (tmp / "eventid2name.csv").write_text("event,subevent,event_label,subevent_label\n8,85,P,S\n")
    (tmp / "tags2name.csv").write_text("Tag,Label,Description\n1801,accurate,Accurate\n")


def test_synthetic_end_to_end_449_450_age_and_coarse_role(tmp_path):
    _write_raw(tmp_path)
    report, resources, detail = p0.analyze(tmp_path, POLICY, ROLES_DIR, ["Germany"])
    lg = report["leagues"]["Germany"]
    assert lg["match_records"] == 5 and lg["event_records"] == 50
    assert lg["matches_accepted_for_coverage"] == 5
    assert lg["team_structure_issues"] == {}
    f = report["g2"]["unique_player_funnel"]
    # 101 (450, 23) qualifies; 102 has 449; 103 is 24; 104 qualifies as coarse ATT
    assert f["covered_minutes_ge_450"] == 2
    assert report["g2"]["minutes_eligible_u23_by_coarse_group"] == {"ATT": 1, "MID": 1}
    assert sorted(detail["players"]["u23_att_mid_minutes_eligible"]) == [101, 104]
    # strict G2 is structurally zero: no granular historical positions, nothing validated
    assert report["g2"]["strict_g2_unique_qualifying_u23"] == 0
    ub = report["g2"]["diagnostic_upper_bound_not_a_g2_count"]
    assert ub["unique_players_any_role"] == 1  # 101 via the passing roles only
    assert set(ub["per_role"]) == {"deep_lying_playmaker", "tempo_controller"}
    assert report["roles"]["pressing_forward"]["upper_bound_clears_70pct"] is False
    # determinism: identical fingerprint on a second run
    again, _, _ = p0.analyze(tmp_path, POLICY, ROLES_DIR, ["Germany"])
    assert p0.fingerprint(again) == p0.fingerprint(report)


# ---------------------------------------------------------------- acquisition pins


def test_verify_file_accepts_exact_bytes_and_rejects_mismatch(tmp_path):
    payload = b"wyscout-p0"
    path = tmp_path / "x.json"
    path.write_bytes(payload)
    pin = fetch_sources.PinnedFile(
        "t", 1, 1, "doi", 2, "x.json", len(payload), hashlib.md5(payload).hexdigest()
    )
    rec = fetch_sources.verify_file(pin, path)
    assert rec["sha256"] == hashlib.sha256(payload).hexdigest()
    path.write_bytes(payload + b"!")
    with pytest.raises(fetch_sources.PinMismatch):
        fetch_sources.verify_file(pin, path)


@pytest.mark.parametrize("chunk", [5, 17, 64, 1 << 22])
def test_independent_verifier_counts_keys_split_across_chunks(tmp_path, chunk):
    events = [{"eventSec": i * 1.5, "matchId": 1000 + (i % 3), "id": i} for i in range(200)]
    with zipfile.ZipFile(tmp_path / "e.zip", "w") as z:
        z.writestr("events_X.json", json.dumps(events))
    n, mids = verify_counts.scan_events(zipfile.ZipFile(tmp_path / "e.zip"), "events_X.json", chunk)
    assert n == 200 and mids == {1000, 1001, 1002}


def test_pins_cover_every_planned_article_version():
    got = {(p.article_id, p.article_version) for p in fetch_sources.PINNED_FILES}
    assert got == {
        (7770599, 1),
        (7770422, 1),
        (7765196, 3),
        (7765310, 3),
        (7765316, 4),
        (11743836, 1),
        (11743818, 1),
    }
