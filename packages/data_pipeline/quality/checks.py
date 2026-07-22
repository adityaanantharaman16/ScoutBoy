"""Data-quality checks (US-7.6, US-7.9).

Bundle checks run pre-normalization on canonical records; DB checks run post-recompute
on stored ratings. Each check returns a structured finding. Severity 'error' means the
pipeline should fail loudly rather than emit silently-bad ratings.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime

from scoutboy_shared import is_performance_metric, position_group_for, resolve_metric

from ..adapters.base import IngestBundle

# Metrics we expect a healthy source to provide; absence flags schema drift.
EXPECTED_CORE_METRICS = (
    "non_penalty_xg_per90",
    "shots_per90",
    "progressive_carries_per90",
    "progressive_passes_per90",
    "pass_completion_pct",
)


def _finding(name: str, severity: str, count: int, details) -> dict:
    return {"check": name, "severity": severity, "count": count, "details": details}


def run_bundle_checks(bundle: IngestBundle, *, min_minutes: int = 450) -> dict:
    findings: list[dict] = []

    # duplicate player source ids
    dupes = [
        k
        for k, n in Counter((p.source_name, p.source_player_id) for p in bundle.players).items()
        if n > 1
    ]
    findings.append(
        _finding("duplicate_player_source_ids", "error" if dupes else "ok", len(dupes), dupes[:10])
    )

    # impossible birth dates
    bad_dob = []
    today = date(2024, 6, 1)
    for p in bundle.players:
        if not p.birth_date:
            continue
        try:
            d = datetime.strptime(p.birth_date[:10], "%Y-%m-%d").date()
        except ValueError:
            bad_dob.append(p.source_player_id)
            continue
        age = (today - d).days / 365.25
        if d > today or age < 14 or age > 45:
            bad_dob.append(p.source_player_id)
    findings.append(
        _finding("impossible_birth_dates", "error" if bad_dob else "ok", len(bad_dob), bad_dob[:10])
    )

    # missing minutes
    missing_min = [a.source_player_id for a in bundle.appearances if not a.minutes]
    findings.append(
        _finding(
            "missing_minutes", "warn" if missing_min else "ok", len(missing_min), missing_min[:10]
        )
    )

    # negative metric values
    negative = [
        (m.source_player_id, m.metric_name)
        for m in bundle.metrics
        if m.metric_value is not None and m.metric_value < 0
        # finishing-vs-xG (and its legacy alias) is legitimately negative
        and m.metric_name not in ("goals_minus_xg_per90", "finishing_over_xg")
    ]
    findings.append(
        _finding("negative_metrics", "warn" if negative else "ok", len(negative), negative[:10])
    )

    # duplicate player-season appearance rows
    appdupe = [
        k
        for k, n in Counter(
            (a.source_player_id, a.team_slug, a.competition_slug, a.season_label)
            for a in bundle.appearances
        ).items()
        if n > 1
    ]
    findings.append(
        _finding(
            "duplicate_player_season_rows", "error" if appdupe else "ok", len(appdupe), appdupe[:10]
        )
    )

    # null / missing public market values
    have_value = {m.source_player_id for m in bundle.metrics if m.metric_name == "public_value_eur"}
    missing_value = [
        p.source_player_id for p in bundle.players if p.source_player_id not in have_value
    ]
    findings.append(
        _finding(
            "missing_public_values",
            "warn" if missing_value else "ok",
            len(missing_value),
            missing_value[:10],
        )
    )

    # source schema drift: only meaningful for a source that provides PERFORMANCE metrics.
    # Identity/market-only bundles (e.g. Transfermarkt) legitimately have no core metrics.
    present_perf = {
        resolve_metric(m.metric_name)
        for m in bundle.metrics
        if is_performance_metric(m.metric_name)
    }
    missing_core = (
        [m for m in EXPECTED_CORE_METRICS if m not in present_perf] if present_perf else []
    )
    # Only an error for a full identity source (has players); metric-only bundles
    # (e.g. a partial performance CSV) merely warn — they need not carry every core metric.
    drift_severity = "ok"
    if missing_core:
        drift_severity = "error" if bundle.players else "warn"
    findings.append(
        _finding("source_schema_drift", drift_severity, len(missing_core), missing_core)
    )

    # out-of-scope positions (should be ATT/MID only)
    oos = [
        p.source_player_id
        for p in bundle.players
        if p.primary_position and position_group_for(p.primary_position) is None
    ]
    findings.append(_finding("out_of_scope_positions", "warn" if oos else "ok", len(oos), oos[:10]))

    # unknown metric names (not in registry, excluding market inputs)
    market_inputs = {
        "public_value_eur",
        "contract_until",
        "international_caps",
        "hype_index",
        "recent_form_index",
    }
    unknown = sorted(
        {
            m.metric_name
            for m in bundle.metrics
            if resolve_metric(m.metric_name) is None and m.metric_name not in market_inputs
        }
    )
    findings.append(
        _finding("unknown_metric_names", "warn" if unknown else "ok", len(unknown), unknown)
    )

    errors = [f for f in findings if f["severity"] == "error" and f["count"] > 0]
    return {
        "source": bundle.source_name,
        "snapshot": bundle.source_snapshot_id,
        "player_count": len(bundle.players),
        "metric_rows": len(bundle.metrics),
        "findings": findings,
        "has_errors": bool(errors),
        "error_checks": [f["check"] for f in errors],
    }


def run_rating_outlier_check(final_scores: list[float]) -> dict:
    """Flag ratings outside the valid display range (post-recompute)."""
    outliers = [s for s in final_scores if s < 0 or s > 99.9]
    return _finding("outlier_ratings", "error" if outliers else "ok", len(outliers), outliers[:10])
