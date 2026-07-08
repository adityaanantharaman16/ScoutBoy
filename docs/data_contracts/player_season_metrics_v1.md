# Performance metrics contract — `player_season_metrics_v1`

Long-format CSV for externally-sourced or manually-curated performance metrics (FBref,
StatsBomb, Wyscout, Opta, Understat, …). **One row per (player, season, metric).** Player
identity is joined at ingest time — this file carries no identity beyond the source id.

- Template (fill this): [`data/contracts/player_season_metrics_v1.csv`](../../data/contracts/player_season_metrics_v1.csv)
- Example: [`data/contracts/player_season_metrics_v1.example.csv`](../../data/contracts/player_season_metrics_v1.example.csv)
- JSON Schema: [`data/contracts/player_season_metrics_v1.schema.json`](../../data/contracts/player_season_metrics_v1.schema.json)

## Required columns

| Column | Meaning |
| --- | --- |
| `source_name` | Identity source to match on (e.g. `transfermarkt`). Must equal `player_source_ids.source_name`. |
| `source_player_id` | Source player id. Must equal `player_source_ids.source_player_id`. |
| `season` | Season label, e.g. `2024-2025`. |
| `competition_name` | Competition the metric was produced in (stored for traceability). |
| `team_name` | Team (stored for traceability). |
| `metric_name` | **Canonical** metric key (see below). Aliases accepted; unknown names are quarantined. |
| `metric_value` | Numeric value. |
| `unit` | `per90` \| `pct` \| `index` \| `count` \| `years`. |
| `minutes` | Minutes behind the sample (used for confidence context). |
| `position_group` | `ATT` \| `MID` \| `DEF` \| `GK`. |
| `source_snapshot_id` | Snapshot label for reproducibility (e.g. `fbref_2025_01`). |

## Optional columns

`source_url`, `provider_player_name`, `provider_team_id`, `provider_competition_id`,
`match_scope` (e.g. `league` vs `all_competitions`), `notes`.

## Accepted metric names

The canonical registry is [`configs/metrics/canonical_metrics_v1.yaml`](../../configs/metrics/canonical_metrics_v1.yaml)
(single source of truth). Common performance keys: `non_penalty_goals_per90`,
`non_penalty_xg_per90`, `shots_per90`, `touches_in_box_per90`, `goals_minus_xg_per90`,
`xa_per90`, `key_passes_per90`, `shot_creating_actions_per90`, `passes_into_final_third_per90`,
`progressive_passes_per90`, `progressive_carries_per90`, `carries_into_final_third_per90`,
`carries_into_penalty_area_per90`, `successful_take_ons_per90`, `take_on_success_pct`,
`pass_completion_pct`, `dispossessed_per90`, `miscontrols_per90`, `tackles_per90`,
`interceptions_per90`, `pressures_per90`, `ground_duels_won_pct`, `aerial_duels_won_pct`.
Legacy aliases (e.g. `npg_per90` → `non_penalty_goals_per90`) still resolve.

## How identity is matched

At ingest the pipeline looks up `(source_name, source_player_id)` in `player_source_ids`
(populated by the Transfermarkt ingest). Rows whose id has no match are **quarantined**
(counted in the data-quality report as `unknown_source_player_ids`) — they never crash the run.

## How missing metrics affect confidence

Missing metrics are **not** treated as zero. A role rating is computed from whatever
metrics are present; absent required metrics **lower the rating's confidence** and are
listed in the audit. A metric with no data simply produces no normalized row.

## How to run

```bash
# 1) identity/market first (so player_source_ids exist to match against)
make ingest-transfermarkt INPUT=data/raw/transfermarkt
# 2) then performance metrics
make ingest-performance-csv INPUT=data/contracts/player_season_metrics_v1.csv
# 3) recompute
make recompute-ratings
# 4) inspect
make data-quality
```

## Adding a new metric

1. Add it to `configs/metrics/canonical_metrics_v1.yaml` (name, `unit`, `higher_better`,
   `kind: performance`, `face_group`, optional `aliases`).
2. Reference it in role/playstyle configs as needed (a fail-loud test rejects unknown ones).
3. Provide it in this CSV; `make recompute-ratings`.

## Adding a new source

Provide rows with that source's `source_name` + `source_player_id` and ensure those ids
exist in `player_source_ids` (ingest that identity source first, or add an adapter). See
[`docs/data_sources.md`](../data_sources.md).
