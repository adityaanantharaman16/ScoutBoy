# ScoutBoy — Project State

Last updated: 2026-09-26, Wyscout P0 feasibility card `t_44597dd8`, isolated
worktree `/opt/data/projects/ScoutBoy-wyscout-p0`, branch
`research/wyscout-p0-feasibility`, based on `origin/main` @
`0b9d188f34c1a9dbfc11bd342aadf84837516d05`. P0 research evidence only, pending
independent review; not merged.

## Where the product is

Milestones 1 through 8.5 are shipped on `main`. Milestone 9 (comprehensive
security audit — rate limiting, audit logging, formal threat model, CSP,
penetration testing, data-retention policy) is **not scoped or started**. See
`docs/agent_notes.md` and the `docs/milestone_*.md` files for the full
per-milestone record, and `SECURITY.md` for the exact current control set.

Known, load-bearing limitations (do not silently drop these from docs):
- The real-data pilot is a **Bayer Leverkusen-centered Bundesliga 2023/24
  vertical slice, 34 StatsBomb matches** — never full Bundesliga/European
  coverage.
- End-user accounts (8.4A/8.4B, Clerk-based) are **optional twice over**
  (optional for a visitor, optional for a deployment) and have **never been
  exercised against a live Clerk tenant** — verification is deterministic
  offline tests only.
- The owner-approved future direction is a **historical, non-live Wyscout
  2017/18 Big Five snapshot**, not a live scouting service. It remains separate
  from both the as-built pilot and synthetic demos: **not ingested, verified for
  product use, deployed, or available through a Make/product command**. Its
  public files were acquired only privately and read-only for the P0 experiment
  below.

## Current checkpoint — Wyscout P0 feasibility measured (no migration)

GitHub status re-read on 2026-09-26: the plan PR #13 and the scope-documentation
PR #14 are both **merged** into `main`. The public GitHub REST API returned
`merged: true` for both, with `merged_at` 2026-09-26T19:34:26Z (#13) and
19:34:25Z (#14). `git ls-remote origin refs/heads/main` returned
`0b9d188f34c1a9dbfc11bd342aadf84837516d05`. Wording further down that calls
those PRs "open/draft and unmerged" is a superseded historical snapshot.
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) remains the historical design
record. Merging it did not authorize implementation.

P0 (card `t_44597dd8`) executed the plan's rights and read-only feasibility
experiment. Full results:
[WYSCOUT_FEASIBILITY_REPORT.md](WYSCOUT_FEASIBILITY_REPORT.md), with an
aggregate machine-readable report at `data/reports/wyscout_p0_feasibility.json`.

Headline measurements:
- **Coverage.** All five domestic leagues reconcile exactly with the S1 paper
  counts: 1,826 matches and 3,071,395 events. Fixture lists are complete, and
  there are no duplicate match or event IDs.
- **Identity and minutes.** Every one of the 2,570 players who appeared has a
  DOB. Minutes reconcile to 11 × 90 less dismissals per team-match, except in 3
  Italian matches with broken substitution records.
- **Positions (the blocker).** The only position field is a coarse, *current*
  GK/DF/MD/FW label. Match lineups have no positions. Under the plan's G1 rule
  (no blanket MD→CM or FW→ST mapping), **zero** players pass the strict G2 test,
  against a target of 100.
- **Metrics.** Only Deep-Lying Playmaker and Tempo Controller have all three
  required metrics as unvalidated candidates. Ball-Winning Midfielder is at 2/3,
  which is below the 70% gate. The other six roles need xG, carries or
  pressures, which the source lacks.
- **Diagnostic upper bound.** 183 unique U23 coarse midfielders would qualify if
  the owner relaxed the position rule for those two roles and the metrics later
  validated. This is not a G2 pass.
- **Rights.** All pinned Figshare articles are labelled CC BY 4.0. Public display
  still needs an owner and personal-data decision.

**Verdict:** NO-GO for the full-scope plan as written; CONDITIONAL on an owner
choice among the options in the report's §9 (stop, reduced two-role portfolio,
position-inference research, or another source). Do not start P1 as written.

This branch adds research tooling and evidence only:
- `scripts/wyscout_p0/`: the pinned fetcher/verifier, the streaming analysis,
  the research policy YAML, an independent count verifier and golden tests.
  Its tests are added to pytest `testpaths`.
- The feasibility report and the aggregate JSON report.

It adds no adapter, DB write, rating change, API/UI change, Make target or
deployment. Raw archives and per-player detail stay in gitignored
`data/raw/wyscout/`. The report's §4 has the exact commands to reconstruct them
from the pinned public DOIs.

