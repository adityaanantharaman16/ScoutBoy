# AGENTS.md — ScoutBoy

This file orients an autonomous coding agent (or a human picking the project back
up cold) working in this repository. It is the entry point; deeper detail lives
in the linked docs rather than being duplicated here.

## What this repo is

ScoutBoy is a production-shaped, FUT.gg-style real-life football player
discovery portfolio project. See `README.md` for the product description and
`docs/agent_notes.md` for the original build decisions and out-of-scope calls.

**Milestones 1 through 8.5 are shipped on `main`.** Milestone 9 (a
comprehensive security audit — rate limiting, audit logging, a formal threat
model, security headers/CSP, penetration testing, data-retention policy) is
**not scoped or started**; see `SECURITY.md` for exactly which controls exist
today (secret scanning, Python/JS dependency audits, admin-token gating) and
which do not.

The real-data pilot is a **Bayer Leverkusen-centered Bundesliga 2023/24
vertical slice (34 StatsBomb matches)** — never describe it as full Bundesliga
or European coverage. End-user accounts (Milestone 8.4A/8.4B) are **optional
twice over**: optional for a visitor (anonymous use is the default, full
product) and optional for a deployment (no Clerk configuration = no auth
surface at all, private routes 503). No live Clerk tenant has been exercised
against this codebase; account behavior is verified only by deterministic
offline tests.

The owner-approved **target**, not a shipped dataset, is a historical, non-live
Wyscout 2017/18 Big Five snapshot. Its reviewed design is in
`docs/IMPLEMENTATION_PLAN.md`; it is **not yet acquired, ingested, verified,
deployed, or available through an existing Make command**. Keep four states
distinct in documentation: synthetic fixtures/demos; the as-built 34-match
StatsBomb pilot; this planned Wyscout target; and any future source-license,
coverage, identity, metric, market, capacity, and owner-cutover gates.

## Fresh-machine setup

Prerequisites: Python 3.9 or 3.11 (3.11 recommended), Node 20 with Corepack
(for pnpm), optionally Docker.

```bash
corepack enable pnpm      # once, if pnpm isn't already resolvable
make install               # venv + backend deps ('.[dev]'), pnpm frontend deps
make seed                  # migrate + load 24 synthetic sample players
make recompute-ratings     # compute RoleFit + playstyles + market values
make dev                   # API on :8000, web on http://localhost:3000
```

SQLite is the zero-setup default (`db/scoutboy.db`); PostgreSQL 16 is fully
supported via `DATABASE_URL` and is what CI's integration path and the
full-stack Docker Compose use. See `docs/runbooks/local-development.md` for
every variant (Postgres, full-stack containers, optional accounts).

**A note for an agent working in a sandboxed/CI-like environment with no
existing pnpm/corepack binary and blocked package-manager installs (as
encountered while producing this file): Docker is a reliable fallback.**
`docker build` a throwaway image from `node:20`, `RUN corepack enable`, copy
the repo in, and run `pnpm install` / `pnpm audit` / `pnpm build` etc. as
`RUN` steps that redirect output to files under `/out`, then `docker cp` those
files out for inspection. This uses the project's own approved package
manager (pnpm) inside the project's own approved runtime (Docker) rather than
installing an unvetted global tool on the host. The same pattern works for the
Python side with a `python:3.11-slim` image when host `pip install` is
similarly blocked. IMPORTANT: put `COPY . .` (or equivalent) *before* any step
that mutates a manifest/lockfile you want to keep (`pnpm install
--no-frozen-lockfile` etc.) — copying the repo in afterward will silently
overwrite your regenerated lockfile with the stale one from disk. See git
history around this file's commit for a Dockerfile that does this correctly.

## Architecture boundaries (enforced in review)

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

Hard rules: no scoring in API routes; no ingestion in the frontend/routes; no
authoritative scoring in the frontend (it only displays stored backend
output); all weights/thresholds live in versioned YAML config, never
hard-coded; every score/badge/value carries an explanation; deterministic
sorts with explicit tie-breaks; every rating run is versioned. Full rationale
in `docs/agent_notes.md` and the ADRs under `docs/adr/`.

## Where to look for what

| Question | Source of truth |
| --- | --- |
| Product behavior, API surface, commands | `README.md` |
| Why a decision was made / what's intentionally out of scope | `docs/agent_notes.md` |
| Security controls that exist vs. don't (Milestone 9 gap) | `SECURITY.md` |
| Contribution workflow, required pre-PR checks | `CONTRIBUTING.md` |
| Per-milestone implementation record | `docs/milestone_*.md` |
| Architecture decisions | `docs/adr/000*.md` |
| Operational failure playbooks | `docs/runbooks/*.md` |
| Current state, what's verified, next action | `docs/PROJECT_STATE.md` |
| How to resume/hand off an agent session | `docs/IMPLEMENTATION_HANDOFF.md` |
| Planned historical Wyscout direction and gates | `docs/IMPLEMENTATION_PLAN.md` |

