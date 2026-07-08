# RoleFit rating methodology (v1)

RoleFit rates a player by **how well he fits a specific tactical job**, not by a single
universal overall. Every score is explainable from stored inputs and an audit record.

## Formula

```
final = role_weighted_performance_score
        × league_strength
        × team_strength
        × opposition_quality
        × competition_stakes
        × role_usage
        × sample_reliability
        + recent_form_bonus
        − risk_penalties            (clamped to 0–99.9)
```

Implemented in `packages/rating_engine/rolefit/formula.py`.

## 1. Role-weighted performance score (0–100)

- Metrics are normalized to **peer-group goodness percentiles** (position group, per season)
  in `normalize.py`. `higher_better` comes from the shared metric registry; lower-is-better
  metrics (dispossessions, miscontrols, fouls) are inverted so a high percentile is always good.
- Each role config (`configs/roles/*.yaml`) defines weighted **metric groups**. A group score is
  the weighted mean of its present metric percentiles × 100.
- The performance score is the group-weighted mean over **present** groups. Missing metrics are
  dropped and their weight is renormalized among peers — never treated as zero.

## 2. Context adjustments (multipliers)

From `configs/context/*.yaml` via `context_adjustments.py`. Context **adjusts reliability and
trust; it does not erase production.** Each multiplier is clamped to a documented band:

| Dimension | Band | Notes |
| --- | --- | --- |
| League strength | 0.85–1.05 | Weaker leagues → lower multiplier **and** higher translation risk (lower confidence). |
| Team strength | 0.93–1.05 | Environment-quality signal by team tier. |
| Opposition quality | 0.97–1.03 | MVP proxy derived from league strength. |
| Competition stakes | 0.97–1.06 | Pressure of the competition/phase. |
| Role usage | 1.0 (nominal) | No positional-split data in the MVP. |
| Sample reliability | 0.90–1.00 | Minutes-based. |

## 3. Recent-form bonus (additive)

Up to +2.0 points, scaled by `recent_form_index` and gated by sample confidence
(halved on low confidence, zero on unknown).

## 4. Risk penalties (subtractive)

Role `concern_rules` subtract points when a metric sits in the concern tail (e.g. a winger
in the top 20% for dispossessions). Total capped at 8.0. Each penalty is itemized in the audit.

## Confidence

`confidence.py` blends minutes (sample size) and required-metric coverage, minus context
penalties. Below the role's `min_minutes` floor, confidence is capped so small-sample spikes
cannot look reliable. Missing required metrics are listed and lower confidence — the score is
still computed from what is present.

## Audit & explainability

`audit.py` stores, per rating: metric breakdown (groups + per-metric percentiles), context
breakdown (multipliers + explanations), confidence breakdown, penalties, and a plain-English
`explanation_text`. Surfaced at `GET /api/players/{id}/ratings` and in the card's audit accordion.

## Versioning & reproducibility

Ratings are idempotent and versioned (`rolefit-v1`). Each `rating_run` stores the config hashes,
source snapshot ids, status, and affected player count. Re-running with the same inputs reproduces
the same scores (guarded by the benchmark snapshot test, US-3.11).

## Extending

- **New role:** add `configs/roles/<role>.yaml` (weights must sum to ~1.0; metrics must exist in
  the registry). It is auto-loaded, scored, ranked, and exposed — no code change.
- **Change weights:** edit the YAML and `make recompute-ratings`. The config hash changes, so the
  run is distinguishable from previous ones.
- **New metric:** add it to `packages/shared/python/scoutboy_shared/metrics.py` (name, unit,
  direction, face group), provide it via an adapter, then reference it in role/playstyle configs.
