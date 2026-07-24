# ScoutBoy — Agent Implementation Notes

> Product source of truth: `RoleFit_Scout_Project_Plan.md` (project renamed **RoleFit Scout → ScoutBoy** everywhere).
> This file records the assumptions, decisions, and intentional out-of-scope calls made while building the **initial MVP only**.

## 1. What this MVP is

A locally-runnable, FUT.gg-style **player discovery** prototype for **U23 attackers and midfielders in Europe**. It converts messy football data into explainable scouting cards.

A user can:
1. Browse/search U23 attackers & midfielders.
2. Open a player card (face stats, substats, role-specific RoleFit ratings, playstyle badges, market value / asking-price range, strengths, concerns, context).
3. View role leaderboards.
4. Compare two players.
5. Understand **why** a score/badge/value exists via audit/explanation data.

## 2. In scope (built now)

- Positions: `ST, CF, LW, RW, AM/CAM, CM, DM` (attackers + midfielders only).
- Age: U23 (≤23 in the selected season).
- Geography: European leagues only.
- Min minutes threshold: **configurable, default 450** (`SCOUTBOY_MIN_MINUTES`).
- Pages: Home/search, Player card, Role leaderboard, Compare, Methodology.
- Models: RoleFit Rating v1, Playstyles v1, Market value / expected asking price v1, Similarity v1.
- Admin/maintenance: local ingestion command, local recompute command, data-quality report, rating-run metadata.

## 3. Explicitly OUT of scope (NOT built)

- LLM / scouting **assistant layer** (US-8) — deferred by instruction.
- Authentication / user accounts / watchlists / community features.
- Fullbacks, center-backs, goalkeepers.
- Paid data-provider integrations (StatsBomb commercial, Opta, Wyscout, SkillCorner). Adapter architecture is left ready.
- Live scraping of FBref / Understat / Transfermarkt public pages (adapters stubbed for later, gated behind explicit approval).
- Pixel-perfect / heavily polished UI. Styling is intentionally minimal but structured.
- Black-box ML market model — MVP uses a transparent rule-based model.

## 4. Environment-driven deviations from the plan (with justification)

The plan lists a preferred stack. The build machine had constraints that forced a few pragmatic, **documented** deviations. All are reversible and do not change the architecture.

| Plan preference | What we did | Why |
| --- | --- | --- |
| PostgreSQL (+ Docker Compose) | **SQLite default** for local dev/tests; Postgres fully supported via `DATABASE_URL`. Docker Compose config still provided. | No Docker/Postgres on the build host. SQLAlchemy 2.0 ORM + Alembic are DB-agnostic; nothing is Postgres-specific except optional JSONB (we use portable JSON). `make dev`, `make seed`, `make recompute-ratings`, and all tests run with zero external services. Set `DATABASE_URL=postgresql+psycopg://...` and run `docker compose up -d db` to use Postgres. |
| Python 3.11+ | Code written to run on **Python 3.9+** (with `from __future__ import annotations`), 3.11+ recommended. | Only Python 3.9 was available. No 3.10/3.11-only syntax is used at runtime. |
| DuckDB / polars for analytics | **Optional**. Core sample + CSV path uses stdlib `csv`/`json` + `pandas`. Transfermarkt DuckDB adapter uses `duckdb` only if installed. | Keeps the mandatory install light and the DoD path runnable offline. Heavy analytical deps are lazy-imported. |
| pnpm workspace | pnpm enabled via **corepack**. | pnpm not pre-installed; corepack ships with Node 24. |

## 5. Architecture (ports & adapters + layered backend)

```
apps/web (Next.js)  ──HTTP──▶  apps/api (FastAPI)
                                   │ routes → services → repositories → DB
                                   │ services → domain packages
                                   ▼
        packages/rating_engine · packages/market_model · packages/data_pipeline · packages/shared
```

