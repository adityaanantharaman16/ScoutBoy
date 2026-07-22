# Runbook: Provider onboarding

This process applies to local fixtures now and a future licensed provider later. It does not grant
permission to scrape or connect to a vendor.

1. Confirm legal rights, attribution, license, retention, deletion, geography, entity, metric, and
   freshness terms. Keep credentials outside the repository.
2. Add a `SourceAdapter` with a deterministic name and complete `ProviderCapabilities`. Claim only
   entities, canonical metric keys/families, and coverage dimensions the integration supplies.
3. Keep transport/provider fields inside the adapter. Emit canonical dataclasses with provider ids,
   snapshot metadata, checksums/versions, as-of dates, attribution, and honest limitations.
4. For credential-ready adapters, document exact environment-variable names and fail before any
   fetch when required credentials are absent. Never include secret values in errors, reports,
   quarantine, fixtures, or logs.
5. Add a small licensed-safe or synthetic fixture. Run the shared conformance suite to verify
   canonical output, provenance, source/snapshot metadata, honest missing coverage, and no field
   leakage.
6. Define blocking schema failures and row-level quarantine mappings. Store safe references and
   fingerprints by default, not complete commercial payloads.
7. Verify dry-run/validate-only do not mutate, identical snapshots skip, changed fingerprints
   create distinct runs, replay is idempotent, and recompute remains explicit.
8. Verify diff/freshness/coverage output and provider attribution. Never infer full league coverage
   from locally observed match counts.
9. Exercise the generated 5,000-record benchmark and PostgreSQL smoke without wall-clock gates.
10. Update documentation, API contracts if admin reads change, and all affected runbooks.

`mock_commercial_provider` demonstrates the boundary. It is fixture/demo data, makes no network
calls, optionally requires `SCOUTBOY_MOCK_COMMERCIAL_TOKEN`, and must never be relabeled as
Wyscout, StatsBomb commercial, Opta, or another vendor.