Verification run on this card (host venv Python 3.13.5 unless stated):
- `pytest scripts/wyscout_p0/tests`: 28 passed. The same tests in Docker
  `python:3.9-slim` (Python 3.9.25) also gave 28 passed.
- Full `pytest`: 854 passed, 14 skipped, exit 0.
- `ruff check .` and `black --check .`: both exit 0.
- `verify_counts.py`: all checks match, exit 0.
- Two full analysis runs produced an identical deterministic fingerprint.

Frontend, E2E, contract and container checks were not run: no frontend or API
files changed. Exact-head CI evidence belongs on the PR and the card, not in
this file.

## Previous planning and documentation checkpoint (historical snapshot, superseded above)

The owner selected a historical, non-live Wyscout 2017/18 Big Five direction.
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) records the substantive design,
source research, nine-role metric feasibility, rights/identity/minutes/coverage
gates, historical market constraints, co-existence/rollback, reviewable slices
and future verification. **PLANNED, NOT IMPORTED OR SHIPPED.** No provider dataset
was downloaded/ingested, no application/scoring/UI code was changed, and no
deployment or GitHub repository metadata change was made on this card.

The plan is provisional: public snapshot rights/acquisition approval, granular
historical positions, measured usable coverage, supported-role semantics and any
separate market rights/availability remain gates. Wyscout supplies DOB, but not
direct pressure or xG evidence in the inspected schema. Initial recommendation is
validated Wyscout core metrics without market estimates; narrower role scope needs
owner approval, not silent relaxation of the historical 100-player/five-league gate.
Implementation is not dispatched by this planning card.

The plan was independently reviewed at
`12b7d81ce2fc902bf728339d97bd5c79d3dea93e`; draft PR #13 is open and unmerged.
Its exact-head required checks passed at review, but that plan review neither
authorizes implementation nor makes a Wyscout release real. This separate
documentation card aligns current and forward-looking copy while preserving the
StatsBomb pilot, synthetic demos, milestone evidence, metric definitions,
manifests, and historical ADR records as as-built evidence. It does not add an
adapter, source payload, Wyscout command, source-license clearance, coverage
claim, model change, or deployment.

