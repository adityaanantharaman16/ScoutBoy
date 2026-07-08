"""Deterministic generator for the Milestone-2 real-data-v0 fixtures.

Writes a Transfermarkt-STYLE CSV directory + a performance-metrics CSV that mirror how
real ingestion works (two sources joined by source id):

  data/sample/transfermarkt_sample/{competitions,clubs,players,appearances,player_valuations}.csv
  data/sample/performance_metrics_sample.csv   (v1 contract, long format)

All players are SYNTHETIC (fictional names); clubs/leagues are real entities. The set
deliberately includes edge cases (over-age, low minutes, unsupported position, inflated
market, small sample, high-production lower league, low-production elite league, missing
fields) so the quality report and MVP-universe filter have something to catch.

Run:  python3 db/seeds/generate_transfermarkt_sample.py
"""

from __future__ import annotations

import csv
import os
import random

SEED = 20240201
SEASON = "2024-2025"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TM_DIR = os.path.join(ROOT, "data", "sample", "transfermarkt_sample")
PERF_CSV = os.path.join(ROOT, "data", "sample", "performance_metrics_sample.csv")
SNAPSHOT = "sample_2025_02"

# competition_id -> (slug matching configs/context, name, country, type, confederation)
COMPETITIONS = {
    "GB1": ("eng_premier_league", "Premier League", "England", "domestic_top_tier", "europa"),
    "ES1": ("esp_la_liga", "LaLiga", "Spain", "domestic_top_tier", "europa"),
    "IT1": ("ita_serie_a", "Serie A", "Italy", "domestic_top_tier", "europa"),
    "L1": ("ger_bundesliga", "Bundesliga", "Germany", "domestic_top_tier", "europa"),
    "FR1": ("fra_ligue_1", "Ligue 1", "France", "domestic_top_tier", "europa"),
    "NL1": ("ned_eredivisie", "Eredivisie", "Netherlands", "domestic_top_tier", "europa"),
    "PO1": ("por_primeira_liga", "Liga Portugal", "Portugal", "domestic_top_tier", "europa"),
    "GB2": ("eng_championship", "Championship", "England", "domestic_second_tier", "europa"),
}
# club_id -> (slug, name, competition_id)
CLUBS = {
    "281": ("man_city", "Manchester City", "GB1"),
    "11": ("arsenal", "Arsenal", "GB1"),
    "631": ("chelsea", "Chelsea", "GB1"),
    "418": ("real_madrid", "Real Madrid", "ES1"),
    "1049": ("villarreal", "Villarreal", "ES1"),
    "5": ("ac_milan", "AC Milan", "IT1"),
    "800": ("atalanta", "Atalanta", "IT1"),
    "27": ("bayern_munich", "Bayern Munich", "L1"),
    "72": ("stuttgart", "VfB Stuttgart", "L1"),
    "583": ("paris_sg", "Paris Saint-Germain", "FR1"),
    "826": ("lens", "RC Lens", "FR1"),
    "383": ("benfica", "Benfica", "PO1"),
    "1041": ("psv", "PSV Eindhoven", "NL1"),
    "234": ("feyenoord", "Feyenoord", "NL1"),
    "399": ("leeds", "Leeds United", "GB2"),
}

