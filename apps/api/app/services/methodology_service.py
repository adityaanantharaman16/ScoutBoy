from __future__ import annotations

from functools import lru_cache

from market_model import MARKET_VERSION
from rolefit import (
    PLAYSTYLE_VERSION,
    RATING_VERSION,
    ContextConfig,
    PlaystyleConfig,
    load_role_configs,
)

from app.models.schemas import MethodologyResponse

FORMULA = (
    "final = role_weighted_performance_score × league × team × opposition × stakes × "
    "role_usage × sample_reliability + recent_form_bonus − risk_penalties  "
    "(clamped to 0–99.9)"
)

DATA_SOURCES = [
    {
        "name": "Sample fixtures (synthetic)",
        "role": "MVP identity + metrics + market inputs",
        "url": None,
        "note": "Fictional players; real clubs/leagues. Deterministic.",
    },
    {
        "name": "Transfermarkt dataset (dcaribou/transfermarkt-datasets)",
        "role": "Identity + market values (adapter ready)",
        "url": "https://github.com/dcaribou/transfermarkt-datasets",
        "note": "Not required for MVP.",
    },
    {
        "name": "StatsBomb Open Data",
        "role": "Event-metric adapter proof",
        "url": "https://github.com/statsbomb/open-data",
        "note": "Mapping tested, not wired to MVP.",
    },
    {
        "name": "Football-Data.co.uk",
        "role": "Team-strength / stakes context proxies",
        "url": "https://www.football-data.co.uk/data.php",
        "note": "Context only, not player data.",
    },
]

LIMITATIONS = [
    "Sample data is synthetic; ratings illustrate the method, not real players.",
    "Opposition quality is a league-strength proxy (no per-match opponent data yet).",
    "Role usage is nominal (no positional-split data in the MVP).",
    "Market values are ranges from a transparent rule-based model — never exact figures.",
    "Scope is U23 attackers & midfielders in European leagues only.",
    "Missing data lowers confidence and is shown as unknown — it is never treated as zero.",
]


@lru_cache
def get_methodology() -> MethodologyResponse:
    roles = load_role_configs()
    ps = PlaystyleConfig.load()
    ContextConfig.load()  # validates presence

    role_meta = [
        {
            "role_key": r.role_key,
            "display_name": r.display_name,
            "position_group": r.position_group,
            "description": r.description,
            "groups": [{"key": g.key, "weight": g.weight} for g in r.groups],
        }
        for r in roles.values()
    ]

    playstyles = [
        {
            "key": p["key"],
            "display_name": p["display_name"],
            "category": p.get("category"),
            "description": p.get("description"),
        }
        for p in ps.positives
    ]
    concerns = [
        {"key": c["key"], "display_name": c["display_name"], "description": c.get("description")}
        for c in ps.concerns
    ]

    context_dims = [
        {
            "key": "league_strength",
            "explanation": "Adjusts reliability by league; lower leagues carry translation risk, not erased production.",
        },
        {"key": "team_strength", "explanation": "Environment-quality signal by team tier."},
        {"key": "opposition_quality", "explanation": "Proxy derived from league strength (MVP)."},
        {"key": "competition_stakes", "explanation": "Pressure of the competition/phase."},
        {
            "key": "role_usage",
            "explanation": "How much the player fills the role (nominal in MVP).",
        },
        {"key": "sample_reliability", "explanation": "Minutes-based reliability + confidence."},
    ]

    return MethodologyResponse(
        scope="Prototype scope: U23 attackers and midfielders in Europe",
        rating_version=RATING_VERSION,
        playstyle_version=PLAYSTYLE_VERSION,
        market_version=MARKET_VERSION,
        formula=FORMULA,
        roles=role_meta,
        playstyles=playstyles,
        concerns=concerns,
        context_dimensions=context_dims,
        data_sources=DATA_SOURCES,
        limitations=LIMITATIONS,
        last_updated=None,
    )
