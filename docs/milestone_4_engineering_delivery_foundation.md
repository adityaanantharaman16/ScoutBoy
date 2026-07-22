# Milestone 4 — Engineering Delivery Foundation

> Status: implementation complete; container/PostgreSQL runtime checks await CI. This milestone
> makes the existing ScoutBoy vertical slice reproducible and production-shaped; it does not claim
> commercial production readiness or expand football-data/product scope.

## Repository audit

- Local development currently defaults to SQLite and can optionally use the existing
  `docker-compose.yml` PostgreSQL service. That workflow will remain compatible.
- FastAPI has one legacy `/api/health` liveness route, but no database readiness probe or explicit
  production-mode configuration validation.
- OpenAPI export and TypeScript generation commands already exist, but there is no single freshness
  gate that regenerates both artifacts and checks the Git worktree.
- Playwright already runs the critical fixture-backed flow against `next start` after a production
  build.
- There are no GitHub Actions workflows, full-stack application containers, automated dependency
  audits, contributor/security policies, ADRs, or operational runbooks yet.
- The real-data pilot remains a 34-match, Bayer Leverkusen-centered Bundesliga 2023/24 slice. Raw
  provider snapshots are intentionally local and gitignored.

## Execution plan

1. Add explicit `development`, `test`, and `production` configuration modes. Preserve frictionless
   local defaults; require an admin token and explicit non-wildcard CORS origins in production.
2. Add `/healthz` for liveness and `/readyz` for a lightweight database query, retaining
   `/api/health` for compatibility. Cover configuration enforcement and readiness failure paths.
3. Add one local API-contract command that exports OpenAPI, regenerates the TypeScript schema, and
   fails when either tracked artifact is stale.
4. Add root-built API and multi-stage web images plus a separate `docker-compose.full.yml` with
   PostgreSQL, migration, API, and web services. Keep the current database-only Compose workflow.
5. Add CI jobs for Python 3.9/3.11 quality and coverage, frontend quality/build, contract freshness,
   genuine PostgreSQL migration/seed/recompute/API smoke testing, production-build Playwright, and
   bounded container validation.
6. Add Gitleaks, Python and production JavaScript dependency audits, and Dependabot updates for
   Python, pnpm, and GitHub Actions.
7. Add contributor/security guidance, three architecture decisions, failure runbooks, complete
   Makefile commands, and README instructions that accurately distinguish local convenience from
   production-shaped delivery.
8. Run every locally available quality, migration, contract, build, Compose, container, and E2E
   check. Record exact results and explicitly identify checks blocked by missing local tooling.

## Delivered foundation

- `CI` validates Python 3.9/3.11 lint, formatting, tests, and coverage; frontend lint, typecheck,
  tests, and production build; generated contracts; genuine PostgreSQL migration/pipeline/API use;
  the fixture-backed Playwright flow; and the full-stack container health path.
- `Security` runs Gitleaks, an isolated Python project dependency audit, and a production JavaScript
  dependency audit. Dependabot covers Python, pnpm, and Actions weekly.
- Production mode requires a non-empty admin token and explicit non-wildcard CORS origins.
  `/healthz` is database-independent; `/readyz` checks connectivity and the current Alembic head.
- The separate full-stack Compose path runs PostgreSQL, migrations, deterministic synthetic
  bootstrap, a non-root API container, and a non-root production Next.js container. The existing
  database-only Compose path is unchanged.
- The web runner uses traced standalone output rather than copying workspace development
  dependencies. Local/CI Playwright still validates a normal production build with `next start`.
- Playwright defaults to dedicated ports and a disposable SQLite database; reuse of an existing
  server is explicit opt-in only.
- OpenAPI and generated TypeScript contracts now have one convergent local/CI freshness gate.
- Contributor/security policies, three ADRs, and local-development/migration/pipeline runbooks are
  present. Documentation retains the 34-match Leverkusen-centered pilot limitation.

## Acceptance evidence (2026-07-22)

- `make lint`: passed (Ruff, Black, frontend ESLint).
- `make test`: passed (124 Python tests plus 15 frontend tests; one real-snapshot test skipped
  because raw snapshots are intentionally gitignored).
- Python coverage command used by CI: passed at 91.37% against a 90% floor. Peer-group assignment,
  data-quality reports, and cohort reports are included and directly tested. Only declarative
  schema/ORM code, generated export code, and tests are excluded from the denominator.
- `pnpm --filter @scoutboy/web typecheck`: passed.
- `pnpm --filter @scoutboy/web build`: passed on Next.js 15.5.18.
- `make check-api-contract`: passed after regenerating and committing the new health schemas.
- `make e2e`: passed against isolated `next start` servers on `13080`/`18080` while the development
  stack was already live on `3000`/`8000`; the normal SQLite database checksum was unchanged. The
  critical search → card → audit → leaderboard → compare → methodology flow remains intact.
- Fresh SQLite database: migrated from base through `0004_provider_agnostic_events`; `/readyz`
  returned ready.
- Production import with an empty admin token: failed safely. Development import with an empty
  token: passed.
- `pip-audit . --strict` with the seven documented, unavailable-upstream-fix exceptions: no other
  findings. `pnpm audit --prod --audit-level high`: no findings after upgrading Next.js and
  overriding vulnerable Sharp/PostCSS transitive versions.
- Compose/workflow/Dependabot YAML parsed successfully; the smoke shell script passed syntax
  validation; `git diff --check` passed.

Docker, Docker Compose, PostgreSQL server/client tools, and Gitleaks are not installed on this host.
Consequently `docker compose ... config`, `make docker-build`, `make docker-smoke`, the real
PostgreSQL smoke, and local Gitleaks were not run here. CI is configured to validate Compose with
Docker itself, build/start/probe the full stack, run every migration plus sample ingestion and all
recomputations against PostgreSQL, assert the SQLAlchemy dialect is genuinely PostgreSQL, exercise
readiness and a player API read, and run Gitleaks over full history.

## Owner decisions before a public release

- Choose a repository license; no `LICENSE` file was added.
- Choose a deployment host and production database/secret-management arrangement.
- Obtain and govern licensed provider credentials before expanding beyond open/local data.
- Choose production monitoring and error-tracking vendors plus retention/alerting policy.

## Milestone 4.1 hardening

The final pre-commit hardening pass corrected embedded-wildcard CORS validation, isolated E2E from
development ports/data, restored runtime reporting modules to the coverage denominator with focused
tests, and replaced the web runner's copied workspace dependencies with Next.js traced standalone
output. Product behavior, data coverage, rating logic, and public API behavior remain unchanged.
