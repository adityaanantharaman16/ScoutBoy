# Visual regression baselines

Curated screenshot baselines for ScoutBoy's product-defining surfaces and its
risk-bearing honesty states. Added in the Milestone 7 Accessibility, Resilience &
Visual-Regression Closeout.

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

Never run `visual:update` in CI.

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

**All four projects** — Discovery, Discovery with the compare tray, the player
dossier, an alternate selected role, pinned territory evidence, the role
selector, the player action rail, My Favorites, a completed comparison, the
no-shared-role comparison, the role leaderboard, and Methodology. The mobile
projects add the open mobile navigation and Discovery at 320px.

**`desktop-chromium` only** — the honesty states: loading skeleton, empty
results, API error, unavailable role audit, unknown evidence group, missing
market data, and not-found. These prove the *treatment* of unavailable data,
which does not vary by engine, so capturing them four times would quadruple the
review burden for no extra signal.

## Determinism rules

- Production build against the fixture-backed API and database.
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
if a region is unstable, fix the instability rather than paint over it.

## Reviewing a failure

1. Open the Playwright HTML report and compare *expected* / *actual* / *diff*.
2. Decide whether the change is intended. If it is not, it is a regression — fix
   the code, not the baseline.
3. If it is intended, run `pnpm visual:update`, inspect every rewritten image,
   and describe the visual change in the pull request.
