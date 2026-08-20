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

1. **Search / browse** player profiles. The Discovery rail exposes **every filter
   `/api/players` accepts**, behind progressive disclosure so the default view stays
   short: five always-visible core controls (search, age threshold, position group,
   role, sort) plus an **Advanced Filters** disclosure holding three compact
   categories — Context (league, club, nationality), Evidence & Fit (minimum minutes,
   minimum/maximum RoleFit, playstyle) and Market (minimum/maximum expected asking). A
   compact active-criteria area names what is narrowing, removes any one criterion, and
   offers a complete reset. Every control is URL-backed. See
   [Discover filters](#discover-filters).
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

Open http://localhost:3000. Discover shows **Analyzed** players across all ages; the rail has no
scope selector, and the broader `all_records` / `high_coverage_u23` pools remain reachable as API
parameters rather than as a control (see [Discover scopes](#discover-scopes)).
Search → narrow with the rail → open a card → expand "why these scores" → view a leaderboard →
compare two players → read the methodology page.

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

Discovery no longer exposes a scope selector: the rail always requests the default
`analyzed` scope. `scope` remains a supported API parameter, so existing links keep
working.

- **Analyzed** (default): players with at least one RoleFit rating for the selected/current
  season.
- **All records**: every player with a usable season appearance/profile record. This includes
  defenders, goalkeepers, unrated players, and limited-coverage records.
- **High-coverage U23**: the unchanged materialized `mvp_u23_att_mid_eu` universe: U23 attackers
  and midfielders meeting ScoutBoy's minimum performance-coverage threshold.

Age is a season-relative threshold on five stops (19, 22, 25, 28, 31) plus a direction:
`age_max=<stop>` for "and younger", `age_min=<stop>` for "and older", neither for All Ages.
The legacy `age_band` parameter is still accepted and is normalized into those bounds; see
[docs/discover_scope_change.md](docs/discover_scope_change.md). Unknown ages appear only when
no age bound is active. Defender and goalkeeper records can be discovered, but ScoutBoy does
not currently model defender or goalkeeper RoleFit ratings.

### Discover filters

**RoleFit is role-specific.** It is never a universal player overall, and the frontend only ever
displays stored backend ratings.

#### The exposed control matrix

Since Phase 8.2 every parameter below has a production control. Nothing is filtered in the
browser: one request carries every predicate and the ledger renders exactly the rows it returns.

| Control | Parameter | Where | Semantics |
| --- | --- | --- | --- |
| Search | `q` | core | case-insensitive substring across name, club, league, primary position |
| Age Threshold | `age_min` **or** `age_max` | core | five-stop one-sided threshold (see [Discover scopes](#discover-scopes)) |
| Position Group | `position_group` | core | `ATT` / `MID` / `DEF` / `GK` |
| Role | `role` | core | selected-role context |
| Sort | `sort` | core | six representable modes; **not** a narrowing criterion, and the only thing that decides order |
| League | `league` | Advanced → Context | case-insensitive substring over slug, name **and country** |
| Club | `club` | Advanced → Context | case-insensitive substring, plus a deterministic alias table |
| Nationality | `nationality` | Advanced → Context | case-insensitive **substring** |
| Minimum Minutes | `min_minutes` | Advanced → Evidence & Fit | whole-season minutes, 0-10,000 |
| Minimum RoleFit | `rolefit_min` | Advanced → Evidence & Fit | 0-99, applicable role context |
| Maximum RoleFit | `rolefit_max` | Advanced → Evidence & Fit | 0-99, applicable role context |
| Playstyle | `playstyle` | Advanced → Evidence & Fit | a qualifying **positive** badge, never a concern |
| Minimum Expected Asking | `value_min` | Advanced → Market | absolute EUR; **typed in EUR millions** |
| Maximum Expected Asking | `value_max` | Advanced → Market | absolute EUR; **typed in EUR millions** |

All active filters compose with **AND**, and every free-text predicate is trimmed of outer
whitespace on the way to the URL (internal spacing is never touched, so `Paris Saint-Germain`
works).

**Context search is forgiving but deterministic.** Nationality is a substring, so `Eng` finds
England. League searches the competition's slug, name **and stored country**, so `England`,
`eng` and `Premier League` all work — as do `Portugal`/`por`, `Italy`/`ita`, `Spain`/`esp`,
`Germany`/`ger` and `France`/`fra`. Club understands common abbreviations and nicknames from a
versioned registry (`configs/discovery/search_aliases_v1.yaml`): `psg`, `P.S.G.` and `Paris SG`
all resolve to Paris Saint-Germain, `spurs` and `thfc` to Tottenham, and an ambiguous
abbreviation such as `fcb` returns **every** club it defensibly names rather than silently
picking one. Exact whole-input club aliases work in the main search box too (`q=psg`).

**There is no fuzzy matching.** No edit distance, no phonetic key, no scoring. An input either
normalizes to a key in the registry or it falls straight through to the ordinary substring
search; `portgual` is one curated misspelling, and `portugual` is simply not found. The alias
layer is a cached configuration read that issues **zero** SQL and compiles into the same
`WHERE` clause, so the documented four-statement request shape is unchanged.

The asking-price inputs are the one place with two units: `12.5` in the rail is
`value_max=12500000` in the URL and the request. They are text fields with a decimal keypad, so
typing `12.5` one key at a time works — a plain number input sanitized the intermediate `12.`
away. Blank is no bound, `0` is a real bound, and a negative, non-finite or malformed value is
held on screen and never sent. Copy says "Expected Asking", never an exact transfer value, and
**no midpoint of the two bounds is ever computed or shown**.

**Missing data fails an active predicate; it never passes as zero.** A player with no
expected-asking endpoint is excluded by an active asking bound, an unrated player is excluded
by a RoleFit bound, and an unknown age is excluded by any active age bound.

Both inclusive pairs are kept coherent by one rule — **the edited bound wins and its companion
follows** — so `min > max` never reaches the API; a hard-loaded inverted pair treats the
minimum as authoritative.

**Analysis Scope remains intentionally absent** (retired in Phase 8.1A). It is not a control,
not reported in the ledger header, and not offered in the active-criteria list; a
scope-bearing URL is still honoured and Clear All drops it. **Confidence, evidence state and
concern filtering remain unsupported** — the search contract has no predicate for them and
none was invented in the browser.

#### Progressive disclosure and the active-criteria area

The rail is one bordered panel with internal hairlines: header, active criteria, core
controls, Advanced Filters. Only one advanced category is expanded at a time, closing a
category never clears its values, and the disclosure state is local rather than URL state
(a shared link describes a cohort, not an open drawer) — but a hard-loaded URL carrying an
advanced filter opens the disclosure onto the category it is using.

The active-criteria area is absent when nothing narrows. Collapsed it shows the count, the
first two criteria and "+N more"; expanded it lists each criterion as a flat rectangular row
with its own named remove action. Removing one clears only its own parameters and resets to
page 1; **Clear All** returns the clean root URL (default analyzed scope, default sort, page
1, page size 12) and drops legacy `scope` / `universe` / `age_band`, without touching
favourites or the compare queue. The ledger header reports the total, the number of active
criteria when nonzero, the season and the page — it counts them, it does not list them.

See [docs/milestone_8_discovery_contract.md](docs/milestone_8_discovery_contract.md) for the
full Phase 8.2 record.

#### Selected-role results

With no `role` filter, a result's role context is the player's own stored **best role**. With
`role=<key>`, the context becomes that role's **stored** rating, and one rating does all four
jobs — qualifying, bounding, ordering and display:

- only players with a stored rating for that role qualify at all;
- `rolefit_min` / `rolefit_max` apply to the selected role's score;
- `sort=rolefit_desc|rolefit_asc` orders by it, breaking ties on **its** confidence;
- the row displays that role, its score and its confidence.

The response reports both contexts separately and never conflates them:

| Field | Meaning |
| --- | --- |
| `best_role`, `best_role_display`, `best_role_score`, `best_role_confidence` | the player's own highest stored rating, whatever was filtered |
| `result_role`, `result_role_display`, `result_role_score`, `result_role_confidence` | the stored rating that filtered and ordered **this** result |
| `result_role_source` | `best_role` or `selected_role` |
| `confidence` | the applicable role context's confidence (equal to `result_role_confidence`) |

Nothing is recomputed and no `best_*` field is ever reused to carry a non-best role. Unrated
players keep `null` scores; a missing score is never a zero.

#### Minutes and RoleFit are separate domains

| Filter | Range | Notes |
| --- | --- | --- |
| `min_minutes` | whole minutes, **0-10,000** inclusive | Supports realistic thresholds (450, 900, 1,500, 2,000). Omit for no threshold; `0` is a real accepted value, not "unset". 10,000 is a documented technical safety ceiling (`MINUTES_FILTER_MAX`), not a football limit, and stored or displayed minutes are never capped by it. |
| `rolefit_min` / `rolefit_max` | **0-99** inclusive | The authoritative RoleFit scale (`DISPLAY_SCALE_MIN`/`MAX`). |

The two ceilings are separate constants on both sides of the wire. Out-of-range values are a
`422` rather than a silently narrowed result set, and the frontend clamps typed, pasted and
URL-supplied values through the parser for the matching domain.

#### Sort modes

Accepted: `rolefit_desc` (default), `rolefit_asc`, `age_asc`, `age_desc`, `value_desc`,
`value_asc`, `name_asc`. An unknown value is a `422`, never a silent fallback. `age_desc` is
**API-only** — the Sort control has no option for it, so a URL carrying it falls back to the
default rather than leaving the visible control disagreeing with the request.

Every mode ends with explicit `canonical_name` then `player_id` tie-breaks, and no missing value
is turned into a meaningful zero:

- the asking-price modes order by `expected_asking_low_eur`, the lowest plausible expected ask.
  No midpoint or composite market score is invented from the range. Players whose lower bound is
  unknown sort **after every known value in both directions**, and are never shown as €0;
- unrated players sort after rated ones in either RoleFit direction, wherever the selected scope
  admits them.

The `value_min` / `value_max` predicates are absolute EUR and require the endpoint they
depend on to be **known**: `value_min` needs an expected-asking high at or above it, `value_max`
needs an expected-asking low at or below it, and an active range needs both plus an overlap.
Missing market information fails an active predicate instead of passing as zero. `value_min`
above `value_max` is rejected by the API and can never be produced by the rail.

#### Pagination

`page` is a 1-based integer; `page_size` is 1-100. Any filter or sort change resets Discovery to
page 1. A valid request for a page past the end returns the **last available page** and reports
the page it served, which the browser URL is then synchronized to — an out-of-range page never
masquerades as "no players match these filters". A genuinely empty result is page 1.

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

## Discovery contract correctness (Milestone 8, Phase 8.1A)

A bounded correctness phase over the existing Discovery surface: no redesign, no new controls. It
makes the contract internally truthful — the role, score and confidence a result displays are the
same stored role rating that filtered and ordered it — and separates the minutes filter from the
RoleFit scale, makes asking-price ordering missing-safe, validates the sort / position-group / role
enumerations, and canonicalizes out-of-range pagination. The semantics are documented under
[Discover filters](#discover-filters); the audited causes are recorded in
[docs/milestone_8_discovery_contract.md](docs/milestone_8_discovery_contract.md).

## Database-side Discovery queries (Milestone 8, Phase 8.1B)

A behaviour-preserving query rewrite over the same surface: the contract, the API and the UI are
unchanged. Discovery used to load every player-season of the current season into Python, filter and
sort the list, then slice a page out of it. The database now selects the qualifying rows, resolves
the one stored role rating each row is judged by, applies every predicate, applies the approved
ordering and tie-breaks, counts the distinct qualifying players and returns only the requested
page; card enrichment is a single bulk query for that page's ids.

A request costs a constant **four** SQL statements — season, count, page, page playstyles — and two
for an empty result, whether the cohort holds 24 players or 5,000. Equivalence with the previous
implementation is held by a 511-case differential matrix against a transcription of the old
in-Python code, and by a control run in which the pre-change and post-change APIs, served from the
same database, returned byte-identical JSON for 448 request variants. Missing values keep explicit
"known first" ordering rather than relying on the database's default NULL placement, age bounds
become birth-date boundaries derived in Python so no dialect-specific date arithmetic reaches a
predicate, and the name tie-break is collated to code-point order so SQLite and PostgreSQL agree.

Case-insensitive matching and the name ordering key keep Python's `str.lower()` semantics, which
neither database's own `lower()` provides — SQLite's is ASCII-only and PostgreSQL's follows the
database's `LC_CTYPE`. Discovery therefore lowercases explicitly: a deterministic `str.lower()`
connection function on SQLite, and PostgreSQL 16's ICU root collation on PostgreSQL. Both apply
Unicode full case mapping, so accented, dotted-`İ`, sharp-`ẞ`, Kelvin-sign and Greek final-sigma
names match and sort as they always did, and `%`, `_` and the escape character in a search stay
literal.

One body of parity assertions runs on both databases, and the PostgreSQL run is what caught an
untyped-NULL defect SQLite had tolerated. Four `(season_id, player_id)` composite indexes were
added with a migration, justified by recorded query plans. Details, evidence and limitations —
including the measured, name-irrelevant residual between ICU's Unicode tables and CPython's — are
in [docs/milestone_8_discovery_contract.md](docs/milestone_8_discovery_contract.md).

## Advanced Discovery interface (Milestone 8, Phase 8.2)

The interface work stays over the Phase 8.1 database-backed query contract, while its
corrective pass makes three bounded search-semantics changes: partial nationality,
league-country matching and deterministic club aliases. There is no scoring change or
migration. `docs/api_contracts/openapi.json` and the generated TypeScript schema are current
and regenerate byte-identically from the final implementation.

The rail used to expose six filter groups. `league` and `playstyle` could only be supplied by
URL; `club`, `nationality`, `rolefit_max`, `value_min` and `value_max` only by hand-writing an
API request. All seven now have production controls — and the **default rail is shorter than
the one it replaces**, because the two existing specialized thresholds moved behind the same
disclosure. Five core controls stay visible (search, age threshold, position group, role,
sort); everything else lives in **Advanced Filters** over three compact categories, one open
at a time, with per-category active counts that keep reporting while a category is shut.

A compact active-criteria area sits under the filter header: collapsed, the count plus the
first two criteria and "+N more"; expanded, one flat rectangular row per criterion with its
own named remove action, beside a permanent Clear All. Removing one criterion clears only its
own parameters and resets to page 1; Clear All produces the clean root URL and drops legacy
scope parameters without touching favourites or the compare queue. Focus never lands on
`<body>` after either. The ledger header counts active criteria instead of listing them.

Everything is URL-backed and replace-style, so hard load, reload, back/forward and shared
links all reproduce the same request, the same controls and the same ledger. The asking-price
inputs are EUR millions over an absolute-EUR contract and accept sequentially typed decimals;
`min > max` can never be sent, by one documented rule; the Playstyle options come from the
Methodology contract rather than a hand-written list. The Context filters search the way a
scout types — partial nationality, league by country or code, club by abbreviation — through a
versioned alias registry rather than fuzzy matching, at no extra SQL cost. No new rounded
geometry, no nested rail scroller, no animated layout property, and axe is clean with every
disclosure open — including at 320px and at 200% desktop zoom. See
[docs/milestone_8_discovery_contract.md](docs/milestone_8_discovery_contract.md) for the
control matrix, the units, the range rule, the alias registry and the recorded evidence.

## Deterministic ranking explanation (Milestone 8, Phase 8.3)

*Implemented and supervisory-audited.*

Discovery already retrieved, filtered, ordered, counted and paged deterministically. Phase 8.3
makes it state **which ordering it applied**, using the real backend ordering rules. No scoring
model, calibration or ranking behaviour changed, and there is no new composite score, no
recommendation and no suitability label.

The ledger gained one compact, collapsed-by-default **Why this order** disclosure, between its
count header and the first result — not in the filter rail, which narrows the cohort rather
than explaining rank, and not per row. Opened, it states the active sort ("Ordered by RoleFit,
highest first."), the exact ordered key sequence the database applied with one sentence of rule
each, which role context each result's RoleFit is read from, how unknown values are placed, the
final tie-breakers, and the limitation that this describes ordering rather than recruitment
suitability.

It is deliberately **page-level**: it explains the ordering, not individual players, and it
compares no two results. So it stays a few short rows tall whatever the page size, and reads
identically on every page of the same query.

**One sort specification drives both the SQL and the explanation.** The ordering used to exist
only as `ORDER BY` fragments; a parallel description map beside them would have been free to
drift, and a stale ranking explanation is worse than none. The key sequence is now declared once
in `apps/api/app/repositories/discovery_sort.py`, and each key carries its `ORDER BY` element
and its identity, label, direction and rule together. Tests hold it structurally, including one
that removes a key from a specification and asserts that **both** the compiled SQL and the
reported sequence lose an entry, and one that differences every mode's whole served order
against an independent transcription of the written contract.

Unknown-versus-known placement is stated explicitly per mode, Expected Asking always says it
uses the lower endpoint (never the high one, never a midpoint), and confidence is described as
what it is: a tie-break that speaks only after an equal score, and only in the RoleFit modes.
The role context distinguishes the two things it is easy to conflate — which stored rating every
result *displays*, and whether that rating also *ordered* the page. Under Age, Expected Asking
and Name it says plainly that RoleFit did not order the page and names the sort that did. Every
sentence is a fixed template over the specification — nothing is generated and no external
service is involved.

The request still costs **four SQL statements**, unchanged. The explanation reads no rows and
issues no query of its own; it is built from the active sort and role alone.
`GET /api/players` now returns `DiscoverySearchResponse`: the five pagination fields unchanged,
plus `ranking`. See
[docs/milestone_8_discovery_contract.md](docs/milestone_8_discovery_contract.md) for the full
key sequences, the copy contract, the evidence and the limitations.

---

## Optional accounts and durable favorites (Milestone 8, Phase 8.4A)

**Accounts are optional twice over: optional for a visitor, and optional for a
deployment.** With no Clerk configuration present, ScoutBoy is exactly the
anonymous application it has always been - no provider is mounted, no session
request is made, no account UI is rendered, and My Favorites lives in browser
storage under `scoutboy.shortlist.v1`. Everything below is additive.

Signing in changes one thing: where the favourites list is stored.

- **No account** - `My Favorites N · saved on this device`
- **Signed in** - `My Favorites N · saved to your account`

Discovery, dossiers, leaderboards, Compare and Methodology stay public in both
modes. There is no authentication wall, forced redirect, blocking modal, or
disabled feature. The comparison queue is unchanged and stays device local.

This phase deliberately supersedes the earlier roadmap constraint that Milestone
8.4 remain device-local; the change was product direction, and the reasoning is
recorded in the milestone document.

**Identity is Clerk's, storage is ours.** ScoutBoy implements no passwords, no
sessions, no resets and no email delivery, and it stores nothing about a person
beyond an opaque external subject and the issuer that vouched for it - no email,
name, avatar or provider token. Private `/api/me/*` requests are authorized from
a token whose signature, `exp`, `nbf`, `iss` and `azp` are verified on every
call; the subject is taken from the token and from nowhere else.

Enable it by setting a Clerk publishable key for the frontend and the issuer plus
authorized parties for the backend (see `.env.example`). Enabling auth with
incomplete configuration fails loudly at start-up rather than serving a verifier
that is not anchored to a tenant.

Full contract, database model, merge semantics, state machine, privacy boundary,
provider-owned surfaces and limitations:
[`docs/milestone_8_4a_optional_accounts.md`](docs/milestone_8_4a_optional_accounts.md).

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
GET  /api/players                      search (filters, pagination, deterministic sort,
                                       plus `ranking`: why this page is in this order)
GET  /api/players/{id}                 full player card
GET  /api/players/{id}/ratings         RoleFit ratings + audit breakdowns
GET  /api/players/{id}/playstyles      badges + concerns with why_applied
GET  /api/players/{id}/market          public / model / asking, label, confidence
GET  /api/players/{id}/similar         style / quality / cheaper / higher-upside comps
GET  /api/roles/{role_key}/rankings    role leaderboard
GET  /api/compare                      side-by-side + why one rates higher
GET  /api/methodology                  methodology metadata for the UI
GET  /api/me/favorites                 (account) canonical ordered My Favorites
PUT  /api/me/favorites/{player_id}     (account) idempotent add
DEL  /api/me/favorites/{player_id}     (account) idempotent remove
POST /api/me/favorites/merge           (account) union a guest list into the account
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

`GET /api/players` responds with `DiscoverySearchResponse`: the five pagination fields
(`items`, `total`, `page`, `page_size`, `total_pages`) exactly as before, plus `ranking` — the
active sort's ordered key sequence, the role context, unknown-value placement, the final
tie-breakers, and an explicit statement that this describes ordering rather than recruitment
suitability. It is page-level: it names no player and compares no two results. It is derived
from the same sort specification that builds the query's own `ORDER BY`, costs no extra
statement, and contains no generated prose.

The frontend consumes a single typed module (`apps/web/src/lib/api/types.ts`). Run
`make check-api-contract` after API schema changes; if the first run updates stale artifacts, rerun
it to verify freshness before committing.

---

## Testing

| Suite | Runner | Covers |
| --- | --- | --- |
| Python/domain | pytest | ratings, market, API, adapters, real-schema aggregation, provenance, eligibility, covered minutes, reports |
| Frontend | Vitest | formatters + component rendering, including honest missing/low-confidence states |
| E2E | Playwright | search → card → audit → leaderboard → compare → methodology, plus the Discovery ranking explanation |
| Cross-browser | Playwright (Chromium/Firefox/WebKit) | the mandatory flows on all three engines |
| PostgreSQL smoke | pytest + service DB | migrations → sample ingest → recompute → readiness → API read, plus the full Discovery parity body |

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
- Discovery search runs its candidate selection, predicates, ordering, counting and pagination in
  the database (Phase 8.1B), so a request costs a constant four statements and reads only the page
  it serves. The leaderboard, comparison and dossier-similarity read models are still computed
  in-process; similarity in particular needs the whole position-group cohort in memory. The volume
  evidence for Discovery is a deterministic 5,000-record SQLite fixture, which is not a production
  capacity claim.
- The Discovery ranking explanation (Phase 8.3) describes **ordering only** — which stored values
  the database sorted by, in what order, and how it places the ones it does not know. It is not a
  recommendation, a suitability judgement or a rating of any kind, and it says so on screen. It is
  page-level by design: it does not explain why one particular player sits above another, which a
  scout reads off the sorted column itself. It also does not explain how a RoleFit score was
  *produced*: that remains the dossier's job, and the rating audit groups were deliberately left
  out of Discovery rather than duplicated there. The ties the committed 24-player sample cannot
  produce (equal scores, unrated players, unknown values, colliding names) are proven in the
  backend against a synthetic cohort built to contain a tie at every level.
- End-user accounts are OPTIONAL and off by default (Phase 8.4A). When enabled, Clerk owns
  identity and ScoutBoy verifies the token's signature, expiry, issuer and authorized party on
  every private `/api/me/*` request; account isolation is enforced structurally, since no request
  can name a user. The account behaviour has been verified only against deterministic offline
  tests: **no live Clerk tenant was available**, so no real sign-up, sign-in, sign-out or
  cross-device persistence has been exercised. Clerk's own hosted pages (its Account Portal, any
  provider-hosted OAuth or verification step, its CAPTCHA widget) are provider-owned and cannot be
  themed to ScoutBoy's design system.
- There is still no public rate limiting, audit logging, or CSP, and Phase 8.4A is deliberately
  **not** the Milestone 9 security audit. Admin routes use a shared token; it is optional only in
  development/test and mandatory in production mode.
- The containers and CI make delivery reproducible, but this remains a production-shaped portfolio
  project without a chosen deployment host, monitoring vendor, uptime target, or commercial SLA.

## Repo layout

See [`docs/agent_notes.md`](docs/agent_notes.md) for the full structure and rationale;
`docs/rating_methodology.md` and `docs/methodology/playstyles.md` document the models.
Operational guidance lives under [`docs/runbooks/`](docs/runbooks/), and engineering decisions are
recorded under [`docs/adr/`](docs/adr/).
