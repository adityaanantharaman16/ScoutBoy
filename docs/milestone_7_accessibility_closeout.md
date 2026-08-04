# Milestone 7 — Accessibility, Resilience & Visual-Regression Closeout

**Status: complete. Milestone 7 is complete.**

The audit target was **WCAG 2.2 Level A and AA**. No known Level A or AA failure
remains on a production surface. Dark mode remains deferred and untouched.

> This document does **not** claim legal accessibility certification, nor
> conformance established by tooling alone. Automated scanning detects a minority
> of WCAG issues; the manual, measured and behavioural work below is what carries
> the rest. Screen-reader verification was **not** performed — see
> [Screen-reader status](#screen-reader-status).

Two engineering defects found after the first closeout pass have been corrected
and are recorded in place, not as an appendix:

- the visual-regression suite ran against whatever database happened to exist
  locally, and its no-shared-role scenario trusted primary keys — see
  [Visual baselines](#visual-baselines-phase-12);
- the production PostCSS override carried a newly disclosed moderate advisory that
  the required high-severity audit gate could not see — see
  [Dependency security](#dependency-security--postcss).

## Prerequisite

The preceding scrolling correction was present before this phase began:
`<html lang="en" data-scroll-behavior="smooth">` in `app/layout.tsx`, with
`scroll-behavior: smooth` under `no-preference` and `auto` under `reduce`, route
navigation not gliding, and the Next.js `missing-data-scroll-behavior` warning
gone. Re-verified by `tests/e2e/motion.spec.ts`.

## Audit methodology

For every production change: identify the surface, reproduce the failure, map it
to a WCAG criterion, state the user impact, apply the smallest safe correction,
and pin it with a regression test. No production code was changed for a
preference, a theoretical edge case, or a cosmetic opinion.

Five techniques, in order of authority:

1. **Measurement** — contrast computed from actual rendered colours, target sizes
   from real bounding boxes. Never estimated.
2. **Behavioural assertion** — keyboard walkthroughs, focus tracking, ARIA state.
3. **Automated scanning** — axe-core, as a floor rather than a verdict.
4. **Adverse-state interception** — real response shapes, lightly edited.
5. **Curated visual baselines** — for what none of the above can see.

## Production-surface inventory (Phase 1)

Encoded executably in `tests/e2e/support/surfaces.ts` so every suite iterates the
same list and cannot drift from this table.

| Surface | Route | Landmark / heading | Readiness anchor | Degraded variants |
| --- | --- | --- | --- | --- |
| Discovery | `/` | `main` / "Discover players" | `results-ledger` | loading, empty, error, long names |
| Player dossier + Recruitment Desk | `/players/[id]` | `main` / player name | `role-territory` | card error, audit error, profile-only |
| Role Territory | (dossier) | decorative SVG + text list | `role-evidence-list` | unknown group, low confidence |
| Peer-Ranked Roles, playstyles, market, context, sub-stats, audit trail | (dossier) | `section` + `h2` | — | missing market, no playstyles, unknown |
| Comparable players | (dossier) | `section` + `h2` | — | empty |
| Role leaderboard | `/roles/[id]` | `main` / role masthead | `h1` | empty rows, missing asking range |
| Compare selection | `/compare` | `main` / page header | `compare-a` | one side unrated |
| Completed comparison | `/compare?a=&b=` | `main` | `compare-role` | confidence warnings |
| No-shared-role comparison | `/compare?a=&b=` | `main` | `compare-no-shared-role` | **real disjoint sample pair** |
| My Favorites | `/shortlist` | `main` / "Saved Players" | `h1` | zero saved, stale ids |
| Methodology | `/methodology` | `main` / "Methodology" | `methodology-contents` | calibration inconclusive |
| Global navigation | all | `header` > `nav` (banner/navigation) | `nav-discover` | — |
| Mobile navigation | all `<lg` | same `nav`, toggled | `nav-menu-panel` | — |
| Compare tray | all | `aside` "Compare queue" | `compare-tray` | one player queued |
| Not found | any unmatched | `main` / "Page Not Found" | `not-found` | — |

Player primary keys are **not** part of that surface contract. Ids are an
artefact of insertion order — the same two players are 7 and 20 in a freshly
seeded sample database and 6 and 17 in the local pilot database — so any scenario
that depends on *which* player it is looking at must resolve identity by name and
assert it. The visual suite does exactly that (see
[Visual baselines](#visual-baselines-phase-12)); the accessibility scans are
identity-agnostic and only need the state to be present.

Keyboard entry point on every surface is the skip link, then the primary
navigation. Live regions: `role="status"` for loading/empty, `role="alert"` for
errors, and a polite region for role selection and device-local actions. The only
fixed content is the compare tray; the only sticky content is the Discovery
filter rail at `lg+`. Narrowest supported presentation is 320px.

## Automated tooling scope (Phase 2)

`@axe-core/playwright` **4.12.1**, added as a **root dev dependency only** — no
production dependency was added. Pinned through the existing pnpm lockfile.

`tests/e2e/support/a11y.ts` centralises scanning:

- tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`;
- fails on **critical, serious and moderate** violations;
- `REVIEWED_EXCEPTIONS` is **empty** — no rule is disabled anywhere;
- supports scoped component scans, and never excludes a production region to
  make a scan pass;
- `settle()` waits for fonts **and every running animation** before scanning.

That last point mattered. Scanning during the motion cadence's 120–180ms
entrances reported colours such as `#7c857c` on `#fcfbf6` (3.68:1) — a *blend* of
a mid-animation opacity, a colour that exists nowhere in the palette. Without
waiting for motion to settle, the audit would have chased contrast defects that
no user can ever see.

Scanned surfaces: Discovery; Discovery + compare tray; dossier; dossier with an
alternate role; dossier with pinned evidence; My Favorites with saved players;
Compare selection; completed comparison; no-shared-role comparison; leaderboard;
Methodology; mobile navigation open; loading; empty; error; unavailable role
audit; not-found.

## Defects found and fixed

Six production defects, each reproduced and measured before any code changed.

### D1 — Muted text below 4.5:1 · SC 1.4.3 Contrast (Minimum), AA

`--ink-soft` `#6e7a6f` measured **4.01:1** on `--paper`, 4.33:1 on `--panel`,
3.82:1 on `--panel-muted`. It carries `.label` eyebrows, metadata lines, the
footer, "unknown" copy and the wordmark's "Recruitment" — normal-size text
requiring 4.5:1. axe flagged 64–114 nodes per surface.

**Impact:** the entire subordinate information layer — including the honest
"unknown"/"not provided" copy that is central to the product's integrity — was
below the legibility floor for low-vision users.

**Fix:** `--ink-soft` → `#5f6b61` (**4.98 / 5.39 / 4.75**). Same warm grey-green
hue; lightness only. Mirrored in `tailwind.config.ts`.

### D2 — Control boundaries below 3:1 · SC 1.4.11 Non-text Contrast, AA

`--line-strong` `#b9b29d` measured **1.89:1** on paper. It bounds `.btn`,
`.input`, `select.input`, `.rail-box` and `.rail-action`, whose fill (`--panel`)
sits at 1.08:1 against the page — so the border is the *only* thing identifying
the control. axe does not test 1.4.11; this was found by measurement. (The
dark-mode pilot's notes had already observed it in passing without a fix.)

**Impact:** buttons and inputs were not reliably discernible as controls.

**Fix:** `--line-strong` → `#8d866f` (**3.25 / 3.51**). Verified used only for
borders and small fills, never as a text colour.

### D3 — Elite score band below 4.5:1 at real sizes · SC 1.4.3, AA

`text-elite` `#2e74e6` measured **3.94:1** on paper. That clears the 3:1
large-text threshold but not the sizes the class actually renders at: the
leaderboard's `text-sm` cell, the comparison metric column, `ScoreReadout
size="sm"`, and the role tab's 18px — below the 18.66px bold large-text cut-off.
The code comment claimed "All are AA-legible on warm paper"; measurably false.

**Fix:** `BAND_TEXT.elite` → `text-elite-ink` `#1f57b0` (**6.15:1**), the token
the palette already defined as "a darker companion for small text". The brighter
`elite` is retained for the *bar* fill, a supplementary graphic whose value is
always present as text.

### D4 — Compare tray eyebrow at 2.94:1 · SC 1.4.3, AA

`class="label text-paper/60"` on the tray's near-black surface resolved to
`--ink-soft`, not to the utility: `.label` is declared *after* Tailwind's
utilities layer and has equal specificity, so it wins. Measured **2.94:1** (and
3.65:1 before D1 darkened the token — a pre-existing failure D1 deepened).

**Fix:** a `.label-on-ink` modifier supplying `#9aa096`, **6.12:1** on `--ink`.

### D5 — Compare-tray remove control 8×20 · SC 2.5.8 Target Size (Minimum), AA

The per-player "x" measured 8×20 CSS px against a 24×24 minimum, with no
applicable exception — not inline in a sentence, not essential, not UA-default.

**Fix:** a 24×24 hit area; the glyph is unchanged, so the tray's density is
preserved.

### D6 — Focused control entirely hidden by the tray · SC 2.4.11 Focus Not Obscured (Minimum), AA

With the tray open on Discovery, tabbing to the third player link left it at
y=686 inside a tray occupying 626–708 — **entirely** hidden.

`scroll-padding-bottom: 7rem` on `html` was added and retained, but does not fix
this alone: the browser only consults scroll padding when it decides to scroll,
and here the element is already technically "in view" at `scrollY: 0`.

**Fix:** a focus-scoped nudge in `CompareTray` — on `focusin`, if the fixed tray
overlaps the focused element, scroll it clear. Attached only while the tray is
mounted; pointer users cannot trigger it because the tray already intercepts
clicks over that region.

> One spec detail worth recording, because it cost a debugging cycle:
> `window.scrollBy({ behavior: "auto" })` means *"use the element's
> `scroll-behavior` CSS value"* — which is `smooth` here. The first attempt
> therefore started a smooth page scroll rather than an instant one. The
> implementation uses **`behavior: "instant"`**, which is also what keeps this
> from introducing the page-wide scroll motion the cadence rejects.

### Also corrected

- **Every route reported the same title** "ScoutBoy — player discovery"
  (SC 2.4.2 Page Titled, **Level A**). Five segment `layout.tsx` files now
  declare distinct titles; the client pages are untouched, since a client
  component cannot export `metadata`.
- **The Methodology formula block scrolled horizontally but was not focusable**
  (SC 2.1.1 Keyboard, **Level A**; axe `scrollable-region-focusable`). Now
  `tabIndex={0}` with a group role and label.
- **No custom not-found route.** Next's default rendered a bare "404" under the
  generic title with no explanation or recovery. Replaced with ScoutBoy's own
  honest state.

## Documented exceptions

**None.** No axe rule is disabled, no region excluded, and
`REVIEWED_EXCEPTIONS` is empty.

Two behaviours are recorded as platform facts rather than exceptions:

- **Safari/WebKit excludes links from Tab order** unless the user enables full
  keyboard access. The cross-browser suite therefore asserts the skip link is
  focusable and reveals itself, rather than asserting Tab lands on it — testing
  Safari's default preference would not be testing ScoutBoy.
- **Forced-colours emulation is Chromium-only** in Playwright.

## Results by area

**Keyboard (Phase 4).** Skip link first and moves focus to `main`; no positive
`tabindex` on any surface; no traps; every focused control has non-zero size and
no transition on `outline`; role tabs support Arrow/Home/End with roving
tabindex, and the panel is the next stop; evidence groups focus and pin via
Enter; native `<details>` toggles from the keyboard; the mobile menu keeps
`aria-expanded` bound to real state and never strands focus in a hidden panel;
removing a focused saved player leaves focus on a connected node; no focused
control is fully obscured by the tray (D6).

**Screen-reader status.** **Not performed.** No assistive technology could be
driven from this environment. Programmatic semantics are verified — landmarks,
heading order, names/roles/states, `aria-current`/`pressed`/`expanded`/`selected`,
tablist relationships, live regions, decorative SVG hidden with text equivalents
present, and Label in Name — but that is not a substitute. A manual
VoiceOver + Safari pass remains outstanding and is listed under residual risk.

**Contrast and non-colour meaning (Phase 5).** Measured, not estimated. Text:
`--ink` 14.62, `--ink-muted` 6.89, `--ink-soft` **4.98** (was 4.01). Score bands
on paper: red 6.63, rust 6.53, amber 4.88, pitch 7.27, pitch-mid 4.72, elite-ink
**6.15** (was 3.94). Non-text: control borders **3.25** (was 1.89), focus ring
`--pitch` 7.27. Selection is never colour-alone — the selected role tab carries a
structural inset marker plus `aria-selected`; confidence and coverage carry text
in the accessible description; unknown evidence keeps a hatch, a dashed border
and the literal word "unknown".

**Target size (Phase 6).** Every button, link, select, input, summary and tab
audited against 24×24 with the inline-text exception applied. One failure (D5),
fixed. Mobile action rails verified at ≥44px at 320px.

**Zoom, reflow, orientation, text spacing (Phase 7).** No page-level horizontal
scrolling at 1280, 1024, 768, 640, 390 or 320 across Discovery, leaderboard,
Compare, My Favorites and Methodology. Dossier verified at 320 with no clipping.
Genuine 200% browser zoom checked manually in **both Chromium and WebKit** via a
`deviceScaleFactor: 2` 640×450 context, on Discovery, the dossier and the open
mobile menu. The WCAG 1.4.12 overrides (`line-height: 1.5`, `letter-spacing:
0.12em`, `word-spacing: 0.16em`, paragraph spacing `2em`) applied to all five
surfaces at 390 with no overflow and no clipped content.

**Motion and preferences (Phase 8).** The completed motion language was audited,
not redesigned. All durations ≤180ms; no layout property animated; no
`transition: all`; rapid interaction deterministic; under `reduce`, zero animated
elements and zero running animations on four surfaces, with `scroll-behavior:
auto`, immediate tray and menu, and immediate role changes. No accessibility fix
introduced shimmer, bounce, scale or route motion. Forced colours verified in
Chromium: focus indicators resolve to a non-zero outline and state remains
carried by ARIA rather than colour.

**Degraded data (Phase 9).** Loading, empty, search error, recovery, dossier card
error, role-audit error, unknown evidence group, missing market, long
identity/club/league/role names, zero favorites, stale saved ids, one-player
queue, and not-found. Each asserts honest explanation, no fabricated score or
zero, no raw `undefined`/`null`/`NaN`/`[object Object]`, correct status/alert
semantics, a recovery path, 320px reflow, and no unhandled console error.

**Interaction stress (Phase 10).** Rapid favourite toggling; compare
add/remove/replace; clear-then-reopen; repeated menu toggling; fast filter
changes; back/forward with URL-backed filters; reload with favourites and compare
persisted; rapid role switching; removing the focused saved player. No stale
analysis, ghost tray, duplicate menu, count/row mismatch, stranded focus or
runtime error.

## Browser matrix (Phase 11)

| Engine | Version | Result |
| --- | --- | --- |
| Chromium | 149.0.7827.55 | **9/9 pass** |
| WebKit | 26.5 | **9/9 pass** |
| Firefox | 151.0 | **9/9 pass** |

`pnpm e2e:cross-browser` — 27 executions. Flows: Discovery load and filtering,
dossier, role switching, evidence pinning, favourite persistence, compare queue,
completed comparison, mobile navigation, native disclosures, keyboard focus,
reduced motion, 320px overflow.

Manual **Safari + VoiceOver was not run** — see residual risk.

Unlike `make e2e` and `pnpm visual`, this matrix is **not** fixture-isolated: run
bare it starts the API with no `DATABASE_URL`, which falls back to
`sqlite:///./db/scoutboy.db`. That is tolerable here because every assertion is
about behaviour rather than about particular players — but it is recorded as a
limitation rather than presented as isolation.

## Visual baselines (Phase 12)

`playwright.visual.config.ts` + `tests/visual/`, deliberately **outside CI**
(see `tests/visual/README.md` for the rationale, commands and review procedure).
84 executions produce **59 baselines** across four projects; the remaining 25 are
skipped as inapplicable to their project and report a skip rather than a pass.

| Project | Baselines | Skipped |
| --- | --- | --- |
| `desktop-chromium` (1280×900) | 19 — 12 surfaces + 7 honesty states | 2 mobile-only |
| `desktop-webkit` (1280×900) | 12 surfaces | 2 mobile-only + 7 honesty states |
| `mobile-chromium` (390×844) | 14 surfaces incl. menu open and 320 | 7 honesty states |
| `mobile-webkit` (390×844) | 14 surfaces incl. menu open and 320 | 7 honesty states |

`maxDiffPixelRatio: 0.002`, retries off, animations disabled, fonts and motion
settled before capture. Exactly one documented mask (`page-meta`, a build
timestamp and rating version, both asserted textually elsewhere). No player name,
player datum or comparison panel is masked.

### Isolated fixture lifecycle

Every run of `pnpm visual` **and** `pnpm visual:update` goes through
`scripts/run_visual.sh`, which before Playwright starts:

1. creates a throwaway root with `mktemp -d` and installs a cleanup trap that
   removes only that directory, on success and on failure alike;
2. exports an isolated SQLite `DATABASE_URL` inside it, plus the test
   environment, API origin, web origin and `NEXT_PUBLIC_API_BASE_URL`;
3. runs `alembic upgrade head`;
4. ingests the committed `sample` provider;
5. recomputes ratings, playstyles and market values;
6. builds the production web app against the isolated API origin;
7. runs the visual config and forwards Playwright's exit status.

**The developer's `db/scoutboy.db` is never opened**: `DATABASE_URL` points inside
the throwaway root for every process in the run, and the file's SHA-256 and mtime
were unchanged across this whole session. Steps 1–6 are shared with
`make e2e` through `scripts/lib/fixture_env.sh`, so the two suites cannot drift
apart in how they seed data. `playwright.visual.config.ts` refuses to load unless
`SCOUTBOY_FIXTURE_ROOT` is set and `DATABASE_URL` points inside it, so the config
cannot be run bare.

This corrects a real defect. The previous arrangement started FastAPI with no
database preparation at all, so the API served whatever `DATABASE_URL` happened to
be in scope — in practice the local pilot database.

### Identity assertions

The no-shared-role scenario previously navigated to `/compare?a=6&b=17` and
trusted the primary keys. Those ids resolve to **Rui Salgado and Ismael Traoré**
in a freshly seeded sample database and to **Anton Keller and Karim Nasser** in
the local pilot database. The committed baselines therefore showed Salgado and
Traoré while the test's own comment named Keller and Nasser, and the audited run —
against the pilot database — rendered Keller and Nasser. All four
`comparison-no-shared-role.png` copies failed, which was test-data
nondeterminism rather than a visual change.

The scenario now selects **Anton Keller** and **Karim Nasser** by canonical name
through the real comparison `<select>` controls, and proves the following from
the compare response the UI actually rendered, before capturing anything:

- Player 1 is Anton Keller and Player 2 is Karim Nasser;
- both are genuinely rated in at least one role — an unrated player would reach
  the same neutral state for the wrong reason;
- their rated roles do not intersect (Keller: complete forward, inside forward,
  pressing forward, shadow striker; Nasser: ball-winning midfielder, deep-lying
  playmaker, tempo controller);
- the compare API therefore selected no role (`role_key` is `null`);
- the rendered surface shows both names and the neutral `No Shared Rated Role`
  state.

Nothing is intercepted or mocked: this is the real API answer for a genuinely
disjoint sample pair. The identities and assertions live in
`tests/visual/support/fixtures.ts`. Both failure modes were exercised
deliberately — a player who *does* share a role, and a player absent from the
cohort — and each fails with a message naming the players and the roles involved.

### Baselines regenerated

Four images, once, from the isolated fixture database, each reviewed by hand:

| Baseline | Reason |
| --- | --- |
| `desktop-chromium/comparison-no-shared-role.png` | fixture pair corrected to Anton Keller vs Karim Nasser |
| `desktop-webkit/comparison-no-shared-role.png` | same |
| `mobile-chromium/comparison-no-shared-role.png` | same |
| `mobile-webkit/comparison-no-shared-role.png` | same |

Every changed region is player data — names, club/league, market range and risk
tag, playstyle chips, evidence-context values, and the metric ledger's
first-name column headers. Page chrome, the `Role comparison` eyebrow, the
`No Shared Rated Role` heading, the explanatory note, the `why_higher` panel,
card geometry, hairlines, spacing and typography are pixel-identical. No design
drift.

The other **55 baselines were byte-identical** against the isolated fixture
database and were not rewritten, which is the strongest available evidence that
the committed set was already fixture-consistent and that only this one scenario
was wrong.

## Test commands

```bash
make e2e
```

```bash
pnpm e2e:cross-browser
```

```bash
pnpm visual
```

```bash
pnpm visual:update
```

`pnpm visual` compares against the committed baselines; `pnpm visual:update`
regenerates them and every rewritten image must be reviewed by hand. Both prepare
the isolated fixture database first, so `visual:update` can never capture the
developer's local or pilot data.

The CI-relevant suite (`make e2e`) carries all accessibility scans, semantic
assertions, keyboard/focus, target size, reflow, text spacing, degraded-state,
interaction-stress and console-error coverage. Only the screenshot comparison is
outside it.

## Dependency security — PostCSS

PostCSS reaches production resolution as a dependency of Next.js
(`apps/web > next@16.2.11 > postcss`), not through the workspace's own
devDependency, so it is in scope for `pnpm audit --prod`. The root package pins it
through a `pnpm.overrides` entry.

**GHSA-fxqj-rqcc-2cmp / CVE-2026-69153** — an incomplete fix of
GHSA-6g55-p6wh-862q, in which an attacker-controlled `sourceMappingURL` can read
arbitrary `.map` files when `from` is unset. It affects **all versions through
8.5.22** and is patched in **8.5.23**. The override was pinned at `8.5.18`, so the
production tree carried the advisory.

Because the advisory is rated *moderate*, the repository's required gate
`pnpm audit --prod --audit-level high` exited 0 throughout — which is why an
earlier "no known vulnerabilities" claim was recorded here while an unfiltered
`pnpm audit --prod` still reported the finding. That claim was inaccurate and has
been replaced.

**Remediation:** the override moved to `postcss@8.5.23` — the smallest patched
version — and `pnpm-lock.yaml` was regenerated through pnpm. The only knock-on
change is PostCSS's own transitive `nanoid` 3.3.15 → 3.3.17, forced by
resolution. Next.js, Playwright, Vitest, ESLint and every other package are
untouched. `pnpm why postcss --prod -r` confirms the override is applied
(`next 16.2.11 └── postcss 8.5.23`), the lockfile contains no remaining reference
to 8.5.18, and unfiltered `pnpm audit --prod` reports **no known
vulnerabilities**. Nothing was suppressed, muted or ignored.

## Validation results

All figures below were reproduced in the closeout-correction session; nothing is
carried over unverified.

| Gate | Result |
| --- | --- |
| `git diff --check` | clean |
| `pnpm install --frozen-lockfile` | already up to date |
| `pnpm --filter @scoutboy/web lint` | clean |
| `pnpm --filter @scoutboy/web typecheck` | clean |
| `pnpm --filter @scoutboy/web test run` | **284 passed** / 15 files |
| `pnpm --filter @scoutboy/web build` | success |
| `make e2e` | **175 passed** |
| `pnpm e2e:cross-browser` | **27 passed** (3 engines) |
| `pnpm visual` (fresh isolated DB) | **59 passed, 25 skipped** |
| `pnpm visual` (second, independently prepared DB) | **59 passed, 25 skipped** |
| `make lint-py` | clean — 141 files unchanged |
| `make test-py` | **264 passed, 1 skipped** |
| `make check-api-contract` | current, no drift |
| `pnpm audit --prod` | **no known vulnerabilities found** |
| `pnpm audit --prod --audit-level high` | **no known vulnerabilities found** |
| `docker compose -f docker-compose.full.yml config --quiet` | exit 0 |
| `make docker-smoke` | passed — build, `/healthz`, `/readyz`, web root |

The two `pnpm visual` runs each prepared their own throwaway database (distinct
`mktemp` roots) and left every tracked baseline byte-identical. `db/scoutboy.db`
kept the same SHA-256 and mtime across the whole session, and no temporary root
survived — including after deliberately failed runs. Of the gates above, only
`pnpm e2e:cross-browser` reads that database at all, and only for reading.

## Environmental limitations

- **No assistive technology** could be driven. VoiceOver/NVDA/JAWS verification
  was not performed and is not claimed.
- **Forced-colours emulation is Chromium-only**; WebKit and Firefox skip that
  check and say so rather than reporting a pass.
- **Real 200% browser zoom** was approximated with a `deviceScaleFactor: 2`
  context at 640×450 (the CSS-pixel equivalent) in Chromium and WebKit. A true
  OS-level browser-zoom pass on physical hardware was not possible headlessly.
- **Visual baselines were generated on macOS.** They will not match a Linux CI
  runner without regeneration — the reason the suite is excluded from CI. This is
  ordinary font rasterization, not a defect to fix.
- **The visual suite needs the local toolchain**, not just Node: it runs Alembic,
  the ingest and recompute jobs from `.venv`, and a full production Next.js build
  before Playwright starts. Each run therefore costs a build, which is another
  reason it is a deliberate local/release-review gate rather than a per-push one.

## Residual risks

1. **No screen-reader pass.** The highest residual risk. Semantics are correct
   programmatically, but only a real AT session can confirm the *experience* —
   announcement order, verbosity, whether the compound coverage/confidence unit
   reads naturally. A manual checklist is the natural next step.
2. **Load-related flake under full-suite parallelism.** `motion.spec.ts` › "the
   reported count and the visible rows never disagree" has previously timed out
   waiting for the results ledger against the single-worker SQLite API. It did
   **not** recur in this session's `make e2e` run. Not a product defect; CI
   retries once.
3. **Honesty states depend on interception.** The sample cohort has 29 audit
   groups with zero null scores, so unknown-evidence and most degraded states are
   only reachable via response interception. The no-shared-role state is the
   exception — a genuinely disjoint sample pair (Anton Keller vs Karim Nasser),
   selected by name and asserted before capture — and is used directly.
4. **`--line-strong` darkened product-wide.** Justified by measurement, but it
   changes the perceived weight of every hairline-bounded control slightly. The
   visual baselines now pin that appearance.
5. **The focus nudge is the one piece of focus-management JavaScript** in the
   product. It is scoped to the tray's lifetime and to genuine overlap, but it is
   behaviour that did not previously exist.
6. **Baseline drift.** 59 images require human review on every intended visual
   change; if that discipline lapses the suite becomes noise.
7. **Fixture identity is only asserted where it matters.** The no-shared-role
   scenario now proves who it is looking at, but the remaining visual scenarios
   still address players positionally ("the first result", "option 1 and option
   2"). That is deterministic against the isolated fixture database and is why the
   other 55 baselines were byte-identical, but it is ordering-dependent rather
   than identity-asserted, so a future change to the default sort would show up as
   a baseline diff to review rather than as a named failure.

## Dark mode

**Deferred and untouched.** The isolated pilot under
`apps/web/src/app/design-pilots/dark-mode/` and `docs/design_pilots/` was neither
expanded, integrated, redesigned nor deleted. It carries its own complete
`.pilot-*` vocabulary and uses no production primitive, so none of the token
corrections in this closeout reach it, and it is excluded from the accessibility
scans by not being scanned — not by a selector exclusion.

## Milestone completion decision

**Milestone 7 is complete.**

Every completion criterion is met: the scrolling prerequisite was present; no
known WCAG 2.2 Level A or AA failure remains on a production surface; automated
scans pass with no disabled rules; mandatory keyboard flows pass; focus is not
obscured; target sizes pass with no exception claimed; 320px reflow passes;
200% zoom was checked in two engines; degraded-data states pass; Chromium, WebKit
and Firefox functional coverage passes; the curated visual set is fixture-backed,
reviewed and stable across two consecutive runs from independently prepared
databases; the production dependency audit is clean; reduced motion remains
complete; and all repository validation gates pass.

The one substantive gap — **manual screen-reader verification** — is recorded
above as an environmental limitation and a residual risk rather than as a
satisfied criterion. It is not claimed as passed.
