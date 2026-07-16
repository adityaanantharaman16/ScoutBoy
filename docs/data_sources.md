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
| **StatsBomb Open Data** | Real event-derived player metrics for the 2023/24 pilot | **Active** (`--source statsbomb_pilot`) | `statsbomb_pilot.py` |
| **Football-Data.co.uk** | Team-strength / stakes **context** proxies | Helper tested | `football_data_adapter.py` |
| FBref / Understat / TM public pages | Manual validation & methodology reference | Not scraped | — |
| Paid providers (Opta, Wyscout, SkillCorner, StatsBomb commercial) | Later only | Architecture ready | — |

The real-data-v0 path (Milestone 2) is documented in
[`milestone_2_real_data_v0.md`](milestone_2_real_data_v0.md); the metrics contract in
[`data_contracts/player_season_metrics_v1.md`](data_contracts/player_season_metrics_v1.md).

## Rules

- **No live scraping in the MVP.** Adapters exist so real data can be added later behind
  explicit approval. If pre-scraped data is used, label its source and store the snapshot.
- **Snapshots.** `source_snapshots` stores provider, dataset version, checksum, license,
  target season, path, and row counts. Appearances and raw metrics link to the snapshot;
  rating runs retain snapshot keys.
- **Fail loudly.** `packages/data_pipeline/quality/checks.py` aborts ingestion on error-level
  findings (schema drift, duplicate ids, impossible dates, negative metrics) rather than
  emitting silently-bad ratings (US-7.9).

## Sample data

`data/sample/` is generated deterministically by `db/seeds/generate_sample.py`
(24 fictional players; real clubs/leagues). Regenerate with:

```bash
python3 db/seeds/generate_sample.py
```

## Milestone 3 pilot

- Transfermarkt via dcaribou/Kaggle supplies identity, DOB, clubs, full-season minutes, and
  public valuation history selected as of 2024-06-30.
- StatsBomb Open Data supplies event metrics and covered minutes for 34 Bundesliga matches.
- The available StatsBomb competition snapshot covers every Bayer Leverkusen league match and
  each opponent only when facing Leverkusen. It is therefore a Leverkusen-centered vertical
  slice, not a full Bundesliga sample.
- Identity matching is exact normalized name, unique contained name, or a reviewed override.
  Ambiguous/unmatched records are quarantined and reported; they are never auto-merged.
- Raw snapshots are gitignored. Their manifests in `data/manifests/` are committed.

## Adding a new source (checklist)

1. Implement `SourceAdapter.fetch()` returning an `IngestBundle` of canonical records.
2. Register it in `packages/data_pipeline/adapters/__init__.py` (`ADAPTERS`).
3. Run `python -m data_pipeline.jobs.ingest --source <name>` then `recompute`.
4. Add adapter unit tests mapping a small fixture → canonical records.
