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
from scoutboy_shared import DISPLAY_SCALE_MAX

from app.models.schemas import MethodologyResponse

FORMULA = (
    "final = role_weighted_performance_score × league × team × opposition × stakes × "
    "role_usage × sample_reliability + recent_form_bonus − risk_penalties  "
    f"(clamped to 0-{int(DISPLAY_SCALE_MAX)})"
)

# Human names for the position groups that actually carry role configuration. Only
# groups present in configs/roles/*.yaml are ever named in the scope sentence, so
# the claim cannot outlive the configuration it describes.
_GROUP_WORDS = {"ATT": "attacking", "MID": "midfield", "DEF": "defensive", "GK": "goalkeeping"}

# Provenance, stated at the honesty level each source has actually reached. An
# adapter that exists and passes unit tests is described as exactly that; only
# sources the ingest job can run are called ingest sources; nothing here is called
# live, current, or a production feed.
DATA_SOURCES = [
    {
        "name": "Sample fixtures (synthetic)",
        "role": "Connected ingest source: identity, metrics and market inputs",
        "url": None,
        "note": (
            "The default seeded cohort and the fixture database behind the test "
            "suites. Fictional players against real club/league names, fully "
            "deterministic. Not real football data."
        ),
    },
    {
        "name": "Transfermarkt dataset (dcaribou/transfermarkt-datasets)",
        "role": "Connected ingest source: identity + public market values",
        "url": "https://github.com/dcaribou/transfermarkt-datasets",
        "note": (
            "Runs from a local CSV snapshot supplied on the command line. Not a "
            "live feed, and not part of the default seed."
        ),
    },
    {
        "name": "StatsBomb Open Data",
        "role": "Connected ingest source: event-derived performance metrics",
        "url": "https://github.com/statsbomb/open-data",
        "note": (
            "Runs from a local Open Data snapshot supplied on the command line. "
            "The pilot slice it was exercised against is a single-club sample, not "
            "league-wide coverage."
        ),
    },
    {
        "name": "Football-Data.co.uk",
        "role": "Adapter implemented and unit-tested; not connected to ingestion",
        "url": "https://www.football-data.co.uk/data.php",
        "note": (
            "Would supply team-strength / stakes context proxies only, never player "
            "data. The ingest job exposes no source for it today, so nothing in the "
            "database comes from it."
        ),
    },
    {
        "name": "Fixture and mock providers (generated_fixture, mock_commercial_provider)",
        "role": "Connected ingest sources: synthetic provider-shaped fixtures",
        "url": None,
        "note": (
            "Exist to exercise the provider contract, quality checks and operational "
            "paths at size. Demo/fixture data by construction."
        ),
    },
]


