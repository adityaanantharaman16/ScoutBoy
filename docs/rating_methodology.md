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

- Metrics are normalized to **peer-group goodness percentiles**. Stored card metrics use the
  broad position group; RoleFit scoring uses the population eligible for that specific role
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

Up to +2.0 points (`form_bonus.max_points`), scaled by `recent_form_index` and **gated by the
configured confidence floor** `form_bonus.requires_confidence` (default `medium`) in
`configs/context/sample_reliability_v1.yaml`. **Below** the floor the bonus is exactly **zero** —
a small, low-confidence sample cannot earn a form bump; at or above the floor it is positive and
capped at `max_points`. (Milestone 6 correction: the bonus previously halved on low confidence
instead of honoring the configured floor; see
[docs/milestone_6_rating_calibration.md](milestone_6_rating_calibration.md).)

## 4. Risk penalties (subtractive)

Role `concern_rules` subtract points when a metric sits in the concern tail (e.g. a winger
in the top 20% for dispossessions). Total capped at 8.0. Each penalty is itemized in the audit.

## Confidence

`confidence.py` blends minutes (sample size) and required-metric coverage, minus context
penalties. Below the role's `min_minutes` floor, confidence is capped so small-sample spikes
cannot look reliable. Missing required metrics are listed and lower confidence — the score is
still computed from what is present.

For event-backed records, sample confidence uses `performance_covered_minutes`, not the player's
full-season appearance minutes. A player without event coverage receives zero covered minutes
in an event-backed season and cannot enter the real pilot cohort. Role assignment also enforces
each YAML role's `eligible_positions`; a position-group match alone is insufficient.

## Audit & explainability

`audit.py` stores, per rating: metric breakdown (groups + per-metric percentiles), context
breakdown (multipliers + explanations), confidence breakdown, penalties, and a plain-English
`explanation_text`. Surfaced at `GET /api/players/{id}/ratings` and in the card's audit accordion.

## Versioning & reproducibility

Ratings are idempotent and versioned (**`rolefit-v2`**). Each `rating_run` stores the config
hashes, source snapshot ids, status, and affected player count. Re-running with the same inputs
reproduces the same scores (guarded by the benchmark snapshot test, US-3.11).

`rolefit-v2` supersedes `rolefit-v1`: the recent-form bonus now honors the configured
`requires_confidence` floor (a below-floor low-confidence sample earns exactly zero rather than a
halved bonus). This changed observable output, so the identifier was bumped — v1 and v2 semantics
are never reported under the same version. Role weights are unchanged. Stored `rolefit-v1` ratings
are **not** current evidence; re-run `make recompute-ratings` to produce v2 ratings + audits (see
[docs/milestone_6_rating_calibration.md](milestone_6_rating_calibration.md)).

## Extending

- **New role:** add `configs/roles/<role>.yaml` (weights must sum to ~1.0; metrics must exist in
  the registry). It is auto-loaded, scored, ranked, and exposed — no code change.
- **Change weights:** edit the YAML and `make recompute-ratings`. The config hash changes, so the
  run is distinguishable from previous ones. **Also regenerate the calibration baseline** and
  document the change (see below) — the calibration regression test fails on any config-hash
  change, so a weight edit is always a deliberate, reviewed act.
- **New metric:** add it to `packages/shared/python/scoutboy_shared/metrics.py` (name, unit,
  direction, face group), provide it via an adapter, then reference it in role/playstyle configs.

## Calibration & model evaluation (Milestone 6)

RoleFit outputs are measured by a versioned calibration framework that **reuses this same engine**
— it never re-implements the formula and never claims objective scouting truth. It verifies role
order, confidence outcomes, playstyle/concern presence, and bounded context effects against a
committed contract, distinguishing `pass` / `warn` / `fail` / `inconclusive`.

```bash
make calibration-evaluate-fixtures   # deterministic; no DB writes, no network
make calibration-evaluate-pilot      # read-only real-pilot evaluation (inconclusive if absent)
make calibration-evaluate            # both + a Markdown review report
```

The Methodology API (`GET /api/methodology`) exposes a compact `calibration` block (suite version,
status, benchmark/guardrail counts, contract hash, and the real-pilot coverage limitation). Full
details, evidence levels, and the safe change-review workflow are in
[`docs/milestone_6_rating_calibration.md`](milestone_6_rating_calibration.md).