# Canonical per-90 baselines by position group (mirrors the synthetic sample distributions).
BASE_ATT = {
    "non_penalty_goals_per90": 0.30,
    "non_penalty_xg_per90": 0.32,
    "shots_per90": 2.3,
    "touches_in_box_per90": 4.2,
    "xa_per90": 0.16,
    "key_passes_per90": 1.4,
    "shot_creating_actions_per90": 3.4,
    "through_balls_per90": 0.25,
    "crosses_per90": 1.4,
    "progressive_carries_per90": 4.5,
    "progressive_passes_per90": 3.2,
    "carries_into_final_third_per90": 2.6,
    "carries_into_penalty_area_per90": 1.9,
    "passes_into_final_third_per90": 3.0,
    "passes_per90": 28.0,
    "pass_completion_pct": 78.0,
    "passes_under_pressure_per90": 4.0,
    "dispossessed_per90": 2.2,
    "miscontrols_per90": 2.4,
    "successful_take_ons_per90": 1.9,
    "take_on_success_pct": 46.0,
    "pressures_per90": 16.0,
    "counterpressures_per90": 4.5,
    "tackles_per90": 1.1,
    "interceptions_per90": 0.6,
    "ground_duels_won_pct": 48.0,
    "aerial_duels_won_pct": 42.0,
    "defensive_actions_per90": 3.0,
    "fouls_per90": 1.2,
}
BASE_MID = {
    "non_penalty_goals_per90": 0.09,
    "non_penalty_xg_per90": 0.10,
    "shots_per90": 1.1,
    "touches_in_box_per90": 1.3,
    "xa_per90": 0.13,
    "key_passes_per90": 1.2,
    "shot_creating_actions_per90": 2.6,
    "through_balls_per90": 0.30,
    "crosses_per90": 0.7,
    "progressive_carries_per90": 2.6,
    "progressive_passes_per90": 6.0,
    "carries_into_final_third_per90": 1.6,
    "carries_into_penalty_area_per90": 0.7,
    "passes_into_final_third_per90": 5.5,
    "passes_per90": 55.0,
    "pass_completion_pct": 86.0,
    "passes_under_pressure_per90": 7.5,
    "dispossessed_per90": 1.4,
    "miscontrols_per90": 1.6,
    "successful_take_ons_per90": 0.9,
    "take_on_success_pct": 44.0,
    "pressures_per90": 19.0,
    "counterpressures_per90": 6.0,
    "tackles_per90": 2.2,
    "interceptions_per90": 1.6,
    "ground_duels_won_pct": 53.0,
    "aerial_duels_won_pct": 50.0,
    "defensive_actions_per90": 6.5,
    "fouls_per90": 1.4,
}
BOOSTS = {
    "touchline_winger": {
        "successful_take_ons_per90": 1.8,
        "take_on_success_pct": 1.25,
        "progressive_carries_per90": 1.6,
        "carries_into_final_third_per90": 1.6,
        "carries_into_penalty_area_per90": 1.4,
        "crosses_per90": 1.6,
        "non_penalty_xg_per90": 0.75,
        "fin": -0.05,
    },
    "inside_forward": {
        "non_penalty_xg_per90": 1.7,
        "shots_per90": 1.6,
        "touches_in_box_per90": 1.6,
        "carries_into_penalty_area_per90": 1.5,
        "shot_creating_actions_per90": 1.3,
        "fin": 0.06,
    },
    "shadow_striker": {
        "touches_in_box_per90": 1.7,
        "non_penalty_xg_per90": 1.5,
        "shots_per90": 1.5,
        "carries_into_final_third_per90": 1.3,
        "fin": 0.04,
    },
    "pressing_forward": {
        "pressures_per90": 1.8,
        "counterpressures_per90": 1.9,
        "tackles_per90": 1.6,
        "interceptions_per90": 1.6,
        "aerial_duels_won_pct": 1.3,
        "ground_duels_won_pct": 1.15,
        "non_penalty_xg_per90": 1.2,
        "fin": 0.0,
    },
    "complete_forward": {
        "non_penalty_xg_per90": 1.4,
        "xa_per90": 1.5,
        "touches_in_box_per90": 1.4,
        "progressive_passes_per90": 1.4,
        "aerial_duels_won_pct": 1.35,
        "pass_completion_pct": 1.08,
        "pressures_per90": 1.2,
        "fin": 0.05,
    },
    "deep_lying_playmaker": {
        "progressive_passes_per90": 1.7,
        "passes_into_final_third_per90": 1.6,
        "through_balls_per90": 1.5,
        "passes_under_pressure_per90": 1.4,
        "pass_completion_pct": 1.05,
        "interceptions_per90": 1.3,
        "defensive_actions_per90": 1.3,
    },
    "advanced_8": {
        "progressive_carries_per90": 1.9,
        "passes_into_final_third_per90": 1.5,
        "xa_per90": 1.7,
        "key_passes_per90": 1.6,
        "pressures_per90": 1.4,
        "counterpressures_per90": 1.4,
        "touches_in_box_per90": 1.8,
        "carries_into_penalty_area_per90": 1.9,
    },
    "ball_winning_midfielder": {
        "tackles_per90": 1.8,
        "interceptions_per90": 1.9,
        "pressures_per90": 1.5,
        "counterpressures_per90": 1.5,
        "ground_duels_won_pct": 1.2,
        "defensive_actions_per90": 1.6,
        "fouls_per90": 1.3,
    },
    "tempo_controller": {
        "passes_per90": 1.4,
        "pass_completion_pct": 1.08,
        "progressive_passes_per90": 1.4,
        "passes_under_pressure_per90": 1.5,
        "passes_into_final_third_per90": 1.3,
        "defensive_actions_per90": 1.1,
    },
}
POS_GROUP = {
    a: (
        "ATT"
        if a
        in {
            "touchline_winger",
            "inside_forward",
            "shadow_striker",
            "pressing_forward",
            "complete_forward",
        }
        else "MID"
    )
    for a in BOOSTS
}
SUBPOS = {
    "touchline_winger": "Left Winger",
    "inside_forward": "Right Winger",
    "shadow_striker": "Second Striker",
    "pressing_forward": "Centre-Forward",
    "complete_forward": "Centre-Forward",
    "deep_lying_playmaker": "Defensive Midfield",
    "advanced_8": "Central Midfield",
    "ball_winning_midfielder": "Defensive Midfield",
    "tempo_controller": "Central Midfield",
}

