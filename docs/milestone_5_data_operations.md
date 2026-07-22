# Milestone 5 — Data operations and provider readiness

> Status: implemented. This milestone improves operational reliability and licensed-provider
> readiness. It does not add live API access, paid data, scraping, football coverage, ratings,
> market-model behavior, or UI features.

## Implementation plan and ownership audit

The repository audit found that three existing models already owned most of the lifecycle:

- `RatingRun` recorded ingest and recompute history, so it was extended with provider, mode,
  fingerprint, scope, transition summary, structured failure, and replay metadata.
- `SourceSnapshot` already owned provider snapshot provenance, so it was extended with fingerprint,
  scope, provider type, health, attribution, limitation, and a compact operational inventory.
- `DataQualityReport` remains the immutable structured check result associated with a run.

Rejected rows did not have an independent lifecycle. `QuarantineRecord` is therefore the one new
operational model. It supports safe diagnostics, indexed inspection, resolution, and replay without
duplicating quality reports or storing full commercial-provider payloads.

The implementation order was: formal provider contract; lifecycle and idempotency; persistent
quarantine/replay; diff/freshness/coverage reports; mock commercial and generated fixtures; admin
reads, CLI/Make targets, migration, tests, ADR, and runbooks.

## Provider contract

Every `SourceAdapter` declares immutable `ProviderCapabilities`: deterministic provider identity,
type, ingestion mode, credential shape, supported entities and metrics/families, coverage
dimensions, freshness semantics, attribution/license requirements, and known limitations.
`data_pipeline.provider_contract` validates both declarations and emitted canonical bundles.

Current declarations cover:

| Provider | Type / mode | Honest scope |
| --- | --- | --- |
| `sample` | fixture / local snapshot | 24-player synthetic demo |
| `transfermarkt` | market/identity / local snapshot | local CSV/DuckDB identity, appearance, valuation data |
| `performance_csv` | basic statistics / file import | metric-only contract; identities must exist |
| `statsbomb` | event / local snapshot | Bayer Leverkusen-centered 34-match 2023/24 pilot mapping |
| `statsbomb_open_data` | event / local snapshot | exactly the selected local Open Data files |
| `mock_commercial_provider` | commercial / API-ready boundary | local fixture only; no vendor or network claims |
| `generated_fixture` | fixture / local snapshot | deterministic scale testing only |

Football-Data and the small StatsBomb event mapper remain pure context/mapping helpers, not
ingestable `SourceAdapter` implementations, so they do not falsely claim snapshot capabilities.

## Lifecycle and publication boundary

Normal ingestion uses these deterministic states:

```text
planned → validating → ingesting → completed
                                ↘ completed_with_warnings
            ↘ failed
            ↘ skipped_idempotent
```

- `--dry-run` fetches, canonicalizes, validates, fingerprints, and reports intended writes. It
  writes no canonical rows, snapshots, runs, ratings, quality reports, or quarantine rows.
- `--validate-only` performs provider-contract and quality validation with the same no-write rule.
- Normal mode records a run before adapter fetch, so blocking parser/schema failures are auditable.
- Canonical writes begin only after blocking contract and quality checks pass.
- Ingestion never invokes recompute. `make recompute-ratings` remains explicit.

## Fingerprint and idempotency policy

The SHA-256 fingerprint includes provider, declared dataset version/checksum, normalized scope, and
a deterministic inventory of canonical entities, metrics, and coverage rows. Local path is not an
identity component. The idempotency key is provider + fingerprint + relevant scope.

If a completed snapshot with that key exists, ScoutBoy records a `skipped_idempotent` run and does
not create a snapshot, quality report, provenance row, player, metric, coverage row, quarantine
record, or rating. Corrected content changes the inventory fingerprint and creates a distinct
snapshot even when the source's human-readable snapshot id was reused.

## Quarantine and replay

Quarantine rows store run/snapshot linkage, provider/source, entity type, external id when known,
reason/severity, a payload fingerprint, limited safe diagnostic context, and resolution/replay
timestamps. Secrets and complete provider payloads are excluded.

Covered reasons include unresolved/ambiguous identity, invalid canonical metric, invalid metric
value, duplicate source record, source schema drift, missing required fields, and unsupported
position mapping. Nonblocking metric rows are omitted while valid rows publish with warnings.
Blocking schema/contract errors fail before snapshot/canonical publication.

Generic player resolution uses source-qualified ids, then a unique canonical name + date-of-birth
bridge. Multiple canonical candidates produce a persistent ambiguity record and exclude that
source player's identifiers and dependent observations; zero candidates remain valid first-time
source-backed players.

Replay is snapshot-scope because current adapters can reliably re-fetch a corrected immutable file
but do not retain licensed raw rows. Pass the original failed/warning run id plus the corrected
source. A successful replay resolves only original issues whose source row or identity is no longer
rejected and is successfully published; uncorrected issues remain open after partial replay. The
new fingerprint and the normal natural-key upserts keep replay idempotent.

## Reports and health labels

Snapshot metadata retains hashed inventories rather than historical raw provider payloads. This
supports deterministic added/removed/updated entity, metric, and coverage diffs plus identity,
quarantine, version, and freshness changes.

Freshness uses `healthy`, `partial`, `stale`, `blocked`, `demo_only`, and `unknown`. Fixture data is
always `demo_only`. Dated non-fixtures are healthy through 90 days, partial through 365 days, then
stale. Missing as-of dates remain unknown.

Coverage reports show observed competitions, seasons, teams, matches, players, player-season rows,
event coverage, metric completeness, role-required metric availability, identity match rate,
quarantine rate, and limitations. They explicitly state that observed local rows are not inferred
full-competition coverage. The real pilot remains a 34-match Leverkusen-centered slice.

## Operator commands

```bash
make providers
make validate-source SOURCE=sample
make ingest-dry-run SOURCE=sample
make ingest-sample
make ingestion-runs
make quarantine-report
make replay-ingestion RUN=12 SOURCE=performance_csv INPUT=/path/to/corrected.csv
make snapshot-diff BEFORE=1 AFTER=2
make freshness-report
make coverage-report
make data-benchmark SIZE=5000
make recompute-ratings
```

All report/benchmark commands emit machine-readable JSON. Protected read-only admin routes expose
providers, ingestion runs/details, quarantine, snapshot diff, freshness, and coverage. The existing
admin-token guard applies; there is no public operations API or admin frontend.

## Scale evidence

`GeneratedFixtureAdapter` creates at least 5,000 player-season records and five canonical metrics
per player without committing a large artifact. Identity and appearance lookups are batch-loaded;
metric writes use a single unit-of-work flush/commit path. Relevant provider IDs, snapshots,
player-season metrics, run history, and quarantine columns are indexed.

On the local SQLite validation environment on 2026-07-22, 5,000 player-seasons plus 25,000 metric
rows ingested in 2.681 seconds, wrote 30,000 player/metric records, and quarantined zero. This is a
comparison baseline, not a CI threshold. Hardware, database, and optional recompute materially
change results.

## Remaining limitation and Milestone 6

Provider readiness is demonstrated through local fixtures and open/local adapters only. A licensed
provider still requires commercial terms, credential governance, retention rules, actual endpoint
mapping, provider-specific integration tests, and coverage acceptance. Milestone 6 remains rating
calibration and model evaluation; no weights or rating outputs were calibrated here.
