# Runbook: Ingestion, quarantine, and replay

## Validate before publication

1. Apply migrations with `make db-migrate`.
2. Inspect capability metadata with `make providers`.
3. Run `make validate-source SOURCE=<source> INPUT=<path>` for contract/quality validation.
4. Run `make ingest-dry-run SOURCE=<source> INPUT=<path>` and review fingerprint, scope, intended
   writes, warnings, and quarantine candidates.
5. Run the normal ingest command. Do not run recompute until the ingestion result is accepted.

Normal statuses are planned, validating, ingesting, completed, completed-with-warnings,
idempotently skipped, or failed. Inspect history with `make ingestion-runs` and one run with
`python -m data_pipeline.operations run <id>`.

## Triage quarantine

Run `make quarantine-report` or query `GET /api/admin/quarantine` with the admin token. Group by
reason code and provider. Confirm that diagnostic context contains no secrets or full licensed
payload. Typical actions:

- unresolved/ambiguous identity: correct the source id or add a reviewed identity override;
- invalid metric name/value: fix canonical mapping or input value;
- duplicate source record: choose the source's authoritative row;
- unsupported position: extend only the adapter mapping, not role/rating scope;
- schema drift/missing fields: update and test the adapter before retrying.

Never replace missing values with zero, edit quarantine rows into canonical data, or weaken a
blocking check to force publication.

## Replay corrected input

Replay is snapshot-scope. Keep the original run id, repair the source fixture/file or reviewed
identity override, then run:

```bash
make replay-ingestion RUN=<original-run-id> SOURCE=<source> INPUT=<corrected-path>
```

A corrected fingerprint creates a new run/snapshot. It resolves only original quarantine records
whose same source row or identity is no longer rejected and was successfully published. A partial
correction therefore leaves every still-invalid or unaddressed original record open. Repeating the
same corrected source returns `skipped_idempotent` and does not duplicate canonical or quarantine
rows. Run explicit recompute only after inspecting the replay result:

```bash
make recompute-ratings
```

For a failed blocking run, verify that no source snapshot or canonical rows were published. For a
warning run, verify valid-row counts and quarantine rates before accepting partial publication.