# (player_id, name, nationality, archetype, club_id, minutes, foot, height, market_value_eur,
#  contract_year, birth_year, quality, edge)
ROSTER = [
    (
        1001,
        "Théo Marchand",
        "France",
        "touchline_winger",
        "583",
        2100,
        "right",
        178,
        55_000_000,
        2027,
        2003,
        1.2,
        None,
    ),
    (
        1002,
        "Luca Bianchi",
        "Italy",
        "touchline_winger",
        "800",
        1650,
        "left",
        175,
        28_000_000,
        2026,
        2002,
        1.15,
        None,
    ),
    (
        1003,
        "Diego Ferrer",
        "Spain",
        "inside_forward",
        "418",
        1400,
        "right",
        176,
        70_000_000,
        2028,
        2004,
        1.2,
        "inflated",
    ),
    (
        1004,
        "Marcus Vale",
        "England",
        "inside_forward",
        "11",
        1750,
        "left",
        179,
        45_000_000,
        2027,
        2002,
        1.05,
        None,
    ),
    (
        1005,
        "Rui Salgado",
        "Portugal",
        "inside_forward",
        "383",
        2000,
        "right",
        174,
        22_000_000,
        2026,
        2003,
        1.1,
        "high_prod_lower",
    ),
    (
        1006,
        "Anton Keller",
        "Germany",
        "shadow_striker",
        "72",
        1550,
        "right",
        182,
        20_000_000,
        2027,
        2003,
        0.95,
        None,
    ),
    (
        1007,
        "Nikola Petrov",
        "Serbia",
        "shadow_striker",
        "1041",
        1800,
        "left",
        183,
        26_000_000,
        2027,
        2002,
        1.0,
        "high_prod_lower",
    ),
    (
        1008,
        "Erik Sandberg",
        "Sweden",
        "pressing_forward",
        "631",
        1600,
        "right",
        186,
        24_000_000,
        2027,
        2002,
        1.0,
        "low_prod_elite",
    ),
    (
        1009,
        "Tomás Reis",
        "Portugal",
        "pressing_forward",
        "383",
        1950,
        "right",
        184,
        18_000_000,
        2026,
        2003,
        0.9,
        None,
    ),
    (
        1010,
        "Youssef Amrani",
        "Morocco",
        "complete_forward",
        "1049",
        2200,
        "left",
        187,
        35_000_000,
        2027,
        2002,
        1.05,
        None,
    ),
    (
        1011,
        "Jack Whitmore",
        "England",
        "complete_forward",
        "399",
        2400,
        "right",
        188,
        12_000_000,
        2026,
        2003,
        0.95,
        "high_prod_lower",
    ),
    (
        1012,
        "Mateo Ricci",
        "Italy",
        "deep_lying_playmaker",
        "5",
        2050,
        "right",
        181,
        30_000_000,
        2028,
        2003,
        1.1,
        None,
    ),
    (
        1013,
        "Pau Vidal",
        "Spain",
        "deep_lying_playmaker",
        "1049",
        1700,
        "right",
        179,
        19_000_000,
        2026,
        2002,
        1.0,
        None,
    ),
    (
        1014,
        "Lars Eriksen",
        "Denmark",
        "deep_lying_playmaker",
        "234",
        1900,
        "left",
        183,
        14_000_000,
        2027,
        2003,
        0.95,
        None,
    ),
    (
        1015,
        "Ismael Traoré",
        "France",
        "advanced_8",
        "826",
        1850,
        "right",
        180,
        33_000_000,
        2027,
        2003,
        1.15,
        None,
    ),
    (
        1016,
        "Ben Hartley",
        "England",
        "advanced_8",
        "631",
        1500,
        "right",
        178,
        48_000_000,
        2028,
        2004,
        1.1,
        None,
    ),
    (
        1017,
        "Karim Nasser",
        "Algeria",
        "ball_winning_midfielder",
        "826",
        2150,
        "right",
        182,
        21_000_000,
        2027,
        2002,
        1.0,
        None,
    ),
    (
        1018,
        "Felix Braun",
        "Germany",
        "ball_winning_midfielder",
        "27",
        1450,
        "right",
        185,
        26_000_000,
        2028,
        2004,
        1.05,
        None,
    ),
    (
        1019,
        "Andrés Molina",
        "Spain",
        "tempo_controller",
        "418",
        1600,
        "right",
        177,
        40_000_000,
        2028,
        2004,
        1.1,
        None,
    ),
    (
        1020,
        "Stefan Vermeulen",
        "Belgium",
        "tempo_controller",
        "234",
        2000,
        "left",
        180,
        15_000_000,
        2027,
        2003,
        0.95,
        None,
    ),
    # ---- edge cases ----
    (
        1021,
        "Owen Clarke",
        "Scotland",
        "ball_winning_midfielder",
        "399",
        300,
        "right",
        181,
        8_000_000,
        2025,
        2003,
        0.9,
        "small_sample",
    ),
    (
        1022,
        "Viktor Holm",
        "Norway",
        "touchline_winger",
        "1041",
        2200,
        "right",
        179,
        9_000_000,
        2026,
        2000,
        1.0,
        "overage",
    ),
    (
        1023,
        "Sekou Diallo",
        "Mali",
        "pressing_forward",
        None,
        1300,
        None,
        None,
        None,
        None,
        2003,
        0.85,
        "missing_fields",
    ),
    (
        1024,
        "Daniel Novak",
        "Czechia",
        "centre_back",
        "72",
        2300,
        "right",
        190,
        16_000_000,
        2027,
        2003,
        1.0,
        "unsupported_pos",
    ),
]