def _limitations(analyzed_groups: list[str], role_count: int) -> list[str]:
    """Limitations that read the live configuration rather than restating a memory.

    The RoleFit-coverage bullet is generated from the loaded role configs, so it can
    never claim analysis for a position group that has no role file.
    """
    covered = " and ".join(_GROUP_WORDS.get(g, g) for g in analyzed_groups) or "no"
    uncovered = sorted(set(_GROUP_WORDS) - set(analyzed_groups))
    uncovered_words = ", ".join(_GROUP_WORDS[g] for g in uncovered)
    return [
        "Sample data is synthetic; ratings illustrate the method, not real players.",
        (
            f"RoleFit is configured for {role_count} {covered} roles only."
            + (
                f" There is no {uncovered_words} role configuration, so those players "
                "are never given a RoleFit rating."
                if uncovered
                else ""
            )
        ),
        (
            "Discovery is a broad player directory: it applies no age or position "
            "restriction of its own, and a record with no rating is shown as "
            "profile-only rather than scored. Being discoverable is not evidence of "
            "analysis."
        ),
        (
            "Coverage is whatever the connected local snapshots contain. It is not "
            "broad league, European, or global coverage, and nothing here is current "
            "or live data."
        ),
        "Opposition quality is a league-strength proxy (no per-match opponent data yet).",
        "Role usage is nominal (no positional-split data yet).",
        "Market values are ranges from a transparent rule-based model - never exact figures.",
        (
            "Calibration evidence comes from committed synthetic fixtures plus a "
            "single-club event-data slice. It checks that the engine behaves as "
            "specified; it is not validation against real transfer or performance "
            "outcomes."
        ),
        (
            "Comparison selects a role both players are already rated in. When they "
            "share no rated role, no score is invented for either side."
        ),
        "Missing data lowers confidence and is shown as unknown - it is never treated as zero.",
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

    calibration = _calibration_meta()

    context_dims = [
        {
            "key": "league_strength",
            "explanation": "Adjusts reliability by league; lower leagues carry translation risk, not erased production.",
        },
        {"key": "team_strength", "explanation": "Environment-quality signal by team tier."},
        {
            "key": "opposition_quality",
            "explanation": "Proxy derived from league strength; no per-match opponent data yet.",
        },
        {"key": "competition_stakes", "explanation": "Pressure of the competition/phase."},
        {
            "key": "role_usage",
            "explanation": "How much the player fills the role (nominal; no positional splits yet).",
        },
        {"key": "sample_reliability", "explanation": "Minutes-based reliability + confidence."},
    ]

    # Scope is derived, not asserted: the position groups named here are exactly the
    # ones that have role files on disk, so the sentence cannot claim analysis the
    # configuration does not provide.
    analyzed_groups = sorted({r.position_group for r in roles.values()})
    covered = " and ".join(_GROUP_WORDS.get(g, g) for g in analyzed_groups)
    scope = (
        "Discovery covers every player-season in the connected local snapshots, at any "
        f"age and in any position group. Configured RoleFit analysis covers {len(roles)} "
        f"{covered} roles only; records without a rating are shown as profile-only and "
        f"are never scored. Scores are clamped to 0-{int(DISPLAY_SCALE_MAX)}."
    )

    return MethodologyResponse(
        scope=scope,
        rating_version=RATING_VERSION,
        playstyle_version=PLAYSTYLE_VERSION,
        market_version=MARKET_VERSION,
        formula=FORMULA,
        roles=role_meta,
        playstyles=playstyles,
        concerns=concerns,
        context_dimensions=context_dims,
        data_sources=DATA_SOURCES,
        limitations=_limitations(analyzed_groups, len(roles)),
        calibration=calibration,
        last_updated=None,
    )


def _calibration_meta() -> dict:
    """Compact calibration status for the Methodology surface.

    Runs the deterministic fixture suite only (no DB, no network). Never raises: if calibration
    cannot be evaluated in this environment it returns an evidence-honest ``inconclusive`` /
    unavailable block (available=False, zero totals, no config hash, real-pilot limitation kept)
    rather than fabricating a successful status or silently hiding the section."""
    try:
        from evaluation import CalibrationContract
        from evaluation.database_evaluator import PILOT_COVERAGE_NOTE
        from evaluation.evaluator import evaluate_fixtures

        result = evaluate_fixtures()
        contract = CalibrationContract.load()

        def _summary(totals: dict) -> dict:
            return {
                "passed": totals.get("pass", 0),
                "warned": totals.get("warn", 0),
                "failed": totals.get("fail", 0),
                "inconclusive": totals.get("inconclusive", 0),
                "total": sum(totals.values()),
            }

        return {
            "available": True,
            "suite_id": result["suite_id"],
            "suite_version": result["contract_version"],
            "calibration_version": result["calibration_version"],
            "rating_version": result["rating_version"],
            "status": result["overall_status"],
            "benchmarks": _summary(result["totals"]["benchmarks"]),
            "scenarios": _summary(result["totals"]["scenarios"]),
            "methodology_note": contract.methodology_note,
            "pilot_coverage_limitation": PILOT_COVERAGE_NOTE,
            "config_hash": result["config_hashes"]["contract"],
        }
    except Exception:  # noqa: BLE001 — methodology must render even if calibration is unavailable
        try:
            from evaluation.database_evaluator import PILOT_COVERAGE_NOTE

            pilot_limit = PILOT_COVERAGE_NOTE
        except Exception:  # noqa: BLE001
            pilot_limit = (
                "Real-pilot evaluation is a Bayer Leverkusen-centered StatsBomb slice, not full "
                "Bundesliga/European coverage."
            )
        return {
            "available": False,
            "status": "inconclusive",
            "methodology_note": (
                "Calibration evidence is unavailable in this environment; run "
                "`make calibration-evaluate-fixtures` to produce it."
            ),
            "pilot_coverage_limitation": pilot_limit,
        }
