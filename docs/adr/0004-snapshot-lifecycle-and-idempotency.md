# ADR 0004: Snapshot lifecycle, idempotency, and quarantine ownership

- Status: accepted
- Date: 2026-07-22

## Context

ScoutBoy already recorded ingestion in `rating_runs`, immutable provider metadata in
`source_snapshots`, and structured checks in `data_quality_reports`. Milestone 5 needs explicit
states, reproducible fingerprints, no-write validation, idempotent replay, and persistent rejected
rows. Adding a parallel ingestion-run/snapshot hierarchy would split operational truth.

## Decision

Extend `RatingRun` for both existing run types with ingestion-only provider, mode, fingerprint,
scope, transition summary, structured failure, and replay fields. Extend `SourceSnapshot` with
fingerprint, scope, health, provider metadata, and a deterministic hashed canonical inventory.
Keep `DataQualityReport` as the per-run validation artifact.

Add `QuarantineRecord` because a rejected row has an independent open/resolved/replayed lifecycle
and query pattern. Retain only safe diagnostics and a payload fingerprint, not full provider payloads.

Use provider + SHA-256 fingerprint + normalized scope as the idempotency key. The fingerprint is
derived from provider/version/checksum, scope, and canonical inventories; machine-local paths are
excluded. Identical completed content creates a `skipped_idempotent` run without republishing.

Preserve a transaction boundary after blocking validation and before canonical publication.
Dry-run and validate-only do not create any database rows. Recompute remains a separate command.
Replay occurs at snapshot scope, the smallest reliable unit for current file/snapshot adapters.

## Consequences

- Operators have one run history and one snapshot history.
- Corrected content with a reused source label remains distinct by fingerprint.
- Snapshot diffs do not require retaining licensed raw payloads.
- Historical inventories are diagnostic summaries, not a second canonical datastore.
- Existing `RatingRun` naming is broader than its current responsibilities, but renaming the table
  would add migration risk without improving ownership.
- A future provider offering stable row-level replay tokens may add row-scope replay behind the
  same quarantine contract; current adapters do not pretend to support it.