Hard rules enforced in code review:
- **No rating/market logic in API route handlers.** Routes call services; services call repos + domain packages.
- **No ingestion logic in frontend or API routes.** Pipeline lives in `packages/data_pipeline`.
- **No authoritative scoring in the frontend.** The web app only *displays* stored backend outputs.
- **Config-driven scoring.** Role weights (`configs/roles/*.yaml`), playstyle thresholds (`configs/playstyles/*.yaml`), and context multipliers (`configs/context/*.yaml`) are never hard-coded into UI or routes.
- **Explainability-first.** Every score has an audit record; every badge has `why_applied`; every value has confidence + explanation. Missing data → `unknown` / low-confidence, **never zero**.
- **Deterministic outputs.** Search, leaderboard, and compare sorts have explicit tie-breaks (final score desc → confidence desc → canonical_name asc → player id asc).
- **Versioned rating runs.** Every run stores version, timestamp, status, input snapshot ids, config hashes, affected player count. Every RoleFit score links to a `rating_audits` row.

## 6. Import / module layout decision

Python packages are importable by top-level name with these paths on `PYTHONPATH` (set by the Makefile and `pytest` config):

```
packages                    → data_pipeline, market_model
packages/rating_engine      → rolefit
packages/shared/python      → scoutboy_shared
apps/api                    → app
```

- Cross-package imports use top-level names (`from rolefit import ...`, `import market_model`).
- Within a package, imports are **relative**.
- The plan documents pipeline commands as `python -m packages.data_pipeline.jobs.ingest`. The runnable equivalent in this repo is `python -m data_pipeline.jobs.ingest` (with the venv + `PYTHONPATH` the Makefile sets). Both forms are noted in the README.

## 7. Rating formula (v1) — as implemented

```
final = role_weighted_performance_score
        × league_strength_adjustment
        × team_strength_adjustment
        × opposition_quality_adjustment
        × competition_stakes_adjustment
        × role_usage_adjustment
        × sample_reliability_adjustment
        + recent_form_or_peak_bonus
        − risk_penalties
```

- `role_weighted_performance_score` ∈ base 0–100, from weighted percentile of role metric groups.
- Each context multiplier defaults to `1.0` and is clamped to a documented band (see `configs/context/*.yaml`).
- Output is clamped to the **0–99.9** display scale.
- Missing required metrics lower **confidence** and are listed in the audit; they do not silently zero the score.

## 8. Testing posture

Backend / rating / playstyle / market / frontend-util tests all run offline. The Playwright E2E requires both dev servers; it is wired and documented but assumes a running stack (`make dev`). See README "Definition of Done" checklist.

## 9. Branding / legal guardrails honored

- Original name **ScoutBoy**, original UI, original rating/playstyle names. No FUT.gg branding/assets. No EA SPORTS FC trademarks in naming.
- No live scraping in the MVP. Any pre-scraped data must be labeled with its source and stored as a snapshot.
- Sample/mock data is synthetic and clearly labeled as such (`data/sample/`).

---

# Milestone 2 — Real Data v0 (implementation plan)

**Goal:** move from synthetic-only to a real, reproducible ingestion pipeline for real
U23 European attackers/midfielders using a Transfermarkt-style identity/market dataset
+ a strict performance-metrics CSV contract. No app redesign, no new product features.

## Decisions

1. **Canonical metric registry (`configs/metrics/canonical_metrics_v1.yaml`) is the single
   source of truth.** `scoutboy_shared.metrics` now loads it. Milestone canonical names are
   primary (e.g. `non_penalty_goals_per90`); the previous internal names (`npg_per90`, …) are
   kept as **aliases** so any data using them still resolves. Role/playstyle configs + sample
   fixtures are renamed to canonical names. A test fails loudly if a role references a metric
   not in the registry (canonical or alias).
2. **Reuse the existing bundle/ingest architecture.** `IngestBundle` + `ingest_bundle()` are
   extended, not replaced. Metric-only bundles (performance CSV) resolve players via
   `player_source_ids` (source_name, source_player_id) and **quarantine** unmatched rows with
   a quality warning instead of crashing.
3. **Adapters registered:** `sample` (unchanged, synthetic), `transfermarkt` (CSV dir → full
   canonical bundle), `performance_csv` (long-format metrics CSV → metric-only bundle).
4. **Schema hardening via migration 0002:** dedupe constraint on `player_metrics_raw`
   (player, source, season, team, competition, metric, snapshot), unique
   `role_ratings(player_id, role_key, season_id, version)`, and a new
   `player_universe_memberships` table (materialized MVP universe, non-destructive).
5. **MVP universe** (`normalize/mvp_universe.py`) materialized during recompute; preserved as
   `scope=high_coverage_u23`. Discover now defaults to `scope=analyzed` (players with at least
   one RoleFit rating). Legacy `universe=mvp` maps to `high_coverage_u23`; `universe=all` maps to
   `all_records`.
