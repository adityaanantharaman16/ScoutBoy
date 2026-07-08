"""Deterministic generator for ScoutBoy sample fixtures.

Writes:
  data/sample/players.json         identity, club, league, season, minutes, market inputs
  data/sample/sample_metrics.csv   canonical per-90 / rate metrics per player-season

All players are SYNTHETIC (fictional names). Clubs and leagues are real entities.
Run:  python3 db/seeds/generate_sample.py
Deterministic: fixed RNG seed, so output is reproducible for snapshot tests.
"""

from __future__ import annotations

import csv
import json
import os
import random

SEED = 20240115
SEASON = "2023/24"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAMPLE_DIR = os.path.join(ROOT, "data", "sample")

# league slug -> (display name, country, tier, competition_type, is_european)
LEAGUES = {
    "eng_premier_league": ("Premier League", "England", 1, "domestic_top_tier", True),
    "esp_la_liga": ("La Liga", "Spain", 1, "domestic_top_tier", True),
    "ita_serie_a": ("Serie A", "Italy", 1, "domestic_top_tier", True),
    "ger_bundesliga": ("Bundesliga", "Germany", 1, "domestic_top_tier", True),
    "fra_ligue_1": ("Ligue 1", "France", 2, "domestic_top_tier", True),
    "por_primeira_liga": ("Primeira Liga", "Portugal", 2, "domestic_top_tier", True),
    "ned_eredivisie": ("Eredivisie", "Netherlands", 2, "domestic_top_tier", True),
    "bel_pro_league": ("Pro League", "Belgium", 3, "domestic_top_tier", True),
    "eng_championship": ("Championship", "England", 3, "domestic_second_tier", True),
    "fra_ligue_2": ("Ligue 2", "France", 4, "domestic_second_tier", True),
}

# club slug -> (display name, league slug)
CLUBS = {
    "man_city": ("Manchester City", "eng_premier_league"),
    "arsenal": ("Arsenal", "eng_premier_league"),
    "chelsea": ("Chelsea", "eng_premier_league"),
    "brighton": ("Brighton", "eng_premier_league"),
    "real_madrid": ("Real Madrid", "esp_la_liga"),
    "villarreal": ("Villarreal", "esp_la_liga"),
    "ac_milan": ("AC Milan", "ita_serie_a"),
    "atalanta": ("Atalanta", "ita_serie_a"),
    "bayern_munich": ("Bayern Munich", "ger_bundesliga"),
    "stuttgart": ("Stuttgart", "ger_bundesliga"),
    "paris_sg": ("Paris Saint-Germain", "fra_ligue_1"),
    "lens": ("RC Lens", "fra_ligue_1"),
    "benfica": ("Benfica", "por_primeira_liga"),
    "sporting": ("Sporting CP", "por_primeira_liga"),
    "psv": ("PSV", "ned_eredivisie"),
    "feyenoord": ("Feyenoord", "ned_eredivisie"),
    "genk": ("Genk", "bel_pro_league"),
    "leeds": ("Leeds United", "eng_championship"),
    "saint_etienne": ("Saint-Étienne", "fra_ligue_2"),
}

# Baseline per-90 profiles by position group. Values are mid-of-distribution.
BASE_ATT = {
    "goals_per90": 0.35,
    "non_penalty_goals_per90": 0.30,
    "assists_per90": 0.18,
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
    "long_passes_completed_per90": 1.2,
    "pass_completion_pct": 78.0,
    "passes_under_pressure_per90": 4.0,
    "dispossessed_per90": 2.2,
    "miscontrols_per90": 2.4,
    "pressures_per90": 16.0,
    "counterpressures_per90": 4.5,
    "tackles_per90": 1.1,
    "interceptions_per90": 0.6,
    "ground_duels_won_pct": 48.0,
    "aerial_duels_won_pct": 0.9,
    "defensive_actions_per90": 3.0,
    "fouls_per90": 1.2,
    "successful_take_ons_per90": 4.0,
    "take_on_success_pct": 46.0,
}
BASE_MID = {
    "goals_per90": 0.10,
    "non_penalty_goals_per90": 0.09,
    "assists_per90": 0.12,
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
    "long_passes_completed_per90": 3.2,
    "pass_completion_pct": 86.0,
    "passes_under_pressure_per90": 7.5,
    "dispossessed_per90": 1.4,
    "miscontrols_per90": 1.6,
    "pressures_per90": 19.0,
    "counterpressures_per90": 6.0,
    "tackles_per90": 2.2,
    "interceptions_per90": 1.6,
    "ground_duels_won_pct": 53.0,
    "aerial_duels_won_pct": 1.4,
    "defensive_actions_per90": 6.5,
    "fouls_per90": 1.4,
    "successful_take_ons_per90": 1.4,
    "take_on_success_pct": 44.0,
}

