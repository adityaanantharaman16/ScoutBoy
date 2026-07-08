"""Metric normalization utilities: per-peer-group percentiles and z-scores.

These operate over a *population* (a peer group for one season) and return per-player
normalized values. Missing inputs (None) are excluded from the distribution and stay
None on output — they are never treated as zero.
"""

from __future__ import annotations

from collections.abc import Hashable
from statistics import mean, pstdev
from typing import Optional


def percentile_ranks(
    values: dict[Hashable, Optional[float]],
    higher_better: bool = True,
) -> dict[Hashable, Optional[float]]:
    """Return a 0..1 *goodness* percentile per key.

    Uses the mid-rank method so ties share a percentile and results sit strictly
    inside (0, 1). When ``higher_better`` is False the percentile is inverted so a
    lower raw value maps to a higher goodness percentile. Keys with None stay None.
    A single present value maps to 0.5 (no distribution to rank against).
    """
    present = [(k, v) for k, v in values.items() if v is not None]
    out: dict[Hashable, Optional[float]] = {k: None for k in values}
    n = len(present)
    if n == 0:
        return out
    if n == 1:
        out[present[0][0]] = 0.5
        return out
    vals = [v for _, v in present]
    for k, v in present:
        less = sum(1 for x in vals if x < v)
        equal = sum(1 for x in vals if x == v)
        p = (less + 0.5 * equal) / n
        out[k] = p if higher_better else (1.0 - p)
    return out


def zscore_ranks(
    values: dict[Hashable, Optional[float]],
    higher_better: bool = True,
) -> dict[Hashable, Optional[float]]:
    """Return a z-score per key (direction-adjusted). None stays None; zero-variance
    populations return 0.0 for every present key."""
    present = [(k, v) for k, v in values.items() if v is not None]
    out: dict[Hashable, Optional[float]] = {k: None for k in values}
    if len(present) < 2:
        for k, _ in present:
            out[k] = 0.0
        return out
    vals = [v for _, v in present]
    mu = mean(vals)
    sd = pstdev(vals)
    for k, v in present:
        z = 0.0 if sd == 0 else (v - mu) / sd
        out[k] = z if higher_better else -z
    return out


def percentile_to_score(percentile: Optional[float]) -> Optional[float]:
    """Convert a 0..1 percentile to a 0..100 metric score. None stays None."""
    if percentile is None:
        return None
    return round(max(0.0, min(1.0, percentile)) * 100.0, 2)
