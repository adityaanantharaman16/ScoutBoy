# Milestone 2 — Real Data v0

Moves ScoutBoy from synthetic-only data to a **real, reproducible ingestion pipeline**
for real U23 European attackers/midfielders, using a Transfermarkt-style identity/market
dataset joined with a strict performance-metrics CSV. The app architecture is unchanged;
no new product features.

## 1. What Milestone 2 added

- **Canonical metric registry** — `configs/metrics/canonical_metrics_v1.yaml` is now the
  single source of truth for metric identity (name, unit, direction, kind, face group,
  aliases). `scoutboy_shared.metrics` loads it; a test fails loudly if a role/playstyle
  config references a metric not in the registry.
- **Transfermarkt adapter** (`--source transfermarkt --input-path <csv_dir>`) — introspects a
  CSV directory (or DuckDB), validates required columns, and maps players, clubs,
  competitions, appearances, and market valuations into canonical tables. Preserves source
  ids in `player_source_ids`; idempotent; tolerant of missing optional fields; keeps
  out-of-scope players (flagged, not dropped).
- **Performance CSV adapter** (`--source performance_csv --input-path <csv>`) — the strict
  long-format contract `player_season_metrics_v1`. Matches rows to canonical players via
  `(source_name, source_player_id)`; quarantines unknown ids / invalid metric names / invalid
  negatives into the data-quality report instead of crashing.
- **Schema hardening (migration 0002)** — dedupe unique index on `player_metrics_raw`, unique
  `role_ratings(player, role, season, version)`, and a new `player_universe_memberships` table.
- **MVP universe** (`normalize/mvp_universe.py`) — materialized during recompute
  (U23 + attacker/midfielder + European + minutes ≥ threshold), non-destructive. The search
  API filters to it by default (`universe=mvp`; `universe=all` opts out).
- **Context v0** — config-driven league/team/stakes/sample multipliers (unknown → safe default).
- **Data-quality report** — flags duplicates, missing fields, unknown source ids, invalid
  metrics, low-sample players, and unsupported positions.

## 2. How to obtain / place the Transfermarkt dataset

Download [dcaribou/transfermarkt-datasets](https://github.com/dcaribou/transfermarkt-datasets)
(CSV exports or DuckDB). Place the CSVs under `data/raw/transfermarkt/` with at least
`players.csv`, `clubs.csv`, `competitions.csv` (optionally `appearances.csv`,
`player_valuations.csv`). Column expectations are documented in the adapter docstring
(`packages/data_pipeline/adapters/transfermarkt_adapter.py`) — a pre-shaped subset is fine;
the sample fixtures in `data/sample/transfermarkt_sample/` show the exact shape.

## 3. How to fill the performance metrics CSV

Copy `data/contracts/player_season_metrics_v1.example.csv`, fill rows using canonical metric
names, and set `source_name`/`source_player_id` to match the Transfermarkt ids. Full column
reference: [`docs/data_contracts/player_season_metrics_v1.md`](data_contracts/player_season_metrics_v1.md).

## 4. How source ids are matched

Transfermarkt ingest writes `player_source_ids(source_name='transfermarkt', source_player_id=…)`.
The performance CSV's `(source_name, source_player_id)` is looked up there at ingest; unmatched
rows are quarantined (reported as `unknown_source_player_ids`).

## 5–7. Run ingestion, recompute, read the report

```bash
make ingest-transfermarkt INPUT=data/raw/transfermarkt      # or omit INPUT for the sample dir
make ingest-performance-csv INPUT=data/contracts/player_season_metrics_v1.csv
make recompute-ratings
make data-quality           # prints + stores a data_quality_reports row
```

The report lists each check with `ok/warn/error` and counts. `error`-level findings on a full
identity source abort the run (fail loudly); warnings do not.

## 8. What is still fake / sample

- The shipped fixtures (`data/sample/transfermarkt_sample/`, `data/sample/performance_metrics_sample.csv`,
  and the synthetic `data/sample/`) use **fictional players** (real clubs/leagues). No real
  player data is bundled.
- Context multiplier *values* are placeholder-but-configurable (v0), not calibrated.
- Opposition quality is a league proxy; role usage is nominal.

## 9. What is real-data-ready

- Identity/market ingestion, source-id join, performance-metric normalization, RoleFit/
  playstyle/market recompute, MVP-universe filtering, and the whole API/UI all run on
  ingested data. Drop in a real Transfermarkt export + a metrics CSV and it works unchanged.

## 10. Known limitations & next-milestone recommendations

- Real dcaribou `appearances.csv` is per-match (needs a `games.csv` season join to aggregate);
  the adapter currently expects a pre-aggregated per-player-season `appearances.csv`. **M3:** add
  an aggregation pre-step.
- Context values need calibration against real outcomes. **M3:** data-driven league/team strength.
- No cross-source identity fuzzy-matching beyond name+birthdate. **M3:** stronger resolution.
- International caps / hype are absent from Transfermarkt (market model handles the gap).