6. **Context v0**: existing config-driven context is kept; league/stakes configs extended with
   the milestone's leagues/values; unknown → safe default.
7. **E2E stays on the `sample` seed** (deterministic, already green). The real-data path
   (transfermarkt + performance CSV → recompute → API) is proven by a dedicated pytest
   integration test, satisfying acceptance criteria without destabilizing the E2E.

## Vertical slice order
canonical registry + refactor (keep suite green) → migration 0002 → CanonicalMetric source
matching + quarantine → performance_csv adapter → transfermarkt adapter (CSV dir) → sample
fixtures (transfermarkt dir + performance CSV) → mvp_universe + API filter → data contract
files + docs → tests → full gates + E2E.

## Out of scope (unchanged): scraping, paid providers, assistant, accounts, defender/GK RoleFit
models, fabricated ratings for unrated players, and claims of live/current coverage.

## Milestone 2 — shipped
Canonical registry + Transfermarkt (CSV-dir) + performance-CSV adapters + source-id
join/quarantine + migration 0002 (dedupe/unique + `player_universe_memberships`) + MVP
universe materialization + data-quality report + full tests/docs. Real path
proven by `test_real_data_pipeline.py` (ingest → recompute → API). Sample E2E path unchanged.
Deferred to M3: aggregating raw per-match dcaribou appearances (games join), context
calibration, stronger identity resolution.

## Milestone 3 — shipped real vertical slice

The approved data choice is Transfermarkt/dcaribou plus StatsBomb Open Data. The immutable
Bundesliga 2023/24 StatsBomb snapshot contains 34 Bayer Leverkusen matches, so the product must
label it a **Leverkusen-centered vertical-slice pilot**, never full Bundesliga coverage.

Implemented: real dcaribou per-match aggregation; as-of valuation history; snapshot provenance;
StatsBomb event metrics; conservative identity bridge with reviewed overrides and quarantine;
covered-minute confidence and cohort gates; explicit role-position eligibility; role-eligible
percentiles; season-derived team strength tiers; cohort report; executable acceptance target.

The verified cohort is Wirtz, Boniface, and Hlozek. The next milestone is broader licensed/open
performance coverage and rating calibration, not more UI surface area.

## Milestone 6 — RoleFit Calibration & Model Evaluation (implementation plan)

Goal: make RoleFit outputs **measurable, reviewable, repeatable, and regression-protected**
without building a second scoring engine or claiming objective scouting truth.

### Design decisions
1. **Reuse production scoring end-to-end.** The evaluator calls `normalize_metrics`
   (data_pipeline) → `percentile_ranks` (rolefit) → `build_context` → `compute_role_rating`
   → `compute_playstyles` → `build_audit`. No formula is duplicated. This is exactly the
   recompute pipeline path, minus the database.
2. **Fixtures are raw per-90 metric values, not magical scores.** A benchmark declares a
   player's raw metrics + context. Percentiles emerge from a committed, deterministic
   **reference cohort** per position group (ATT/MID) the same way recompute percentiles a
   player against role-eligible peers. Role ordering, confidence, and playstyle/concern
   presence are therefore *earned from evidence*, not asserted as absolute numbers.
3. **Contract vs fixtures are separate files** (task §1/§2):
   - `configs/calibration/rolefit_calibration_v1.yaml` — versioned contract: suite metadata,
     benchmark expectations (primary role, role ordering, playstyles, concerns, confidence),
     context scenarios, `inconclusive_allowed`, evidence level, limitations.
   - `configs/calibration/fixtures_v1.yaml` — committed raw-metric fixtures: benchmark
     players + reference cohorts + context. Independent of DB / network.
   Loader cross-validates: every `fixture`-kind benchmark needs matching fixture data;
   every fixture player is referenced. Pilot benchmarks have no fixture (resolved from DB).
4. **Four-way status** — `pass` (expectation satisfied), `warn` (borderline / partial),
   `fail` (sufficient evidence contradicts expectation), `inconclusive` (evidence absent
   or insufficient). Inconclusive is never silently a pass or fail.
