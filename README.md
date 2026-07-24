# ScoutBoy

[![CI](https://github.com/adityaanantharaman16/ScoutBoy/actions/workflows/ci.yml/badge.svg)](https://github.com/adityaanantharaman16/ScoutBoy/actions/workflows/ci.yml)
[![Security](https://github.com/adityaanantharaman16/ScoutBoy/actions/workflows/security.yml/badge.svg)](https://github.com/adityaanantharaman16/ScoutBoy/actions/workflows/security.yml)

**FUT.gg-style, real-life football player discovery.** ScoutBoy turns messy football data
into clean, fan-readable scouting cards with role-specific ratings, playstyle badges, and
transparent market-value ranges — and it can always show *why* a score, badge, or value exists.

> **Product scope:** Broad player discovery across the available local dataset, with detailed
> RoleFit analysis only where ScoutBoy has enough modeled evidence. U23 scouting remains a
> prominent segment, and the strict U23 attacker/midfielder cohort is available as
> **High-coverage U23 analysis**. The current real-data pilot is a **Bayer Leverkusen-centered
> Bundesliga 2023/24 vertical slice** (34 StatsBomb matches), not full-league or live coverage.
> Missing data is shown as profile-only / low-confidence, never zero.

> Independent project. Not affiliated with FUT.gg, EA SPORTS FC, clubs, or data providers.
> Synthetic fixtures remain available for deterministic development and E2E tests.

---

## What it does

1. **Search / browse** player profiles with filters for analysis scope, age band, position, role,
   league, minutes, RoleFit range, playstyle, and sort.
2. **Player card** — identity, face stats, sub-stats, role-specific **RoleFit ratings**, playstyle
   badges, **market panel** (public value vs model value vs expected asking price), strengths &
   concerns, context, and a **"why this score" audit** accordion.
3. **Role leaderboards** ranked by final RoleFit with deterministic tie-breaks.
4. **Compare** two players side-by-side with a plain-English "why one rates higher".
5. **Methodology** page explaining the formula, context, playstyles, market model, sources & limits.

---

## Architecture

```
apps/web  (Next.js + TS + Tailwind + TanStack Query)  ──HTTP──▶  apps/api (FastAPI)
                                                                   routes → services → repositories → DB
                                                                   services → domain packages
                                                                       ▼
   packages/rating_engine   configs-driven RoleFit + playstyles + audit
   packages/market_model     transparent rule-based value / asking price
   packages/data_pipeline    ports-&-adapters ingestion, normalization, quality, jobs
   packages/shared           canonical metric registry, constants, confidence
   configs/{roles,playstyles,context}   all weights/thresholds/multipliers (YAML)
```

Enforced boundaries: no scoring in API routes, no ingestion in the frontend/routes, no
authoritative scoring in the frontend, all weights in config (never hard-coded), every score/
badge/value carries an explanation, deterministic sorts with explicit tie-breaks, versioned runs.
See [`docs/agent_notes.md`](docs/agent_notes.md) for decisions and intentional out-of-scope items.

---

## Tech stack

- **Frontend:** Next.js (App Router), TypeScript, Tailwind, TanStack Query, Vitest, Playwright.
- **Backend:** FastAPI, Pydantic v2, SQLAlchemy 2.0, Alembic, Uvicorn.
- **Domain/data:** Python 3.9+ (3.11+ recommended), pandas/DuckDB optional, pytest.
- **DB:** **SQLite by default** for zero-setup local development; PostgreSQL 16 for the
  production-shaped Compose stack and its CI integration smoke.

---

## Quickstart

Prereqs: Python 3.9 or 3.11 and Node 20 with `corepack` (for pnpm). No Docker required.

```bash
corepack enable pnpm          # once, if pnpm isn't available
make install                  # venv + backend deps, and pnpm frontend deps
make seed                     # migrate + load 24 synthetic sample players
make recompute-ratings        # compute RoleFit + playstyles + market values
make dev                      # API on :8000, web on http://localhost:3000
```

Open http://localhost:3000. Discover defaults to **Analyzed** players across all ages. Switch to
**All records** for the broader directory or **High-coverage U23** for the original strict cohort.
Search → open a card → expand "why these scores" → view a leaderboard → compare two players →
read the methodology page.

### Real data v0 (Milestone 2)

Two-source ingestion joined by stable source ids: a Transfermarkt-style dataset for
identity/market + a strict performance-metrics CSV. With the shipped sample fixtures:

```bash
make db-migrate
make seed-real          # transfermarkt sample + performance CSV + recompute
make data-quality
make dev                # Discover defaults to scope=analyzed; use scope=all_records for all profiles
```

With a real dataset: place a Transfermarkt CSV export under `data/raw/transfermarkt/`, fill
`data/contracts/player_season_metrics_v1.csv`, then:

```bash
make ingest-transfermarkt INPUT=data/raw/transfermarkt
make ingest-performance-csv INPUT=data/contracts/player_season_metrics_v1.csv
make recompute-ratings
```

See [docs/milestone_2_real_data_v0.md](docs/milestone_2_real_data_v0.md) and the metrics
contract [docs/data_contracts/player_season_metrics_v1.md](docs/data_contracts/player_season_metrics_v1.md).

### Real pilot (Milestone 3)

Place the pinned raw snapshots at `data/raw/transfermarkt/` and `data/raw/statsbomb/`.
Their committed manifests record source versions, licenses, checksums, and row counts.

```bash
make seed-pilot
make cohort-report
make verify-milestone-3
make dev-pilot
```

The verified cohort contains Florian Wirtz, Victor Boniface, and Adam Hlozek: the U23
attackers/midfielders who clear both 450 domestic-season minutes and 450 covered event-data
minutes. See [docs/milestone_3_real_cohort.md](docs/milestone_3_real_cohort.md).

### Discover scopes

- **Analyzed** (default): players with at least one RoleFit rating for the selected/current
  season.
- **All records**: every player with a usable season appearance/profile record. This includes
  defenders, goalkeepers, unrated players, and limited-coverage records.
- **High-coverage U23**: the unchanged materialized `mvp_u23_att_mid_eu` universe: U23 attackers
  and midfielders meeting ScoutBoy's minimum performance-coverage threshold.

Age bands are season-relative: U23 is `age <= 23`, then `24-26`, `27-30`, and `31+`.
Unknown ages appear under All ages only. Defender and goalkeeper records can be discovered, but
ScoutBoy does not currently model defender or goalkeeper RoleFit ratings.

### StatsBomb Open Data normalized import

The provider-agnostic importer reads a local StatsBomb Open Data snapshot without network access:

```bash
make db-migrate
make ingest-statsbomb-open INPUT=data/raw/statsbomb
```

It imports normalized provider provenance, competitions, seasons, teams, players, matches,
lineups, events, player-season appearances, event-derived metrics, coverage, and confidence
components. By default it keeps the two most recent available seasons per competition using
derived season dates, not season-name string sorting. Missing event, lineup, or 360 files are
recorded as coverage warnings. StatsBomb attribution is displayed in player evidence context
when Open Data powers the analysis.

### Using Postgres instead of SQLite

```bash
docker compose up -d db
export DATABASE_URL=postgresql+psycopg://scoutboy:scoutboy@localhost:5432/scoutboy
pip install -e ".[postgres]"
make db-migrate seed recompute-ratings
```

### Full-stack Docker

The separate full-stack configuration preserves the database-only `docker-compose.yml` workflow:

```bash
export SCOUTBOY_ADMIN_TOKEN=choose-a-local-secret
make docker-up       # build and start db -> migrate -> synthetic fixture bootstrap -> API -> web
make docker-logs     # follow logs
make docker-down     # stop containers; preserve PostgreSQL data
```

Open the web app at `http://localhost:3000` and API docs at `http://localhost:8000/docs`.
Defaults publish PostgreSQL on `5432`; override host ports with `SCOUTBOY_WEB_PORT`,
`SCOUTBOY_API_PORT`, and `SCOUTBOY_POSTGRES_PORT`. `NEXT_PUBLIC_API_BASE_URL` is a build-time
browser URL and defaults to `http://localhost:8000/api`; do not set it to Docker's internal
`http://api:8000` address because a host browser cannot resolve that name.

Compose refuses to render without an explicit admin token. Use a strong `SCOUTBOY_ADMIN_TOKEN` and
explicit `SCOUTBOY_WEB_ORIGINS` before adapting this reference configuration for deployment.

### Configuration modes

`SCOUTBOY_ENVIRONMENT` accepts `development`, `test`, or `production`. Development remains
zero-config: the admin token may be empty and localhost CORS origins are enabled. Production mode
refuses to start when `SCOUTBOY_ADMIN_TOKEN` is empty and rejects wildcard CORS origins. Copy
`.env.example` for the complete configuration surface; `.env` files remain untracked and are never
included in container images.

Health probes are deliberately small:

- `GET /healthz` confirms the API process is alive without touching the database.
- `GET /readyz` confirms database connectivity and that Alembic is at the current head revision.
- `GET /api/health` remains available for backward compatibility.

### Data operations (Milestone 5)

Every ingestable adapter now declares provider capabilities and follows an auditable snapshot
lifecycle. Validate or plan without writes, ingest idempotently, inspect quarantine, compare
snapshots, and report freshness/coverage through JSON CLI output:

```bash
make providers
make validate-source SOURCE=sample
make ingest-dry-run SOURCE=sample
make ingest-sample
make ingestion-runs
make quarantine-report
make freshness-report
make coverage-report
make data-benchmark SIZE=5000
```

Identical provider + fingerprint + scope inputs are recorded as `skipped_idempotent` without
duplicate publication. Corrected source files can be replayed at snapshot scope; ratings still
require the separate `make recompute-ratings` command. The mock commercial provider is local demo
data only and makes no network calls. See
[docs/milestone_5_data_operations.md](docs/milestone_5_data_operations.md).

### RoleFit calibration & model evaluation (Milestone 6)

A versioned calibration framework measures whether the existing RoleFit engine produces credible,
role-specific, context-aware, evidence-honest outputs. It **reuses the production scoring engine**
(no second model, no ML, no auto-tuning) and reports `pass` / `warn` / `fail` / `inconclusive`.

```bash
make calibration-evaluate-fixtures   # deterministic; no DB writes, no network
make calibration-evaluate-pilot      # read-only real-pilot evaluation (inconclusive if absent)
make calibration-evaluate            # both + a Markdown report at data/reports/calibration_report.md
```

Fixture evaluation is byte-stable (a regression gate); pilot evaluation is read-only and returns
`inconclusive` whenever the local pilot data is absent, so CI never fails on missing real data.
The pilot is a Bayer Leverkusen-centered StatsBomb slice, not full Bundesliga/European validation.
The Methodology page and `GET /api/methodology` surface a compact calibration status block. See
[docs/milestone_6_rating_calibration.md](docs/milestone_6_rating_calibration.md).

---

## Commands (`make help` for all)

| Command | What it does |
| --- | --- |
| `make install` | Create venv + install backend (`.[dev]`) and frontend (pnpm) deps |
| `make db-migrate` | Apply Alembic migrations (create tables) |
| `make seed` | Migrate + ingest the sample source |
| `make recompute-ratings` | Recompute ratings, playstyles, market values |
| `make ingest-sample` | Ingest the synthetic all-in-one sample source |
| `make ingest-transfermarkt` | Ingest a Transfermarkt-style CSV dir (`INPUT=…`; defaults to sample) |
| `make ingest-performance-csv` | Ingest a `player_season_metrics_v1` CSV (`INPUT=…`; defaults to sample) |
| `make ingest-statsbomb-open` | Ingest a local StatsBomb Open Data snapshot with provenance, events, coverage, and confidence |
| `make seed-real` | Real-data-v0 path: transfermarkt + performance CSV + recompute |
| `make seed-pilot` | Ingest pinned Transfermarkt + StatsBomb pilot snapshots and recompute |
| `make cohort-report` | Write the honest pilot coverage/cohort report |
| `make verify-milestone-3` | Enforce Milestone 3 provenance, identity, coverage, and output gates |
| `make dev-pilot` | Start API + web without reseeding synthetic data |
| `make data-quality` | Data-quality report (alias of quality-report) |
| `make quality-report` | Run data-quality checks and store a report |
| `make providers` | List provider capability contracts as JSON |
| `make validate-source` / `make ingest-dry-run` | Validate or plan ingestion without database writes |
| `make ingestion-runs` / `make quarantine-report` | Inspect lifecycle and rejected-row history |
| `make replay-ingestion` | Replay corrected input at snapshot scope without duplicates |
| `make snapshot-diff` | Compare two snapshots deterministically |
| `make freshness-report` / `make coverage-report` | Emit operational health and honest coverage JSON |
| `make data-benchmark` | Ingest a generated 5,000-record scale fixture and emit benchmark JSON |
| `make calibration-evaluate-fixtures` | Deterministic RoleFit fixture calibration (no DB writes, no network) |
| `make calibration-evaluate-pilot` | Read-only real-pilot calibration (inconclusive when data absent) |
| `make calibration-evaluate` | Fixtures + read-only pilot; write a Markdown review report |
| `make dev` / `dev-api` / `dev-web` | Run the stack / API only / web only |
| `make test` | Backend (pytest) + frontend (Vitest) |
| `make e2e` | Isolated DB + dedicated ports + production build/`next start` Playwright flow |
| `make lint` / `make format` | Ruff+Black+ESLint / auto-format Python |
| `make openapi` | Export OpenAPI to `docs/api_contracts/openapi.json` |
| `make check-api-contract` | Regenerate OpenAPI + TypeScript schema and fail if either was stale |
| `make postgres-smoke` | Exercise the configured PostgreSQL database and an API read (requires prepared PostgreSQL) |
| `make docker-build` | Build the API and production web images |
| `make docker-up` / `make docker-down` | Start/stop the production-shaped full stack |
| `make docker-logs` | Follow full-stack container logs |
| `make docker-smoke` | Build/start a disposable stack on 13000/18000/55432 and probe web/API health |

Raw pipeline commands (equivalent to the Make targets; run inside the venv with `PYTHONPATH` set):

```bash
python -m data_pipeline.jobs.ingest --source sample
python -m data_pipeline.jobs.recompute --ratings --playstyles --market
python -m data_pipeline.quality.report
```

*(The project plan writes these as `python -m packages.data_pipeline...`; the runnable module path
in this repo is `data_pipeline...` with the Makefile's `PYTHONPATH`.)*

---

## API

FastAPI serves an OpenAPI schema (`/docs`, or `make openapi` →
[`docs/api_contracts/openapi.json`](docs/api_contracts/openapi.json)). Endpoints:

```
GET  /api/players                      search (filters, pagination, deterministic sort)
GET  /api/players/{id}                 full player card
GET  /api/players/{id}/ratings         RoleFit ratings + audit breakdowns
GET  /api/players/{id}/playstyles      badges + concerns with why_applied
GET  /api/players/{id}/market          public / model / asking, label, confidence
GET  /api/players/{id}/similar         style / quality / cheaper / higher-upside comps
GET  /api/roles/{role_key}/rankings    role leaderboard
GET  /api/compare                      side-by-side + why one rates higher
GET  /api/methodology                  methodology metadata for the UI
GET  /healthz                          process liveness
GET  /readyz                           database + migration readiness
POST /api/admin/ingest                 (local admin) trigger ingestion
POST /api/admin/recompute-ratings      (local admin) trigger recompute
GET  /api/admin/rating-runs            run history
GET  /api/admin/providers              provider capabilities
GET  /api/admin/ingestion-runs         ingestion lifecycle history
GET  /api/admin/ingestion-runs/{id}    one ingestion run
GET  /api/admin/quarantine             persistent rejected-row diagnostics
GET  /api/admin/snapshots/{id}/diff    deterministic snapshot comparison
GET  /api/admin/freshness              provider freshness/health
GET  /api/admin/coverage               observed coverage and completeness
```

The frontend consumes a single typed module (`apps/web/src/lib/api/types.ts`). Run
`make check-api-contract` after API schema changes; if the first run updates stale artifacts, rerun
it to verify freshness before committing.

---

## Testing

| Suite | Runner | Covers |
| --- | --- | --- |
| Python/domain | pytest | ratings, market, API, adapters, real-schema aggregation, provenance, eligibility, covered minutes, reports |
| Frontend | Vitest | formatters + component rendering, including honest missing/low-confidence states |
| E2E | Playwright | search → card → audit → leaderboard → compare → methodology |
| PostgreSQL smoke | pytest + service DB | migrations → sample ingest → recompute → readiness → API read |

```bash
make test          # pytest + vitest
make e2e           # seeds, builds web, runs the Playwright flow against `next start`
```

The E2E runs against the **production build** (`next start`), not the dev server, so it is
deterministic and fixture-backed. By default it creates a disposable SQLite database and uses API
port `18080` plus web port `13080`, so it can run while `make dev` remains active on `8000`/`3000`
without touching the development database. Override the ports with `SCOUTBOY_E2E_API_PORT` and
`SCOUTBOY_E2E_WEB_PORT`. Existing servers are never reused unless
`SCOUTBOY_E2E_REUSE_EXISTING_SERVER=1` is deliberately set.

The web container uses Next.js standalone output: its final stage contains traced production
runtime files and static assets, not the workspace's development dependency tree. Local and CI E2E
continue to use a normal production build with literal `next start`.

CI runs the PostgreSQL path on a genuine PostgreSQL service; its smoke test asserts the configured
SQLAlchemy dialect is PostgreSQL before checking migrations, ingestion/recomputation output,
readiness, and a player API read.

Pull requests also run Ruff, Black, a 90% Python coverage floor, frontend lint/typecheck/build,
contract freshness, Gitleaks, Python dependency auditing, production JavaScript dependency
auditing, and a full-stack container smoke. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Extending

- **Add a data source:** implement `SourceAdapter.fetch()` → `IngestBundle`, register in
  `packages/data_pipeline/adapters/__init__.py`, declare `ProviderCapabilities`, and add shared
  conformance/lifecycle tests. See
  [`docs/data_sources.md`](docs/data_sources.md).
- **Add a role:** drop a YAML in `configs/roles/` (weights sum ~1.0, metrics from the registry),
  then `make recompute-ratings`. Auto-loaded, scored, ranked, and exposed — no code change.
- **Change role weights:** edit the YAML and recompute; the config hash changes so runs stay
  distinguishable. See [`docs/rating_methodology.md`](docs/rating_methodology.md).
- **Add a metric:** register it in `packages/shared/python/scoutboy_shared/metrics.py`, provide it
  via an adapter, then reference it in role/playstyle configs.

---

## Known limitations

- The real pilot is only 34 StatsBomb matches centered on Bayer Leverkusen. It must not be
  described as complete Bundesliga or European coverage.
- Cross-team percentile pools are consequently uneven; covered minutes and confidence are
  shown separately from full-season Transfermarkt minutes.
- Opposition quality is a league-strength proxy; role usage is nominal (no positional-split data).
- Market values are **ranges** from a transparent rule-based model — never exact figures.
- Search/leaderboard read models are computed in-process (fine for the prototype; precompute/index
  when scaling, per the plan's performance note).
- There is no end-user authentication or public rate limiting. Admin routes use a shared token;
  it is optional only in development/test and mandatory in production mode.
- The containers and CI make delivery reproducible, but this remains a production-shaped portfolio
  project without a chosen deployment host, monitoring vendor, uptime target, or commercial SLA.

## Repo layout

See [`docs/agent_notes.md`](docs/agent_notes.md) for the full structure and rationale;
`docs/rating_methodology.md` and `docs/methodology/playstyles.md` document the models.
Operational guidance lives under [`docs/runbooks/`](docs/runbooks/), and engineering decisions are
recorded under [`docs/adr/`](docs/adr/).
