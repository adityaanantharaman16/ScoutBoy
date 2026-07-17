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
| **StatsBomb Open Data pilot** | Real event-derived player metrics for the 2023/24 pilot | **Active** (`--source statsbomb_pilot`) | `statsbomb_pilot.py` |
| **StatsBomb Open Data normalized import** | Provider-agnostic competitions, seasons, teams, players, matches, lineups, events, coverage, confidence, and event-derived metrics | **Active** (`--source statsbomb_open_data`) | `statsbomb_open_data.py` |
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
- **Provider ids are external ids.** Provider-specific ids are stored in
  `provider_identifiers` / `player_source_ids`. ScoutBoy domain rows keep their own primary
  keys so a commercial StatsBomb feed or another provider can be swapped in later.
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

## StatsBomb Open Data normalized import

StatsBomb does not provide free academic/sandbox/trial API access. The open GitHub dataset is
useful for validating ScoutBoy's event processing, role profiles, confidence handling, and UI
transparency, but it is selective and uneven. It must not be presented as a comprehensive
current-season scouting database.

Use a local checkout or extracted snapshot with the official layout:

```bash
make db-migrate
make ingest-statsbomb-open INPUT=data/raw/statsbomb
```

Equivalent raw command:

```bash
python -m data_pipeline.jobs.ingest --source statsbomb_open_data --input-path data/raw/statsbomb --recent-seasons 2
```

Filters:

```bash
python -m data_pipeline.jobs.ingest --source statsbomb_open_data --input-path data/raw/statsbomb --competition-id 9 --statsbomb-season-id 281 --as-of-date 2024-06-30
```

`--recent-seasons 2` selects the two most recent available seasons per competition using
derived season dates. When local match files exist, the importer uses the min/max `match_date`;
only if match files are missing does it fall back to parsed season labels. Missing events,
lineups, or 360 files become coverage warnings instead of import failures.

StatsBomb attribution is required anywhere imported data is presented:

> StatsBomb Open Data: https://github.com/statsbomb/open-data

The importer records:

- `providers` and `provider_identifiers`
- normalized competitions, seasons, teams, players, registrations, matches, lineups, and events
- match-count coverage and optional 360 availability
- player evidence confidence components: minutes, appearances, starts, coverage confidence,
  sample-size confidence, provisional league-adjustment confidence, role-similarity confidence,
  and overall evidence confidence

Coverage percentage is only populated when a known total match count is supplied by a trusted
provider. Open Data match-file counts are recorded as `matches_covered`, not assumed to be full
competition coverage.

## Curated U23 showcase

`configs/showcase/u23_showcase_v1.yaml` defines a 20-player demo cohort spanning roles,
positions, competitions, sample sizes, and confidence states. It is marked `fixture_demo` and
`never_present_as_provider_supplied: true`. Use it to exercise product workflows while keeping
seeded/demo records visually distinct from StatsBomb-imported records.

## Current-data provider spike

The normalized provider interface is ready for a lightweight current-data provider covering
competitions, seasons, squads, players, fixtures, standings, and basic player statistics. No
credentials are assumed in this repo, and no secrets should be committed. Until credentials are
available, use fixture-backed discovery/showcase records and label them as demo/current-discovery
fixtures.

## Adding a new source (checklist)

1. Implement `SourceAdapter.fetch()` returning an `IngestBundle` of canonical records.
2. Register it in `packages/data_pipeline/adapters/__init__.py` (`ADAPTERS`).
3. Run `python -m data_pipeline.jobs.ingest --source <name>` then `recompute`.
4. Add adapter unit tests mapping a small fixture → canonical records.