## Exact verification commands

Backend:
```bash
make lint          # ruff check . && black --check . && pnpm --filter @scoutboy/web lint (lint-py + lint-web)
make test          # pytest (backend) + vitest (frontend, test-py + test-web)
```

Frontend-specific:
```bash
pnpm --filter @scoutboy/web typecheck
pnpm --filter @scoutboy/web lint
pnpm --filter @scoutboy/web test run
pnpm --filter @scoutboy/web build       # production build
```

Contract, e2e, security (local sample commands — see below for the exact CI
job gates, which differ in flags/scope from these):
```bash
make check-api-contract     # regenerate OpenAPI + TS schema; fails when tracked outputs were stale
make e2e                    # isolated DB + ports, production build + Playwright
git diff --check            # whitespace/conflict-marker hygiene
pnpm audit --prod --audit-level high    # production JS dependency audit
pip-audit . --strict --ignore-vuln PYSEC-2026-161 --ignore-vuln PYSEC-2026-248 \
  --ignore-vuln PYSEC-2026-249 --ignore-vuln PYSEC-2026-2280 --ignore-vuln PYSEC-2026-2281 \
  --ignore-vuln PYSEC-2026-2132 --ignore-vuln PYSEC-2026-2270   # see SECURITY.md for the exception list
make docker-smoke            # full-stack container build + health probe (needs Docker)
```

CI groups the gates rather than mirroring the local command list one command
per job. `.github/workflows/ci.yml` has six jobs:

- `python-quality` (Python 3.9 and 3.11) creates a fresh venv, then runs Ruff,
  Black, and pytest with the coverage floor;
- `frontend-quality` uses `pnpm install --frozen-lockfile`, then groups lint,
  typecheck, Vitest, and the production build;
- `api-contract` creates a fresh venv, uses a frozen pnpm install, runs
  `make check-api-contract`, and checks only the tracked contract artifacts
  for a diff;
- `postgres-integration` creates a fresh venv and exercises migrations,
  deterministic ingestion/recompute, and the PostgreSQL API smoke test;
- `end-to-end` creates a fresh venv, uses a frozen pnpm install, installs
  Chromium, and runs `make e2e`; and
- `container-smoke` validates Compose and runs `make docker-smoke` without a
  Python or pnpm dependency-install step.

`.github/workflows/security.yml` has three jobs: `secret-scan` runs Gitleaks
without installing project dependencies; `python-audit` installs `pip-audit`
and runs the exact Python audit command above; and `javascript-audit` uses a
frozen pnpm install before the exact production audit command above. Only the
jobs that install pnpm dependencies use `--frozen-lockfile`, and only the CI
jobs that install the Python application create a fresh venv. `git diff
--check` remains a local/pre-PR hygiene check; neither workflow runs it.
Treat CI green as the actual bar, while still stating explicitly when a local
run skipped a gate (for example, because Docker was unavailable).

## Rules for an agent working here

1. Milestone 8.5 (terminology audit) is the last shipped milestone. Do not
   start Milestone 9 (security audit) work under a docs/maintenance task;
   flag it back for planning if asked to expand scope.
2. Never claim a branch is pushed or a PR is open without an actual remote
   SHA and PR URL in hand. `git push --dry-run` failing with `could not read
   username` means no GitHub write credential is configured in this
   environment — that is a real blocker to report, not something to route
   around by pushing anyway or fabricating a URL.
3. Do not pass full `pnpm audit --json` / `npm view * versions --json` output
   into a model's context window verbatim — it is enormous and mostly noise.
   Write it to a scratch file (`$TMPDIR`, never `/tmp`) and extract only
   package/installed-version/fixed-version/severity/count/exit-status with a
   short script.
4. Do not work around a blocked security-tool/package-manager install by
   fetching cached binaries from unusual locations or installing an
   unpinned/latest package manager version to dodge a scanner. If the
   approved path is denied, use the approved tool inside Docker (see fresh-
   machine setup note above) or stop and report the exact blocker.
5. Keep the 34-match Leverkusen-centered pilot caveat and the
   optional/no-live-tenant accounts caveat intact wherever milestone or
   security docs mention them — they are load-bearing accuracy statements,
   not boilerplate to trim.
6. See `docs/PROJECT_STATE.md` for the session log and the next action before
   starting new work.
7. Do not turn the planned Wyscout target into an implementation claim: no
   data acquisition/import, source-license assumption, coverage claim, current
   scouting claim, or Wyscout command without a separately authorized slice.
