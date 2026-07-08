# Playstyles & concerns (v1)

Playstyles are the fan-friendly layer: they translate metrics into "what to expect".
Defined in `configs/playstyles/playstyles_v1.yaml` (positive) and `concerns_v1.yaml`.

## How badges are applied

- A badge computes a **composite goodness percentile** from its metrics *within the player's
  peer group* (position group) — this is what makes them **role-aware** (a high carry number
  means something different for a winger vs a DM).
- Applied only when: the position group matches, minutes clear `min_minutes`, all
  `required_metrics` are present, and the composite clears the `base` tier. Otherwise **no badge**
  — never a false/zero badge (US-4.9).
- **Tiers:** `base` (top 25%), `plus` (top 10%), `elite` (top ~5%).
- Each badge carries `tier`, `confidence`, `supporting_metrics`, and a `why_applied` explanation
  (US-4.6).

## Concerns

Come from four trigger types: `low_percentile` (bottom tail), `small_sample` (minutes below a
threshold), `context_translation` (league translation risk), and `market_label` (market model
flagged the price). Implemented in `packages/rating_engine/rolefit/playstyles.py`.

## Positive badges

Technical Carrier · Touchline Isolator · Inverted Threat · Box Crasher · Finesse Finisher ·
Volume Shooter · Line Breaker · Tempo Setter · Press Resistant · Relentless Presser ·
Duel Winner · Interceptor · Aerial Threat · Ball Magnet · Transition Outlet

## Concern badges

Raw Finishing · Low Defensive Output · Turnover Risk · Small Sample · Role Translation Risk ·
Inflated Market · Limited Creation · Limited Carrying Threat