METRICS = list(BASE_ATT.keys())


def _metrics_for(arch, quality, rng):
    base = dict(BASE_ATT if POS_GROUP[arch] == "ATT" else BASE_MID)
    boosts = BOOSTS[arch]
    out = {}
    for m, v in base.items():
        mult = boosts.get(m, 1.0)
        jitter = 1.0 + (rng.random() - 0.5) * 0.16
        val = v * mult * quality * jitter
        if m.endswith("_pct"):
            val = max(15.0, min(94.0, val))
        out[m] = round(val, 3)
    fin = boosts.get("fin", 0.0)
    npg = max(0.0, out["non_penalty_xg_per90"] + fin + (rng.random() - 0.5) * 0.10)
    out["non_penalty_goals_per90"] = round(npg, 3)
    out["goals_minus_xg_per90"] = round(npg - out["non_penalty_xg_per90"], 3)
    return out


def build():
    rng = random.Random(SEED)
    os.makedirs(TM_DIR, exist_ok=True)

    with open(os.path.join(TM_DIR, "competitions.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["competition_id", "slug", "name", "country_name", "type", "confederation"])
        for cid, (slug, name, country, typ, conf) in COMPETITIONS.items():
            w.writerow([cid, slug, name, country, typ, conf])

    with open(os.path.join(TM_DIR, "clubs.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["club_id", "slug", "name", "domestic_competition_id"])
        for cid, (slug, name, comp) in CLUBS.items():
            w.writerow([cid, slug, name, comp])

    players_rows, appr_rows, val_rows, perf_rows = [], [], [], []
    for row in ROSTER:
        (
            pid,
            name,
            nat,
            arch,
            club_id,
            minutes,
            foot,
            height,
            mv,
            contract,
            birth,
            quality,
            edge,
        ) = row
        # position: unsupported edge uses a real TM label our mapper keeps as CB
        subpos = "Centre-Back" if edge == "unsupported_pos" else SUBPOS[arch]
        pg = "DEF" if edge == "unsupported_pos" else POS_GROUP[arch]
        players_rows.append(
            {
                "player_id": pid,
                "name": name,
                "date_of_birth": f"{birth}-06-15",
                "country_of_citizenship": nat,
                "foot": foot or "",
                "height_in_cm": height or "",
                "sub_position": subpos,
                "current_club_id": club_id or "",
                "contract_expiration_date": f"{contract}-06-30" if contract else "",
                "market_value_in_eur": mv if mv is not None else "",
                "url": f"https://example.invalid/player/{pid}",
            }
        )
        if club_id:
            appr_rows.append(
                {
                    "player_id": pid,
                    "club_id": club_id,
                    "competition_id": CLUBS[club_id][2],
                    "season": SEASON,
                    "minutes": minutes,
                    "appearances": round(minutes / 78),
                    "starts": round(minutes / 88),
                    "position_group": pg,
                }
            )
        if mv is not None:
            val_rows.append(
                {
                    "player_id": pid,
                    "season": SEASON,
                    "market_value_in_eur": mv,
                    "date": "2025-01-15",
                }
            )

        # performance metrics (skip the unsupported-position player to mimic "no scouting data")
        if edge != "unsupported_pos":
            metrics = _metrics_for(arch, quality, rng)
            metrics["availability_index"] = round(min(1.0, minutes / 3040.0), 3)
            metrics["recent_form_index"] = round(0.4 + rng.random() * 0.55, 3)
            for mname, mval in metrics.items():
                perf_rows.append(
                    {
                        "source_name": "transfermarkt",
                        "source_player_id": pid,
                        "season": SEASON,
                        "competition_name": COMPETITIONS[CLUBS[club_id][2]][1] if club_id else "",
                        "team_name": CLUBS[club_id][1] if club_id else "",
                        "metric_name": mname,
                        "metric_value": mval,
                        "unit": (
                            "pct"
                            if mname.endswith("_pct")
                            else ("index" if mname.endswith("_index") else "per90")
                        ),
                        "minutes": minutes,
                        "position_group": pg,
                        "source_snapshot_id": SNAPSHOT,
                        "source_url": "",
                        "provider_player_name": name,
                        "notes": edge or "",
                    }
                )

    # deliberate contract-quality edge rows to exercise the quality report:
    # (a) an unknown metric name, (b) a row for a source id with no identity match
    perf_rows.append(
        {
            "source_name": "transfermarkt",
            "source_player_id": 1001,
            "season": SEASON,
            "competition_name": "Ligue 1",
            "team_name": "Paris Saint-Germain",
            "metric_name": "vertical_leap_cm",
            "metric_value": 71.0,
            "unit": "count",
            "minutes": 2100,
            "position_group": "ATT",
            "source_snapshot_id": SNAPSHOT,
            "source_url": "",
            "provider_player_name": "Théo Marchand",
            "notes": "unknown_metric",
        }
    )
    perf_rows.append(
        {
            "source_name": "transfermarkt",
            "source_player_id": 999999,
            "season": SEASON,
            "competition_name": "Serie A",
            "team_name": "Unknown FC",
            "metric_name": "shots_per90",
            "metric_value": 1.0,
            "unit": "per90",
            "minutes": 900,
            "position_group": "ATT",
            "source_snapshot_id": SNAPSHOT,
            "source_url": "",
            "provider_player_name": "Ghost Player",
            "notes": "unmatched_id",
        }
    )

    _write(os.path.join(TM_DIR, "players.csv"), players_rows)
    _write(os.path.join(TM_DIR, "appearances.csv"), appr_rows)
    _write(os.path.join(TM_DIR, "player_valuations.csv"), val_rows)
    _write(PERF_CSV, perf_rows)
    print(
        f"Wrote {len(players_rows)} players, {len(appr_rows)} appearances, "
        f"{len(val_rows)} valuations, {len(perf_rows)} performance rows."
    )


def _write(path, rows):
    if not rows:
        return
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    build()