# Archetype boosts: metric -> multiplier applied to the baseline for that player.
BOOSTS = {
    "touchline_winger": {
        "successful_take_ons_per90": 1.7,
        "take_on_success_pct": 1.25,
        "progressive_carries_per90": 1.6,
        "carries_into_final_third_per90": 1.6,
        "carries_into_penalty_area_per90": 1.4,
        "crosses_per90": 1.6,
        "non_penalty_xg_per90": 0.75,
        "finishing_bias": -0.05,
    },
    "inside_forward": {
        "non_penalty_xg_per90": 1.7,
        "shots_per90": 1.6,
        "touches_in_box_per90": 1.6,
        "carries_into_penalty_area_per90": 1.5,
        "shot_creating_actions_per90": 1.3,
        "successful_take_ons_per90": 1.2,
        "finishing_bias": 0.06,
    },
    "shadow_striker": {
        "touches_in_box_per90": 1.7,
        "non_penalty_xg_per90": 1.5,
        "shots_per90": 1.5,
        "carries_into_final_third_per90": 1.3,
        "shot_creating_actions_per90": 1.2,
        "finishing_bias": 0.04,
    },
    "pressing_forward": {
        "pressures_per90": 1.8,
        "counterpressures_per90": 1.9,
        "tackles_per90": 1.6,
        "interceptions_per90": 1.6,
        "aerial_duels_won_pct": 1.6,
        "ground_duels_won_pct": 1.15,
        "non_penalty_xg_per90": 1.2,
        "finishing_bias": 0.0,
    },
    "complete_forward": {
        "non_penalty_xg_per90": 1.4,
        "xa_per90": 1.5,
        "touches_in_box_per90": 1.4,
        "progressive_passes_per90": 1.4,
        "aerial_duels_won_pct": 1.8,
        "pass_completion_pct": 1.08,
        "pressures_per90": 1.2,
        "finishing_bias": 0.05,
    },
    "deep_lying_playmaker": {
        "progressive_passes_per90": 1.7,
        "passes_into_final_third_per90": 1.6,
        "through_balls_per90": 1.5,
        "long_passes_completed_per90": 1.7,
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
    "touchline_winger": "ATT",
    "inside_forward": "ATT",
    "shadow_striker": "ATT",
    "pressing_forward": "ATT",
    "complete_forward": "ATT",
    "deep_lying_playmaker": "MID",
    "advanced_8": "MID",
    "ball_winning_midfielder": "MID",
    "tempo_controller": "MID",
}

# Roster: (name, nationality, archetype, position, secondary, club, minutes, foot,
#          height, public_value_eur, contract_until, caps, hype[0-1], birth_year)
ROSTER = [
    (
        "Théo Marchand",
        "France",
        "touchline_winger",
        "LW",
        ["RW"],
        "paris_sg",
        2100,
        "R",
        178,
        55_000_000,
        2027,
        4,
        0.9,
        2003,
    ),
    (
        "Luca Bianchi",
        "Italy",
        "touchline_winger",
        "RW",
        ["LW"],
        "atalanta",
        1650,
        "L",
        175,
        28_000_000,
        2026,
        2,
        0.6,
        2002,
    ),
    (
        "Kwame Boateng",
        "Ghana",
        "touchline_winger",
        "RW",
        ["LW"],
        "genk",
        1900,
        "R",
        180,
        9_000_000,
        2026,
        6,
        0.5,
        2003,
    ),
    (
        "Diego Ferrer",
        "Spain",
        "inside_forward",
        "LW",
        ["CF"],
        "real_madrid",
        1400,
        "R",
        176,
        70_000_000,
        2028,
        3,
        0.95,
        2004,
    ),
    (
        "Marcus Vale",
        "England",
        "inside_forward",
        "RW",
        ["LW"],
        "arsenal",
        1750,
        "L",
        179,
        45_000_000,
        2027,
        5,
        0.8,
        2002,
    ),
    (
        "Rui Salgado",
        "Portugal",
        "inside_forward",
        "LW",
        ["CF"],
        "benfica",
        2000,
        "R",
        174,
        22_000_000,
        2026,
        1,
        0.55,
        2003,
    ),
    (
        "Anton Keller",
        "Germany",
        "shadow_striker",
        "CF",
        ["AM"],
        "stuttgart",
        1550,
        "R",
        182,
        20_000_000,
        2027,
        2,
        0.6,
        2003,
    ),
    (
        "Nikola Petrov",
        "Serbia",
        "shadow_striker",
        "AM",
        ["CF"],
        "psv",
        1800,
        "L",
        183,
        26_000_000,
        2027,
        4,
        0.65,
        2002,
    ),
    (
        "Sekou Diallo",
        "Mali",
        "shadow_striker",
        "CF",
        ["AM"],
        "saint_etienne",
        1300,
        "R",
        185,
        5_000_000,
        2025,
        3,
        0.4,
        2003,
    ),
    (
        "Erik Sandberg",
        "Sweden",
        "pressing_forward",
        "CF",
        ["ST"],
        "brighton",
        1600,
        "R",
        186,
        24_000_000,
        2027,
        5,
        0.6,
        2002,
    ),
    (
        "Tomás Reis",
        "Portugal",
        "pressing_forward",
        "CF",
        ["LW"],
        "sporting",
        1950,
        "R",
        184,
        18_000_000,
        2026,
        2,
        0.5,
        2003,
    ),
    (
        "Youssef Amrani",
        "Morocco",
        "complete_forward",
        "CF",
        ["ST"],
        "villarreal",
        2200,
        "L",
        187,
        35_000_000,
        2027,
        8,
        0.7,
        2002,
    ),
    (
        "Jack Whitmore",
        "England",
        "complete_forward",
        "ST",
        ["CF"],
        "leeds",
        2400,
        "R",
        188,
        12_000_000,
        2026,
        0,
        0.45,
        2003,
    ),
    (
        "Mateo Ricci",
        "Italy",
        "deep_lying_playmaker",
        "DM",
        ["CM"],
        "ac_milan",
        2050,
        "R",
        181,
        30_000_000,
        2028,
        3,
        0.7,
        2003,
    ),
    (
        "Pau Vidal",
        "Spain",
        "deep_lying_playmaker",
        "DM",
        ["CM"],
        "villarreal",
        1700,
        "R",
        179,
        19_000_000,
        2026,
        1,
        0.55,
        2002,
    ),
    (
        "Lars Eriksen",
        "Denmark",
        "deep_lying_playmaker",
        "CM",
        ["DM"],
        "feyenoord",
        1900,
        "L",
        183,
        14_000_000,
        2027,
        4,
        0.5,
        2003,
    ),
    (
        "Ismael Traoré",
        "France",
        "advanced_8",
        "CM",
        ["AM"],
        "lens",
        1850,
        "R",
        180,
        33_000_000,
        2027,
        2,
        0.8,
        2003,
    ),
    (
        "Ben Hartley",
        "England",
        "advanced_8",
        "CM",
        ["AM"],
        "chelsea",
        1500,
        "R",
        178,
        48_000_000,
        2028,
        4,
        0.85,
        2004,
    ),
    (
        "Goran Novak",
        "Croatia",
        "advanced_8",
        "AM",
        ["CM"],
        "genk",
        1650,
        "L",
        176,
        11_000_000,
        2026,
        3,
        0.5,
        2002,
    ),
    (
        "Karim Nasser",
        "Algeria",
        "ball_winning_midfielder",
        "DM",
        ["CM"],
        "lens",
        2150,
        "R",
        182,
        21_000_000,
        2027,
        6,
        0.55,
        2002,
    ),
    (
        "Felix Braun",
        "Germany",
        "ball_winning_midfielder",
        "DM",
        ["CM"],
        "bayern_munich",
        1450,
        "R",
        185,
        26_000_000,
        2028,
        2,
        0.75,
        2004,
    ),
    (
        "Owen Clarke",
        "Scotland",
        "ball_winning_midfielder",
        "CM",
        ["DM"],
        "leeds",
        2300,
        "R",
        181,
        8_000_000,
        2025,
        1,
        0.35,
        2003,
    ),
    (
        "Andrés Molina",
        "Spain",
        "tempo_controller",
        "CM",
        ["DM"],
        "real_madrid",
        1600,
        "R",
        177,
        40_000_000,
        2028,
        2,
        0.85,
        2004,
    ),
    (
        "Stefan Vermeulen",
        "Belgium",
        "tempo_controller",
        "CM",
        ["DM"],
        "feyenoord",
        2000,
        "L",
        180,
        15_000_000,
        2027,
        3,
        0.5,
        2003,
    ),
]

METRIC_NAMES = list(BASE_ATT.keys()) + [
    "goals_minus_xg_per90",
    "availability_index",
    "recent_form_index",
]


def build() -> None:
    rng = random.Random(SEED)
    os.makedirs(SAMPLE_DIR, exist_ok=True)
    players = []
    metric_rows = []

    for idx, row in enumerate(ROSTER):
        (
            name,
            nat,
            arch,
            pos,
            secondary,
            club,
            minutes,
            foot,
            height,
            value,
            contract,
            caps,
            hype,
            birth_year,
        ) = row
        pg = POS_GROUP[arch]
        base = dict(BASE_ATT if pg == "ATT" else BASE_MID)
        boosts = BOOSTS[arch]
        # quality factor spreads players within an archetype (deterministic per idx)
        quality = 0.82 + (rng.random() * 0.42)  # 0.82 - 1.24

        metrics = {}
        for m, v in base.items():
            mult = boosts.get(m, 1.0)
            jitter = 1.0 + (rng.random() - 0.5) * 0.16
            val = v * mult * quality * jitter
            if m.endswith("_pct"):
                val = max(15.0, min(94.0, val))
            metrics[m] = round(val, 3)

        # goals_minus_xg_per90: goals above/below npxg, biased by archetype
        fin_bias = boosts.get("finishing_bias", 0.0)
        npg = max(0.0, metrics["non_penalty_xg_per90"] + fin_bias + (rng.random() - 0.5) * 0.10)
        metrics["non_penalty_goals_per90"] = round(npg, 3)
        metrics["goals_per90"] = round(npg + 0.05 * quality, 3)
        metrics["goals_minus_xg_per90"] = round(npg - metrics["non_penalty_xg_per90"], 3)
        # availability: minutes vs a nominal 3040 (34 * 90) season ceiling
        metrics["availability_index"] = round(min(1.0, minutes / 3040.0), 3)
        metrics["recent_form_index"] = round(0.4 + rng.random() * 0.55, 3)

        player_id = f"sample-{idx + 1:03d}"
        players.append(
            {
                "source_player_id": player_id,
                "canonical_name": name,
                "nationality": nat,
                "birth_date": f"{birth_year}-06-15",
                "preferred_foot": foot,
                "height_cm": height,
                "primary_position": pos,
                "secondary_positions": secondary,
                "club_slug": club,
                "club_name": CLUBS[club][0],
                "competition_slug": CLUBS[club][1],
                "season": SEASON,
                "minutes": minutes,
                "appearances": round(minutes / 78),
                "starts": round(minutes / 88),
                "position_group": pg,
                "archetype_hint": arch,
                "market": {
                    "public_value_eur": value,
                    "contract_until": contract,
                    "international_caps": caps,
                    "hype_index": hype,
                },
            }
        )
        for m in METRIC_NAMES:
            metric_rows.append(
                {
                    "source_player_id": player_id,
                    "season": SEASON,
                    "metric_name": m,
                    "metric_value": metrics[m],
                    "unit": (
                        "pct"
                        if m.endswith("_pct")
                        else ("index" if m.endswith("_index") else "per90")
                    ),
                }
            )

    with open(os.path.join(SAMPLE_DIR, "players.json"), "w") as f:
        json.dump(
            {
                "_note": "SYNTHETIC sample data. Players are fictional; clubs/leagues are real entities.",
                "source_name": "sample",
                "season": SEASON,
                "leagues": {
                    k: {
                        "name": v[0],
                        "country": v[1],
                        "tier": v[2],
                        "competition_type": v[3],
                        "is_european": v[4],
                    }
                    for k, v in LEAGUES.items()
                },
                "clubs": {k: {"name": v[0], "competition_slug": v[1]} for k, v in CLUBS.items()},
                "players": players,
            },
            f,
            indent=2,
        )

    with open(os.path.join(SAMPLE_DIR, "sample_metrics.csv"), "w", newline="") as f:
        w = csv.DictWriter(
            f, fieldnames=["source_player_id", "season", "metric_name", "metric_value", "unit"]
        )
        w.writeheader()
        w.writerows(metric_rows)

    print(f"Wrote {len(players)} players and {len(metric_rows)} metric rows to {SAMPLE_DIR}")


if __name__ == "__main__":
    build()