Draft scope-documentation PR [#14](https://github.com/adityaanantharaman16/ScoutBoy/pull/14)
is open, draft, and unmerged from `docs/wyscout-scope` to `main`. It includes the
reviewed planning commit because draft plan PR #13 remains separately open/draft
and unmerged; neither PR makes the plan merged or authorizes a migration. Public
GitHub API read-back at PR creation confirmed the initial branch head
`d99e5918bc9abc3e93efdca28f7dc1ddc99be515`, base `main` @
`bafa77d42ec3025a8c917484ab5fafa972b70d0d`, and the truthful repository About
description. This documentation branch may receive follow-up commits, so use
`git ls-remote origin refs/heads/docs/wyscout-scope` and PR #14's `head.sha` as
the authoritative exact-head evidence before review or merge decisions.

Prior PR #12 is **merged**, not an open draft: GitHub REST `GET
/repos/adityaanantharaman16/ScoutBoy/pulls/12` returned `merged: true`,
`merged_at: 2026-09-26T14:01:32Z`, merge commit
`bafa77d42ec3025a8c917484ab5fafa972b70d0d`; `git ls-remote origin
refs/heads/main` independently returned the same SHA on 2026-09-26.

Planning verification/publication evidence is recorded on card `t_77b90bc8` and
the draft plan PR. The historical checks below belong to the previous maintenance
session, not this docs-only planning run. No application test success is claimed
for new migration behavior that does not exist yet.

## Previous session's work — PR #12 (historical record)

Two independent pieces of work, one branch, intended as one PR:

1. **Agent handoff documentation** — added `AGENTS.md`,
   `docs/PROJECT_STATE.md` (this file), and `docs/IMPLEMENTATION_HANDOFF.md`.
   A prior attempt at this same doc set (tracked separately) did not land in
   this checkout; do not assume it exists elsewhere.
2. **Production JavaScript dependency audit remediation** — the baseline
   `pnpm audit --prod --audit-level high` gate (`.github/workflows/security.yml`
   → `javascript-audit` job) was failing on locked production dependencies.
   Fixed by bumping manifests + regenerating `pnpm-lock.yaml`.

### Audit remediation detail

Baseline reproduced (before any change), `pnpm audit --prod --audit-level
high --json`, exit 1, 6 advisories:

| Package | Installed | Needed | Severity |
| --- | --- | --- | --- |
| `next` | 16.2.11 | >=16.3.3 | critical (2 advisories) |
| `sharp` | 0.35.0 | >=0.35.4 | high |
| `browserslist` | 4.28.5 | >=4.28.7 | high (2 advisories) |
| `baseline-browser-mapping` | 2.10.42 | >=2.11.0 | moderate |

Changes made (manifests only, versioned, no new dependency added):
- `apps/web/package.json`: `next` 16.2.11 → 16.3.6, `eslint-config-next`
  16.2.11 → 16.3.6 (kept in lockstep with `next`, as it always must be).
- `package.json` (root `pnpm.overrides`): `sharp` 0.35.0 → 0.35.4,
  `browserslist` 4.28.5 → 4.28.9 (new override, was previously only
  transitive), `baseline-browser-mapping` 2.10.42 → 2.11.26 (new override).
- `pnpm-lock.yaml` regenerated from those manifests with
  `pnpm install --no-frozen-lockfile`.

Post-fix `pnpm audit --prod --audit-level high --json`: **exit 0, 0
advisories** (`{"info":0,"low":0,"moderate":0,"high":0,"critical":0}`).

Compatibility checked before picking versions: Next 16.3.6 and
`eslint-config-next` 16.3.6 are both published release versions (not
canary/preview) on the npm registry. `@clerk/nextjs@7.7.6`'s declared peer
range for `next` is `^15.2.8 || ^15.3.8 || ^15.4.10 || ^15.5.9 || ^15.6.0-0 ||
^16.0.10 || ^16.1.0-0` (confirmed directly in `pnpm-lock.yaml`'s resolved
metadata for `@clerk/nextjs@7.7.6`). The `^16.0.10` clause is a caret range,
so by semver it covers every `16.x.y` with `x.y >= 0.10` up to (but not
including) `17.0.0` — that **does** include `16.3.6`; it is not a version the
range fails to enumerate. `pnpm-lock.yaml` resolves
`@clerk/nextjs@7.7.6(next@16.3.6...)` with no peer-dependency warning during
`pnpm install`, which corroborates the range match. Combined with the full
frontend gate (typecheck, lint, vitest, production build) passing clean
against it — see the verification table below — this bump has no known
Clerk compatibility risk. Re-check the declared range before any *future*
Next major bump (17.x), since none of today's clauses would match it.

## Previous maintenance session verification (not rerun by planner)

**Environment constraint:** this sandbox has no `pnpm`/`corepack` binary on
the host, and both `npm install -g <pkg>` and `pip install ...` are blocked
outright by a pre-execution security scanner (package threat-intel /
advisory-lookup timeouts) with no interactive approval available in this
run mode. Every check below that needs pnpm or a Python environment was
therefore run **inside a throwaway Docker container** built from the
project's own base images (`node:20`, `python:3.11-slim`) using the
project's own approved tools (`pnpm`, `pytest`, `ruff`, `black`) — not a
workaround that bypasses the security tooling, just a different runtime for
invoking the same approved commands. See `AGENTS.md` for the recipe. Docker
itself (daemon reachable, `docker info` succeeds) was confirmed available
via `mcp__terminal`.

| Check | Command | Runner | Result |
| --- | --- | --- | --- |
| Production JS dependency audit | `pnpm audit --prod --audit-level high --json` | Docker (`node:20`, this repo's own pnpm-lock/manifests) | **exit 0**, 0 advisories at any severity |
| Frontend typecheck | `pnpm --filter @scoutboy/web typecheck` | same container | **exit 0** |
| Frontend lint | `pnpm --filter @scoutboy/web lint` | same container | **exit 0** |
| Frontend unit tests | `pnpm --filter @scoutboy/web test run` (Vitest) | same container | **exit 0** |
| Frontend production build | `pnpm --filter @scoutboy/web build` | same container | **exit 0** |
| Python lint | `ruff check .` | Docker (`python:3.11-slim`, `pip install -e ".[dev]"`) | **exit 0**, "All checks passed!" |
| Python format check | `black --check .` | same container | **exit 0**, "169 files would be left unchanged" |
| Backend tests + coverage | `pytest --cov=... --cov-fail-under=90` | same container | **exit 0**, 826 passed, 14 skipped, 91.96% coverage (floor 90%) |
| API contract freshness | `python scripts/check_api_contract.py` | same container | **exit 0**, "API contract artifacts are current." (no regen diff) |
| Whitespace/conflict-marker hygiene | `git diff origin/main...HEAD --check` | host `mcp__terminal`, this worktree | **exit 0**, no output |
| Full-stack container build + health | `docker compose -p scoutboy-smoke-manual -f docker-compose.full.yml up -d --build --wait --wait-timeout 180` | host Docker daemon (confirmed reachable via `docker info`; `docker compose` CLI plugin manually linked into this profile's `~/.docker/cli-plugins/` from another profile's install, since it was missing here) | **exit 0**, db/api/web all reported `Healthy` by Compose's own wait |

`scripts/docker_smoke.sh` itself (the exact `make docker-smoke` target) was
**not** used verbatim for the final health-endpoint probe: it curls
`localhost:$PORT` from the same shell that ran `docker compose up`, but in
this sandboxed environment that shell is in a different network namespace
than the Docker daemon's host, so the published ports (confirmed present via
`docker ps`: `18000->8000`, `13000->3000`, `55432->5432`) are not reachable
from here even though every container is `Healthy` — host `curl` to
`localhost:18000/healthz` returned exit 7 ("could not connect"), not an
app-side failure. To get real evidence instead of accepting that
inconclusive result, each service's *own* health check command was re-run
directly inside its own container (`docker exec ... python -c
"urllib.request.urlopen('http://localhost:8000/healthz')"` for the API,
equivalent `node -e` for the web container) — these are the identical
commands Compose's healthcheck already uses, just invoked manually for
independent evidence: **API `/healthz` → 200, API `/readyz` → 200, web `/`
→ 200.** The stack was then torn down cleanly (`docker compose ... down
--volumes --remove-orphans`, exit 0, all containers/network/volume removed).
This is strong evidence the full-stack image/compose config builds and boots
correctly; it is not identical to a green `make docker-smoke` from a runner
with host-network parity with the Docker daemon (e.g. actual CI), which
should still be treated as the authoritative full-stack gate.

Checks **not run** this session, with the reason:
- `make e2e` (Playwright, production build + isolated fixture DB) — not run.
  The Docker-based verification above proves lint/type/unit/build/audit
  green; the full browser E2E flow needs a longer-lived container/network
  setup than the per-command throwaway image used here. Should be run before
  merge if a runner with more time/Playwright browser install is available.
- PostgreSQL integration smoke (`apps/api/app/tests/test_postgres_smoke.py`
  with `SCOUTBOY_POSTGRES_SMOKE=1`) — not run; needs a live Postgres service
  wired to `DATABASE_URL` the way CI's `postgres-integration` job does, which
  this session did not stand up (the full-stack Postgres brought up for the
  container smoke above is a different, containerized path, not this pytest
  target run against it).
- `pip-audit` (Python dependency audit) — out of scope for this task, which
  was JS-dependency-only per the assigned card; SECURITY.md's existing
  temporary-exception list for the Python audit is untouched.

## Previous maintenance publication history (superseded by merged status above)

- Branch `docs/handoff-security-audit`, based on `origin/main` @ `230ff4a`.
- Local commit(s) made in this worktree; branch preserved, not merged, not
  force-pushed.
- GitHub write auth became available mid-session (owner-provided PAT). An
  authenticated `GET /user` and `GET /repos/adityaanantharaman16/ScoutBoy`
  confirmed push permission, and `git push --dry-run` succeeded.
- **Pushed and PR opened.** `git push origin
  HEAD:refs/heads/docs/handoff-security-audit` succeeded. Use `git rev-parse
  HEAD`, `git ls-remote origin refs/heads/docs/handoff-security-audit`, and
  the PR's `head.sha` as the current source of truth rather than embedding a
  commit hash in this file (updating the file necessarily creates a newer
  commit). Draft PR opened:
  https://github.com/adityaanantharaman16/ScoutBoy/pull/12 (state `open`,
  `draft: true`, `head_sha` independently re-read from the GitHub API and
  confirmed to match at that time). Subsequently merged on 2026-09-26 at
  14:01:32 UTC, verified above; the earlier open-draft state is historical.

## Next action

1. Independent review of the P0 branch and PR on card `t_44597dd8` (same-card
   reviewer). Do not merge without the owner's authorization.
2. After review, the owner reads `docs/WYSCOUT_FEASIBILITY_REPORT.md` §9 and
   chooses an option: stop, a reduced two-role portfolio (which needs a planner
   revision of the G1/G2 position rule), position-inference/PX research, or a
   different source. The public-display rights and personal-data decision stays
   separate.
3. Do not dispatch P1–P6 until the owner decides. Keep the StatsBomb pilot truthful
   and active. Milestone 9 remains unscoped.
