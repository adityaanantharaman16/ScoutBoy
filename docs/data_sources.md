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
| **Mock commercial provider** | Licensed-provider boundary proof with canonical fixture records | **Fixture/demo only** (`--source mock_commercial_provider`) | `mock_commercial_provider.py` |
| **Generated scale fixture** | Deterministic 5,000+ player-season batching and benchmark | **Fixture/demo only** (`--source generated_fixture`) | `generated_fixture.py` |
| **Football-Data.co.uk** | Team-strength / stakes **context** proxies | Helper tested | `football_data_adapter.py` |
| FBref / Understat / TM public pages | Manual validation & methodology reference | Not scraped | — |
| Paid providers (Opta, Wyscout, SkillCorner, StatsBomb commercial) | Later only | Architecture ready | — |

The real-data-v0 path (Milestone 2) is documented in
[`milestone_2_real_data_v0.md`](milestone_2_real_data_v0.md); the metrics contract in
[`data_contracts/player_season_metrics_v1.md`](data_contracts/player_season_metrics_v1.md).
Discover scope behavior is documented in [`discover_scope_change.md`](discover_scope_change.md).

## Rules

- **No live scraping in the MVP.** Adapters exist so real data can be added later behind
  explicit approval. If pre-scraped data is used, label its source and store the snapshot.
- **Directory coverage is not analytical coverage.** `scope=all_records` may expose defenders,
  goalkeepers, unrated players, and limited-coverage records. `scope=analyzed` means at least
  one RoleFit rating exists for the season. `scope=high_coverage_u23` is the unchanged strict
  U23 attacker/midfielder evidence cohort.
- **Provider capabilities.** Every ingestable adapter declares provider type, mode, credentials,
  supported canonical entities/metrics, coverage dimensions, freshness, attribution, and known
  limitations. Run `make providers` to inspect the machine-readable contract.
- **Snapshots.** `source_snapshots` stores provider, dataset version, checksum/fingerprint,
  scope, license/attribution, health, limitation, path, row counts, and a hashed operational
  inventory. Appearances and raw metrics link to the snapshot; runs retain snapshot keys.
- **Provider ids are external ids.** Provider-specific ids are stored in
  `provider_identifiers` / `player_source_ids`. ScoutBoy domain rows keep their own primary
  keys so a commercial StatsBomb feed or another provider can be swapped in later.
- **Fail or quarantine explicitly.** Blocking contract/schema/identity failures stop publication.
  Invalid row-level metrics can be persistently quarantined while valid rows finish with warnings.
  Missing values are never converted to zero.
- **Resolve player identities conservatively.** An exact provider source id wins; otherwise one
  canonical name + date-of-birth match may bridge sources. No match creates a legitimate
  first-time source-backed player, while multiple matches are quarantined as ambiguous and the
  player's appearances, metrics, and other dependent observations are not published.

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

## Provider readiness

The normalized provider interface is ready for a future licensed provider without claiming that a
client exists today. `mock_commercial_provider` is local-fixture-only, makes no network requests,
and is always marked demo data. Its optional credential-required mode documents the environment
shape `SCOUTBOY_MOCK_COMMERCIAL_TOKEN`; tests use a dummy value, never a vendor token. See the
[provider onboarding runbook](runbooks/provider-onboarding.md).

## Adding a new source (checklist)

1. Implement `SourceAdapter.fetch()` and a complete immutable `ProviderCapabilities` declaration.
2. Register it in `packages/data_pipeline/adapters/__init__.py`.
3. Add shared conformance, dry-run, idempotency, quarantine, replay, and report tests.
4. Validate and dry-run before normal ingestion; inspect the run; recompute explicitly only after
   acceptance.
