# Contributing to ScoutBoy

ScoutBoy is a production-shaped portfolio project with deliberately limited open-data coverage.
Contributions should preserve explainability, provenance, honest missing-data behavior, and the
existing product scope.

## Local setup

Use Python 3.9 or 3.11, Node 20, Corepack/pnpm, and optionally Docker:

```bash
corepack enable
make install
make seed
make recompute-ratings
make dev
```

SQLite is the zero-setup default. See `docs/runbooks/local-development.md` for PostgreSQL and the
full-stack container path.

## Change workflow

1. Keep route handlers thin; domain logic belongs in the existing service/domain packages.
2. Keep provider-specific fields inside adapters and canonicalize before persistence/scoring.
3. Put rating, playstyle, metric, and context policy in versioned configuration.
4. Treat missing metrics as missing and lower confidence; never coerce them to zero.
5. Add focused tests and update documentation whenever behavior or operator steps change.
6. Regenerate API contracts after an API schema change with `make check-api-contract`. A stale
   first run updates the files and fails; rerun it to confirm they are current.
7. For adapter changes, declare honest provider capabilities and test contract conformance,
   no-write validation, fingerprint idempotency, quarantine/replay, and coverage limitations.

Before opening a pull request, run:

```bash
make lint
make test
pnpm --filter @scoutboy/web typecheck
make check-api-contract
make e2e
git diff --check
```

`make e2e` is self-contained: it builds the web app with the dedicated API URL, migrates/seeds a
temporary SQLite database, and starts production servers on `127.0.0.1:18080` and
`127.0.0.1:13080`. It does not attach to `make dev` or modify `db/scoutboy.db`. Only set
`SCOUTBOY_E2E_REUSE_EXISTING_SERVER=1` when intentionally targeting servers on the explicitly
configured E2E ports.

If Docker is available, also run `make docker-smoke`. CI repeats these gates and exercises the
pipeline and an API read against a real PostgreSQL service.

## Data and security rules

- Never commit `.env` files, tokens, database files, raw provider snapshots, or licensed data.
- Keep deterministic synthetic fixtures under `data/sample/`; keep local provider input under
  gitignored `data/raw/` paths.
- Preserve provider attribution, license metadata, checksums, and coverage caveats.
- Keep complete commercial payloads out of quarantine; store limited safe diagnostics and hashes.
- Run `make validate-source` and `make ingest-dry-run` before publishing a new snapshot. Ingestion
  never authorizes or triggers rating recomputation automatically.
- Report suspected vulnerabilities through the process in `SECURITY.md`, not a public issue.

## Pull requests

Describe the behavior changed, validation run, data/provenance impact, and any check that could not
run locally. Do not combine Milestone 4 maintenance work with new roles, providers, rating models,
authentication, or UI redesigns.
