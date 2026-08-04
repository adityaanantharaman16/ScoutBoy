# Visual regression baselines

Curated screenshot baselines for ScoutBoy's product-defining surfaces and its
risk-bearing honesty states. Added in the Milestone 7 Accessibility, Resilience &
Visual-Regression Closeout.

## Commands

```bash
pnpm visual
```

```bash
pnpm visual:update
```

`pnpm visual` compares against the committed baselines. `pnpm visual:update`
rewrites them — **review every changed image by hand before keeping it.** A
baseline update is a claim that the new rendering is correct; it is never a way
to make a red suite green.

Both commands go through `scripts/run_visual.sh`, so both get the isolated
fixture database described below. Never run `visual:update` in CI.

## The isolated fixture database

Screenshot comparison is only meaningful when the data behind the pixels is
fixed. Every run of either command performs the same lifecycle, in
`scripts/run_visual.sh`:

1. `mktemp -d` a throwaway root, with a cleanup trap that removes **only** that
   directory — on success and on failure alike.
2. Export `DATABASE_URL` pointing at a SQLite file inside it, plus the test
   environment, API origin, web origin and `NEXT_PUBLIC_API_BASE_URL`.
3. `alembic upgrade head`.
4. Ingest the committed `sample` provider.
5. Recompute ratings, playstyles and market values.
6. Build the production web app against the isolated API origin.
7. Run `playwright.visual.config.ts`, forwarding Playwright's exit status.

**The developer's `db/scoutboy.db` is never read, written or opened.** The
preparation steps are shared with `make e2e` through `scripts/lib/fixture_env.sh`,
so the two suites cannot drift apart in how they seed their data.

`playwright.visual.config.ts` refuses to load unless `SCOUTBOY_FIXTURE_ROOT` is
set and `DATABASE_URL` points inside it, so `playwright test --config
playwright.visual.config.ts` cannot be run bare. That guard exists because the
previous arrangement did exactly that: it started FastAPI with no database
preparation at all, and the API silently served whatever `DATABASE_URL` was in
scope — in practice the local pilot database, whose primary keys and cohort
differ from the sample fixtures.

## Fixture identity

Primary keys are an artefact of insertion order, not part of the fixture
contract. The same two players are ids 7 and 20 in a freshly seeded sample
database and ids 6 and 17 in the local pilot database, which is how a
`/compare?a=6&b=17` baseline came to be compared against two different pairs of
players in two different runs.

Scenarios that depend on *which* players they are looking at therefore select
them **by canonical name through the real controls** and assert what they got
before capturing anything. `support/fixtures.ts` holds both the identities and
the assertions.

The no-shared-role scenario proves all of the following before its screenshot:

- Player 1 is **Anton Keller** and Player 2 is **Karim Nasser**, per the compare
  response the UI actually rendered;
- both are genuinely rated in at least one role — an unrated player would reach
  the same neutral state for the wrong reason;
- their rated roles do not intersect (forward roles vs central-midfield roles);
- the compare API therefore selected no role (`role_key` is `null`);
- the rendered surface shows both names and the neutral
  `No Shared Rated Role` state.

No response is intercepted and no identity is masked: this is the real API answer
for a genuinely disjoint pair.

## Why this is not in CI

Screenshot comparison across platforms is dominated by **font rasterization**:
the same build renders text measurably differently on macOS and on a Linux CI
runner, producing failures that say nothing about the product and quickly train
reviewers to ignore the suite. This stays an explicit local / release-review gate
until baselines are proven stable on the platform that will run them.

Nothing is lost from CI by that decision: `make e2e` still runs **all** of the
non-visual coverage — accessibility scans, semantics, keyboard and focus, target
size, reflow, text spacing, degraded-data resilience, interaction stress, console
errors and motion.

## Layout

```
tests/visual/__screenshots__/{project}/baselines.spec.ts/{name}.png
```

The project segment records the browser and viewport that produced the image, so
a baseline can never be silently compared against the wrong engine.

| Project | Engine | Viewport |
| --- | --- | --- |
| `desktop-chromium` | Chromium | 1280×900 |
| `desktop-webkit` | WebKit | 1280×900 |
| `mobile-chromium` | Chromium | 390×844 |
| `mobile-webkit` | WebKit | 390×844 |

## What is covered

84 test executions produce **59 baselines**; the other 25 are skipped as
inapplicable to their project and say so rather than reporting a pass.

**All four projects** — Discovery, Discovery with the compare tray, the player
dossier, an alternate selected role, pinned territory evidence, the role
selector, the player action rail, My Favorites, a completed comparison, the
no-shared-role comparison, the role leaderboard, and Methodology. The mobile
projects add the open mobile navigation and Discovery at 320px (skipped on the
two desktop projects).

**`desktop-chromium` only** — the honesty states: loading skeleton, empty
results, API error, unavailable role audit, unknown evidence group, missing
market data, and not-found. These prove the *treatment* of unavailable data,
which does not vary by engine, so capturing them four times would quadruple the
review burden for no extra signal. They are skipped on the other three projects.

## Determinism rules

- Production build against the isolated fixture database above.
- Player identities asserted, never inferred from primary keys.
- Device-local state cleared before each shot unless the state under test needs
  it (favourites, compare queue).
- Fonts loaded and **every animation finished** before capture — the motion
  cadence fades panes in over 120–180ms, and an element captured mid-fade has a
  blended colour that belongs to no palette.
- `maxDiffPixelRatio: 0.002` with `threshold: 0.2`. Deliberately tight: a large
  tolerance would approve exactly the regressions this suite exists to catch.
- Retries are off. A mismatch is a finding to look at, not something to retry
  away.

## Masks

Exactly one, applied to three surfaces: `[data-testid="page-meta"]`. It carries
Methodology's "Last updated" line and the leaderboard's rating-version metadata,
both of which vary with the fixture build rather than with the UI. Both are
asserted **textually** by the functional suites, so masking them here costs no
coverage and keeps the baseline about layout and treatment.

No other mask exists. Broad masks that hide real instability are not permitted —
if a region is unstable, fix the instability rather than paint over it. No player
name, player datum or comparison panel is masked.

## Reviewing a failure

1. Open the Playwright HTML report and compare *expected* / *actual* / *diff*.
2. Decide whether the change is intended. If it is not, it is a regression — fix
   the code, not the baseline.
3. If it is intended, run `pnpm visual:update`, inspect every rewritten image,
   and describe the visual change in the pull request.

A failure that names players, clubs, leagues or market ranges is a **fixture**
question, not a design one: check the identity assertions in
`support/fixtures.ts` before touching any baseline.