5. **Pilot mode is read-only + honest.** `database_evaluator.py` resolves real players by
   stable source id / provenance; if the DB, identity, role coverage, or required metrics
   are absent it returns `inconclusive` with a reason. CI never fails on missing pilot data.
   Reports always carry the Leverkusen-centered-slice caveat (never "full Bundesliga").
6. **Baseline, not tuning.** M6 establishes a baseline against the *current* configs. No
   role weights are changed unless the suite gives a defensible, documented, regression-
   tested reason. Config hashes are recorded in every result so drift is detectable.

### Package layout (task §3) — `packages/rating_engine/evaluation/`
`contract.py` (load+validate contract), `fixtures.py` (load fixtures, build populations,
score a benchmark reusing production modules), `evaluator.py` (per-benchmark + scenario
evaluation, suite totals, deterministic ordering), `database_evaluator.py` (read-only pilot),
`reporting.py` (byte-stable JSON + Markdown), `__main__.py` (CLI). Imports as `evaluation`
under the Makefile/pytest PYTHONPATH (`packages/rating_engine`). Tests live in
`packages/rating_engine/tests/` (already a testpath).

### Fixtures covered (task §2)
wide carrier→touchline_winger, goal-first wide→inside_forward, progressive press-resistant
mid→deep_lying_playmaker, two-way mid→advanced_8, defensive mid→ball_winning_midfielder,
low-minute/high-output (low/medium confidence), lower-league/high-production (translation
risk), stronger-league/lower-volume (stronger reliability), missing-required-metric
(low/inconclusive), playstyle+concern threshold boundary cases.

### Scenarios / guardrails (task §5)
league-strength ordering & bounded impact, team-strength & stakes effects, minutes
monotonicity, form-bonus confidence gating, required-metric coverage, confidence bounds,
playstyle tiers at base/plus/elite, concern trigger/non-trigger, deterministic tie-breaks.

### Operator commands (task §7)
`make calibration-evaluate-fixtures` (no DB writes, no network), `make calibration-evaluate-pilot`
(read-only), `make calibration-evaluate` (both). Deterministic JSON to stdout; optional
Markdown report. Generated reports are gitignored unless curated as baseline docs.

### Methodology surface (task §8)
Add a small `calibration` block to `MethodologyResponse` (+ `methodology_service`): suite
version, current summary/status counts, rating/config version, evidence-weighted note, and
the explicit real-pilot coverage limitation. Regenerate OpenAPI + `schema.gen.ts`.

### Build order
contract → fixtures + reference cohorts → fixture evaluator → reporting + CLI → tests →
pilot evaluator → methodology surface + contract regen → docs → full gates + byte-stable check.

## Milestone 6 — shipped RoleFit calibration & model evaluation

Versioned calibration contract (`configs/calibration/rolefit_calibration_v1.yaml`) + committed
deterministic synthetic fixtures (`configs/calibration/fixtures_v1.yaml`) + an evaluation package
(`packages/rating_engine/evaluation/`) that REUSES the production engine (normalize_metrics →
percentile_ranks → build_context → compute_role_rating → compute_playstyles). Distinguishes
pass/warn/fail/inconclusive. 9 fixture benchmarks (role order, playstyles, concerns, confidence,
translation risk) + 9 guardrail scenarios (league/team/stakes ordering bounded & non-erasing,
minutes→confidence monotonicity, form gating, confidence bounds, playstyle tiers, concern
boundary, deterministic ordering) — all pass on the UNCHANGED config. Baseline established; NO
weights tuned (`calibration_baseline.json` pins scores + config hashes; the regression test fails
on any config-hash change, so tuning is always deliberate).

Read-only pilot evaluation (`database_evaluator.py`) resolves real players via stable
`PlayerSourceId` provenance (never fuzzy names) and returns `inconclusive` — never fail — when the
DB/identity/ratings are absent or the schema mismatches. Pilot is always labelled the Leverkusen-
centered StatsBomb slice.

Operator commands: `make calibration-evaluate-fixtures|pilot|evaluate`. Fixture JSON is byte-
stable; reports are gitignored (`data/reports/calibration_report.*`). Methodology API gained a
compact `calibration` block (schema + service + regenerated OpenAPI/TS + frontend section).

Next milestone: broader licensed/open multi-league performance coverage so calibration can move
from fixture-and-slice evidence toward genuine validation — still no universal overall, no ML, no
auto-tuning.
