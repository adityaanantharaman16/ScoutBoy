# Data sources

ScoutBoy is built ports-and-adapters so sources can be added without touching product
pages. Every source maps into the canonical records in
`packages/data_pipeline/adapters/base.py`; provider-specific field names never leak
past the adapter.

| Source | Used for | Status | Adapter |
| --- | --- | --- | --- |
| **Sample fixtures** (synthetic) | Identity, appearances, per-90 metrics, market inputs | **Active** (`--source sample`) | `sample_adapter.py` |
| **dcaribou/transfermarkt-datasets** | Canonical players, clubs, competitions, appearances, valuations | **Active** (`--source transfermarkt --input-path <csv_dir>`) | `transfermarkt_adapter.py` |
| **Performance metrics CSV** (`player_season_metrics_v1`) | Real/curated performance metrics from FBref/StatsBomb/Wyscout/etc. | **Active** (`--source performance_csv --input-path <csv>`) | `csv_adapter.py` |
| **StatsBomb Open Data** | Event → canonical metric mapping (proof + tests) | Mapping tested; not wired | `statsbomb_adapter.py` |
| **Football-Data.co.uk** | Team-strength / stakes **context** proxies | Helper tested | `football_data_adapter.py` |
| FBref / Understat / TM public pages | Manual validation & methodology reference | Not scraped | — |
| Paid providers (Opta, Wyscout, SkillCorner, StatsBomb commercial) | Later only | Architecture ready | — |

The real-data-v0 path (Milestone 2) is documented in
[`milestone_2_real_data_v0.md`](milestone_2_real_data_v0.md); the metrics contract in
[`data_contracts/player_season_metrics_v1.md`](data_contracts/player_season_metrics_v1.md).

## Rules

- **No live scraping in the MVP.** Adapters exist so real data can be added later behind
  explicit approval. If pre-scraped data is used, label its source and store the snapshot.
- **Snapshots.** `IngestBundle.source_snapshot_id` is recorded on every `rating_run` and on
  each raw metric row for reproducibility (US-7.2, US-7.8).
- **Fail loudly.** `packages/data_pipeline/quality/checks.py` aborts ingestion on error-level
  findings (schema drift, duplicate ids, impossible dates, negative metrics) rather than
  emitting silently-bad ratings (US-7.9).

## Sample data

`data/sample/` is generated deterministically by `db/seeds/generate_sample.py`
(24 fictional players; real clubs/leagues). Regenerate with:

```bash
python3 db/seeds/generate_sample.py
```

## Adding a new source (checklist)

1. Implement `SourceAdapter.fetch()` returning an `IngestBundle` of canonical records.
2. Register it in `packages/data_pipeline/adapters/__init__.py` (`ADAPTERS`).
3. Run `python -m data_pipeline.jobs.ingest --source <name>` then `recompute`.
4. Add adapter unit tests mapping a small fixture → canonical records.
