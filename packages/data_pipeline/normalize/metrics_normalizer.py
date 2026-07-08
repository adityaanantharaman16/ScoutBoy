"""Per-90 / percentile / z-score normalization within peer groups.

Only canonical RoleFit metrics (the registry) are percentiled; market inputs like
public_value_eur stay as raw metrics. Missing values stay None (never zero)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from rolefit import percentile_ranks, zscore_ranks
from scoutboy_shared import PERFORMANCE_METRICS, ConfidenceLevel, is_higher_better


@dataclass
class NormalizedMetric:
    player_key: str
    metric_name: str
    peer_group: str
    per90_value: Optional[float]
    percentile: Optional[float]
    z_score: Optional[float]
    confidence: str


def normalize_metrics(
    raw: dict[str, dict[str, Optional[float]]],
    peer_group_by_player: dict[str, str],
    minutes_by_player: dict[str, int],
) -> list[NormalizedMetric]:
    """raw: player_key -> {metric_name: value}. Returns normalized rows for every
    registry metric present in any player within each peer group."""
    # group players
    groups: dict[str, list[str]] = {}
    for pid, pg in peer_group_by_player.items():
        groups.setdefault(pg, []).append(pid)

    out: list[NormalizedMetric] = []
    for pg, pids in groups.items():
        for metric_name in PERFORMANCE_METRICS:
            values = {pid: raw.get(pid, {}).get(metric_name) for pid in pids}
            if all(v is None for v in values.values()):
                continue
            pct = percentile_ranks(values, higher_better=is_higher_better(metric_name))
            zsc = zscore_ranks(values, higher_better=is_higher_better(metric_name))
            for pid in pids:
                v = values[pid]
                if v is None:
                    continue
                mins = minutes_by_player.get(pid, 0)
                conf = (
                    ConfidenceLevel.HIGH
                    if mins >= 1800
                    else (
                        ConfidenceLevel.MEDIUM
                        if mins >= 900
                        else ConfidenceLevel.LOW if mins >= 450 else ConfidenceLevel.UNKNOWN
                    )
                )
                out.append(
                    NormalizedMetric(
                        player_key=pid,
                        metric_name=metric_name,
                        peer_group=pg,
                        per90_value=v,
                        percentile=pct[pid],
                        z_score=zsc[pid],
                        confidence=conf.value,
                    )
                )
    return out
