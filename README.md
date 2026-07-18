# ScoutBoy

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
- **DB:** **SQLite by default** (zero-setup local dev); Postgres fully supported via `DATABASE_URL`
  + `docker compose up -d db`. *(SQLite default is a documented deviation — the build host had no
  Docker/Postgres; SQLAlchemy/Alembic keep everything DB-agnostic.)*

---

## Quickstart

Prereqs: Python 3.9+ and Node ≥18 with `corepack` (for pnpm). No Docker required.

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
| `make dev` / `dev-api` / `dev-web` | Run the stack / API only / web only |
| `make test` | Backend (pytest) + frontend (Vitest) |
| `make e2e` | Seed + build web + Playwright main-flow E2E (self-contained, runs against the production build) |
| `make lint` / `make format` | Ruff+Black+ESLint / auto-format Python |
| `make openapi` | Export OpenAPI to `docs/api_contracts/openapi.json` |

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
POST /api/admin/ingest                 (local admin) trigger ingestion
POST /api/admin/recompute-ratings      (local admin) trigger recompute
GET  /api/admin/rating-runs            run history
```

The frontend consumes a single typed module (`apps/web/src/lib/api/types.ts`); regenerate raw
OpenAPI types with `pnpm --filter @scoutboy/web gen:api`.

---

## Testing

| Suite | Runner | Covers |
| --- | --- | --- |
| Python/domain (99) | pytest | ratings, market, API, adapters, real-schema aggregation, provenance, eligibility, covered minutes, reports |
| Frontend (11) | Vitest | formatters + component render incl. honest missing/low-confidence states |
| E2E (1) | Playwright | search → card → audit → leaderboard → compare → methodology |

```bash
make test          # pytest + vitest
make e2e           # seeds, builds web, runs the Playwright flow against `next start`
```

The E2E runs against the **production build** (`next start`), not the dev server, so it's
deterministic (no per-request compilation). The **Postgres path is verified end-to-end**
(Alembic migration + ingest + recompute + API) and produces results identical to SQLite.

---

## Extending

- **Add a data source:** implement `SourceAdapter.fetch()` → `IngestBundle`, register in
  `packages/data_pipeline/adapters/__init__.py`, add mapping tests. See
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
- No auth beyond an optional local admin token (`SCOUTBOY_ADMIN_TOKEN`).

## Repo layout

See [`docs/agent_notes.md`](docs/agent_notes.md) for the full structure and rationale;
`docs/rating_methodology.md` and `docs/methodology/playstyles.md` document the models.
