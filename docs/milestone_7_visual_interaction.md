# Milestone 7 — Visual & Interaction Design (Recruitment Desk)

**Status: Cadence 2 (dossier) complete; Cadence 3 (Cross-Surface Extension) implemented
and self-verified — still NOT the completion of Milestone 7.**
Cadence 2 implemented the approved visual direction on the **player dossier**
(`apps/web/src/app/players/[playerId]/page.tsx`). Cadence 3 (documented in
[Cross-Surface Extension](#cross-surface-extension-cadence-3) below) extends the same
visual and information grammar across discovery, the role leaderboard, comparison, the
shortlist, methodology, navigation, and the shared loading/empty/missing/error states.
The dedicated motion pass and a comprehensive accessibility/visual-regression audit
remain out of scope, so Milestone 7 is not yet fully complete.

## Approved thesis

> A quiet printed recruitment desk with one living, evidence-honest pitch.

Direction B's information structure (a role-driven, two-pane analysis desk) executed in
Direction A's visual restraint (the existing warm-paper / serif-identity / restrained
pitch-green / hairline editorial language). The dossier is reorganised around a **role
selector** that drives a single signature element — an **illustrative Role Territory
pitch** — supported by an evidence/context rail.

## What is preserved

- Warm paper, ink, restrained pitch-green, hairline borders; serif-for-identity,
  sans-for-interface, mono-for-figures.
- All existing RoleFit results, role ratings, playstyles/concerns, market, context,
  strengths, sub-stats, similar players, sources, and the full audit trail — still
  present beneath the desk.
- Anti-fabrication behaviour: profile-only players show identity/context/market/sources
  and the explicit "Detailed RoleFit analysis unavailable" notice, with **no** role
  selector and **no** Role Territory.
- Missing data renders as **unknown, never zero** (formatter sentinels `—` / `unknown` /
  `Unknown` / `Selective` retained; unknown audit groups render a hatched marker + the
  word "unknown").
- Existing shortlist / compare actions, confidence & coverage disclosures, reduced-motion
  kill-switch, focus-visible ring, and skip link.
- Desktop navigation is visually unchanged.

## What changed in the vertical slice

- New two-pane **Recruitment Desk** (`RecruitmentDesk.tsx`): left rail = compact identity,
  selected-role summary (score, best indicator, confidence, evidence status) and an
  expandable evidence/context/market summary; right canvas = role selector, Role
  Territory, supporting group evidence, and the selected role's explanation/penalties.
- `RoleSelector.tsx` — accessible WAI-ARIA **tabs** for choosing the active role.
- `RoleTerritory.tsx` — the illustrative pitch + legend + permanent disclosure + a native,
  keyboard-operable supporting-evidence list.
- `ConfidenceMeter.tsx` — a reusable confidence primitive (applied only in this slice).
- Below the desk, the existing panels are preserved; face stats are relabelled as
  "General profile · not role-specific" to distinguish them from role-specific evidence.
- A minimal, accessible **mobile navigation** toggle (`NavBar.tsx`) so the wrapping nav no
  longer buries the 390px dossier. Desktop nav is unchanged (`md:` and up).
- One new CSS token + class (`--elevation-territory`, `.territory-surface`) for the single
  sanctioned elevated surface.

## Authoritative audit-data rule (no recomputation)

Selected-role visuals are driven **directly** by the production audit from
`GET /players/{id}/ratings`. For the selected role the UI:

1. finds the existing `RoleRatingSummary` (score, confidence, is_best, rank);
2. finds the `AuditBreakdown` with the same `role_key`;
3. renders the stored `metric_breakdown.groups[]` (`key`, `weight`, `normalized_weight`,
   `group_score`, `metrics[].{display, score, present}`), `confidence_breakdown`,
   `penalties`, and `explanation_text`.

The frontend **only selects, orders, formats, labels, and visualises** stored values
(`lib/audit/roleAudit.ts` is pure selection/sorting). It never multiplies, renormalises,
averages, or reconstructs a RoleFit score or group contribution, never imports the rating
formula, and never reads `configs/roles/`. `face_stats` are treated as broad, non-role
profile averages and are **not** used to drive the territory. If a selected role's audit is
absent, an honest "unavailable" state is shown — never a derived approximation.

## Illustrative Role Territory disclosure

Rendered permanently as visible text beside the pitch (never a tooltip):

> Illustrative role territory derived from RoleFit evidence groups. Not tracking or
> event-location data.

The pitch is an abstract tactics-board illustration: labelled score markers in abstract
thirds/box zones. No player-location dots, movement trails, density blobs, or event
markers; no coordinates are inferred or synthesised.

## Presentation-only territory mapping

`lib/territory/roleTerritoryMap.ts` maps audit **group keys** to abstract pitch zones
(`att_box`, `att_third`, `mid_third`, `def_third`). This is presentation placement only —
it has no effect on any score, weight, or ranking, is clearly named/commented, and is not
rating configuration.

- Defensibly spatial groups map to a zone (e.g. `box_presence → att_box`,
  `shot_threat → att_third`, `progression → mid_third`,
  `defensive_contribution → def_third`).
- Spatially ambiguous or explicitly non-spatial groups map to `null` and are **not** placed
  on the pitch (e.g. `possession_security`, `finishing_confidence`, `shot_volume`,
  `creation`, `shot_creation`, `duels`, `aerial_hold_up`). Unmapped/future keys also return
  `null`.
- **Every** selected-role group is shown in the supporting-evidence list; non-spatial ones
  are labelled "Not shown on pitch · non-spatial evidence". Unknown/unmapped groups are
  never silently discarded. A test enforces that all selected-role groups remain visible.

### Limitations of the mapping

- Zones are illustrative bands, not measured positions; there is no left/right (lateral)
  channel because ScoutBoy has no such evidence to justify it.
- A concept that spans a region is placed in its single most representative band; the
  choices are documented inline in the map.

## Magnitude vs. confidence vs. importance vs. unknown (separate channels)

- **Score magnitude** — stored `group_score`; controls a pitch marker's green fill
  intensity and a labelled magnitude bar. Numbers use the existing score colour scale.
- **Role importance** — stored `normalized_weight`; controls list ordering, an explicit
  "Role weight N%" label, and marker border weight. Never multiplied into the score.
- **Role-level confidence** — `RoleRatingSummary.confidence` (with the audit's stored
  `confidence_breakdown.score` shown as an optional secondary value). Rendered in a
  separate monochrome glyph+word `ConfidenceMeter`, never via the magnitude palette. No
  group-level confidence is invented (the API does not provide one).
- **Unknown** — `group_score === null` / `metrics[].present === false`; rendered as a
  labelled hatch and the word "unknown", never zero.

A low-confidence high score therefore still reads high in magnitude while reading uncertain
in reliability (the pitch frame also becomes dashed with a "directional, not definitive"
caption at low/unknown confidence).

## Responsive rules

- **Desktop ≥1024px** — two-pane grid (evidence rail + analysis canvas).
- **Tablet ~768px** — deliberately stacked (no cramped pseudo-desktop rail); role selector
  sits directly above the canvas.
- **Mobile ~390px** — single column in the order: compact identity + selected-role summary
  → role selector → Role Territory + disclosure → supporting evidence → expandable
  evidence/context → remaining dossier. The role selector is a compact, equal-width,
  horizontally scrollable single row (not sticky — see Phase 2 corrections), so it never
  overlays the territory heading or focused evidence.
- **Narrow ~320px / 200% zoom** — the same single column with no horizontal page overflow;
  only the role-selector row scrolls horizontally within itself.

## Accessibility

- Role selector is a WAI-ARIA tablist with full keyboard support (Arrow/Home/End, roving
  tabindex, `aria-selected`, `aria-controls`); the panel is a labelled `tabpanel`.
- The pitch SVG is decorative (`aria-hidden`); all evidence is available as text in the
  native, focusable supporting-evidence buttons (available without hover; hover/focus only
  adds a visual highlight).
- A polite live region announces the newly selected role plus its stored RoleFit
  score/confidence.
- Confidence uses text + a monochrome glyph (works without colour); focus-visible ring and
  reduced-motion behaviour are inherited; transitions are ≤200ms and swap immediately under
  `prefers-reduced-motion: reduce`. Content reflows at 200% zoom without horizontal page
  scroll.

## Loading / missing / error behaviour

- Player card loading / failure — existing `Loading` / `ErrorState`.
- Rating-audit loading — a structural territory placeholder (no fabricated values).
- Rating-audit failure while the card succeeds — an honest "Role evidence unavailable"
  notice; identity, summary, context, and market remain usable (the dossier is not hidden
  behind the audit request).
- Selected-role audit unexpectedly absent — honest "unavailable" notice, no approximation.
- Profile-only — no desk, no pitch; existing anti-fabrication behaviour.
- Missing market / empty playstyles / unknown group / long content — honest fallbacks.

## Fixtures & test data

The production sample dataset was **not** changed. Profile-only, low-confidence,
missing-market, and unknown-group states are exercised via typed component fixtures and
Playwright API-route interception that lightly edits the real response shapes.

## Current exclusions / deferred (Cadence 3+)

- ~~Applying the desk language and confidence primitive to discovery, leaderboards, compare,
  shortlist, and methodology.~~ **Done in Cadence 3 — see
  [Cross-Surface Extension](#cross-surface-extension-cadence-3).**
- Deciding whether the public demo cohort should include deliberately varied synthetic
  profiles so these honesty states are demonstrable without mocking.
- Any lateral (left/right) territory nuance, richer motion, or territory tuning.
- The dedicated motion pass and a comprehensive WCAG / cross-platform visual-regression audit.

## Phase 2 corrections

A correction pass on the first Recruitment Desk / Role Territory implementation.

**Repaired two-column composition.** The desktop left rail (identity → selected-role
summary → evidence/context) is now one contiguous column that flows independently of the
right analysis canvas. The earlier CSS-grid spanning-row layout let the tall canvas stretch
the left rows and push the evidence panel ~483px below the summary; the rail is now a
`display:contents`-on-mobile / `flex`-column-on-desktop wrapper, so the evidence panel sits
~24px below the summary on desktop while the mobile order (identity → canvas → evidence)
is preserved via `order`.

**Responsive, symmetrical selector.** Role tabs are dimensionally uniform within a
breakpoint — an equal-column grid on tablet/desktop and an equal-width, horizontally
scrollable single row on mobile/narrow. The selected state changes colour/border/inset-rule
only, never size. The inline "best" badge was removed from the compact selector (it widened
one tab); the best role is disclosed in the selected-role summary and the peer-ranked roles
section. Mobile stickiness was removed because a non-obscuring sticky footprint was not
reliably achievable; the selector stays compact and near the top instead.

**Score-colour bands (with elite blue).** `scoreColor()` is now a single deterministic band
function (`scoreBand`) driving both text and bar fill via named classes:
`< 40` red, `40–54.99` rust, `55–69.99` amber, `70–79.99` clear green, `80–89.99`
chromatic emerald (`pitch.mid #0f7a5f`), `>= 90` elite blue (`#2e74e6`), `null` neutral
grey (unknown). 70+ is a clear green rather than the previous desaturated sage, and 80–89
is a chromatic emerald rather than a near-black deep green so strong scores read clearly
green. Confidence keeps its own separate monochrome channel — the score palette is never
applied to confidence.

**Recognisable pitch.** The Role Territory is a green field with white markings (boundary,
halfway line, centre circle + spot, both penalty areas, six-yard boxes, penalty spots,
penalty arcs, goals) and restrained solid mowing bands (no gradients). Each spatial group
is a **translucent green territory highlight** (opacity scales with the stored group score
— brighter = higher) with its short label + score in light text directly over it; the white
markings read through every zone. Several groups in one third sit as adjacent translucent
columns, never stacked opaque boxes. Unknown groups render a hatched "?" zone (never zero).
On desktop the pitch and the evidence list sit side by side so a highlight is visible; on
mobile the textual evidence list is fully self-sufficient. No position markers (LW/AM/CM)
and no licensed-data claims are used; the permanent illustrative disclosure is unchanged.
Low selected-role confidence is communicated via the reliability meter + a caption — the
physical pitch lines are never dashed for confidence.

**Market valuation chart.** `MarketValuePanel` is now a shared-euro-axis comparison built
with native SVG: a public-value point, a model interval, and a visually distinct expected-
ask interval, plus a legend carrying every exact value, the market label, valuation
confidence, and a transparently-labelled asking-vs-model-ceiling gap interpretation. Axis
bounds/ticks are derived deterministically for display only; missing reads render as
"unknown" (never plotted at zero); only-public / only-model / all-missing / equal-endpoint
cases are handled; the manual-review guardrail stays prominent; and the panel fits 390px
without horizontal scroll.

**Visible keyboard focus.** The analysis `tabpanel` no longer suppresses focus
(`focus:outline-none` removed); it shows the standard focus-visible ring, verified by an
end-to-end keyboard test.

**Leaderboard link.** The ambiguous "board" link is now "View leaderboard →" with a
role-specific accessible name (e.g. "View the Shadow Striker leaderboard").

**Regression coverage.** Playwright now asserts the contiguous desktop rail, equal tab
dimensions, non-sticky/non-obscuring mobile selector, no horizontal overflow at 320/390,
visible panel focus, and the mobile nav toggle — the classes of defect found in the first
pass. Unit tests cover every score-band boundary and the market chart's axis/gap maths.

### Correction round 2 (translucent pitch, labels, partial ranges)

- **Translucent pitch** replaces the opaque score plaques (see the updated "Recognisable
  pitch" note above).
- **80–89 green** changed from near-black `pitch.dark` to chromatic emerald `pitch.mid`.
- **Title Case headings** across the profile (Face Stats, Peer-Ranked Roles, Playstyles &
  Concerns, Market Value, Context & Coverage, Strengths & Concerns, Sub-Stats, Complete
  Audit Trail, Similar Players, Sources Version & Limitations, Role Territory, Evidence &
  Context, Why This Score) while preserving ScoutBoy / RoleFit / U23 / acronyms and never
  title-casing prose or player names.
- **Centralized enum → display labels** (`confidenceText`, `marketLabelText`,
  `evidenceStatusText`, `tierText`) so chips read High / Inflated / High-Risk / Best /
  Best-Rated Role / Profile Only / Elite, and audit role/group keys render Title Case
  (e.g. Complete Forward), with capitalized `Why This Score` / `Hide`. Backend enums
  unchanged.
- **Coverage vs confidence** on search cards is now labelled explicitly ("Evidence: …" and
  "RoleFit confidence: …"), wrapping cleanly at 390 px, with no bare `High`.
- **Market copy** no longer says "independent": "Public value, model range, and expected ask
  on a shared euro axis."
- **Partial market ranges** preserve whichever endpoint exists — `From €X` / `Up to €Y` /
  `Unknown` — in the legend, an open one-sided marker on the chart, and the accessible
  summary; a missing endpoint is never plotted at zero.

### Correction round 3 (desk fill, square bars, market parity)

- **Desk composition** — the analysis is a three-column grid (`.desk-analysis`): the
  evidence/context rail bottom-aligns with the pitch, the trait list spans both rows, and
  **Why This Score** fills the space beneath the rail + pitch down to the trait list's
  bottom. The pitch and evidence list are split (`RoleTerritoryPitch` + `RoleEvidenceList`
  sharing `useTerritoryHighlight`) so they can occupy separate columns while hover/focus/pin
  stay in sync. Verified: evidence-bottom = pitch-bottom, why-bottom = trait-list-bottom.
- **Square progress bars** — all fill bars (Face Stats, Peer-Ranked Roles, the trait list,
  and the market intervals) are boxy rectangles; colours unchanged.
- **Market vs Context parity** — the two boxes are exactly equal height (grid `items-stretch`
  + `h-full` cards). Market Value is elongated with a taller, thicker box-plot and an inline
  "Why This Valuation" (no dropdown), with the disclaimer anchored to the card's bottom.

## Cross-Surface Extension (Cadence 3)

**Status: implemented and self-verified; NOT the completion of Milestone 7.** This cadence
extends the approved visual and information grammar from the dossier across discovery, the
role leaderboard, comparison, the shortlist, methodology, navigation, and the shared
loading/empty/missing/error states. It is the **static** cross-surface hierarchy and
responsive extension — the dedicated motion pass and a comprehensive WCAG /
visual-regression audit remain out of scope (see remaining work below).

The dossier and Role Territory are unchanged; **Role Territory remains the only elevated
surface** (every new component is flat + hairline). No backend, schema, YAML, calibration,
or sample-data changes were made.

### Shared presentation layer

A few narrow, semantic primitives (in `components/common/index.tsx`) — deliberately **not**
one universal card, so surfaces stay unified in treatment while remaining structurally
distinct:

- `PageHeader` — the shared page introduction (eyebrow + serif title + lead + a
  dot-separated metadata line + an optional right-aligned control).
- `ScoreReadout` — band-coloured score magnitude via the centralized `scoreBand`; renders
  the `—` sentinel for missing, never zero.
- `ConfidenceReadout` — RoleFit confidence in its own monochrome `ConfidenceMeter` channel
  with an explicit "RoleFit confidence" label.
- `EvidenceTag` — the evidence-coverage label (`evidenceStatusText`), a channel distinct
  from confidence.
- `MarketReadout` — an honest market label chip + expected-asking range that preserves
  partial ranges (`From €X` / `Up to €Y`) and never renders €0.
- `LedgerSkeleton` — a structural loading placeholder that preserves layout with neutral
  bars (no fabricated values) inside a polite `role="status"` live region.
- Status semantics: `Loading` / `LedgerSkeleton` / `EmptyState` are `role="status"`;
  `ErrorState` and a critical `Notice` are `role="alert"`.

Evidence rules preserved on every surface: score magnitude, RoleFit confidence, evidence
coverage, and market uncertainty stay **separate channels**; missing data is neutral and
explicitly labelled, never zero or weak performance; confidence never uses the score
palette; every state communicates through text/symbol as well as colour.

### Per-surface job & structure

- **Discovery — filter rail + results ledger.** A subordinate hairline filter rail (query
  field leading; dimensionally-stable scope/age controls) beside a compact scouting ledger
  on desktop; stacked above the ledger on tablet/mobile. Rows follow the fixed reading
  order: identity → best RoleFit role/score → evidence coverage → RoleFit confidence →
  market → playstyles → actions. Profile-only rows never receive a fabricated
  score/confidence or empty analytical badges. URL-synced filters unchanged.
- **Leaderboard — role masthead + ranked ledger.** A restrained masthead (role selector +
  cohort context from the previously-underused `display_name`, `description`,
  `position_group`, `season`, `total`, `rating_version`) over a genuine desktop ranking
  table — rank, identity, score, explicit **"RoleFit Confidence"** via `ConfidenceMeter`,
  playstyles, expected asking, actions — that becomes a linear ranked ledger on mobile.
  Evidence coverage is deliberately **not** shown here: the ranking-row contract does not
  provide it.
- **Compare — two-sided balance sheet.** A full-width role spine over two equal player
  columns divided by a central rule; each side's stored RoleFit score + role-level
  confidence, with an explicit "Not rated in this role" state when a side lacks the
  selected role; `why_higher` as the main editorial conclusion; confidence warnings as
  labelled caution notices (not bare amber text); parallel market/playstyles; a compact,
  parallel **evidence-context summary** per side; and the stored normalized metrics
  re-presented as an aligned three-column ledger (mobile: label + both values) with
  `Unknown` for null scores. The default role option is the honest **"Automatic role"**
  (renamed from "Best shared"); its helper text now states the real backend fallback —
  *the explicitly requested role, else Player A's `best_role`, else Player B's* — so an
  automatic selection may honestly leave one side "Not rated in this role" without
  contradictory copy (it is **not** a "most comparable" or shared-role search). The
  evidence-context summary reports only fields each side's `CompareSide.context` actually
  supplies (minutes, appearances/starts, matches/competition coverage, sample confidence,
  coverage/overall-evidence confidence, data source/type, translation risk/limitations);
  nothing is recomputed, combined, or graded, a genuine numeric zero is preserved, missing
  fields are omitted, long source/limitation/translation-risk text wraps, and an absent
  context object shows an explicit "Evidence context unavailable" fallback (flat + hairline,
  no new elevated surface). No RoleFit is recomputed and no metric categories are invented.
- **Shortlist — saved-decision ledger.** A distinct flat **card grid** (not a ranking
  table) of retained decisions: resolved count + "saved on this device" disclosure, best
  stored score/role when available, RoleFit confidence, evidence status, expected asking, a
  few playstyles, and compare/remove actions. Profile-only and missing market stay
  explicit; stale saved ids keep their removal path; the empty state links back to
  discovery. Browser-backed order preserved.
- **Methodology — verification document.** A static **"Verify"** contents index beside the
  document on desktop (anchor links, no accordion/animation), stacked on mobile. Distinct
  areas for the formula + version ledger (formula contained in an internally-scrolling
  block), calibration + evidence (textual, non-colour-dependent pass/warn/fail/inconclusive;
  synthetic-fixture + real-pilot limitations kept prominent), context adjustments, a **flat
  role registry grouped by position family** (descriptions + stored group weights kept),
  playstyles/concerns, data sources, and limitations. `last_updated` is shown with an honest
  fallback. Technical identifiers/hashes/versions are untouched, and sources/limitations are
  never hidden behind a disclosure.
- **Navigation & global states.** IA and destinations preserved; the inline links switch to
  the existing hamburger at `lg` so labels + the shortlist counter never wrap awkwardly;
  active/hover/pressed/focus/disabled stay distinguishable without dimension changes (a
  colour-only `.btn:active` was added). Every surface keeps its identity while its data
  loads or fails — the header/filters/selector stay put and only the data pane swaps
  (methodology no longer blanks the whole page on load/error).

### Responsive behaviour

Desktop uses side-by-side structures (discovery rail + ledger, methodology contents + doc,
compare spine, leaderboard table); tablet/mobile stack. Verified with **no page-level
horizontal overflow at 1440, 1024, 390, and 320**; the one piece of intentional local
scrolling (the methodology formula) is contained within its own block.

### Test coverage added

- **Component (Vitest, `cross-surface.test.tsx`, `leaderboard.test.tsx`, extended
  `methodology.test.tsx`):** discovery rows (low-confidence, missing/partial market, empty
  playstyles) + results-pane loading/empty/error; leaderboard masthead metadata, the
  "RoleFit Confidence" label, missing asking range, empty rows, loading identity; compare
  shared role, missing selected-role rating, confidence-warning notices, null metric scores,
  missing market, long names; shortlist empty/resolved/profile-only/missing-market/stale
  ids; methodology calibration available + inconclusive, the flat role registry, contained
  formula, sources/limitations visibility, `last_updated` fallback; and the shared
  readout/status primitives' semantics + honest copy. (Web unit suite: 87 tests.)
- **E2E (Playwright, `cross-surface.spec.ts`):** the main scouting flow is preserved; new
  coverage of discovery filter/result behaviour, desktop-table + mobile-ledger leaderboard,
  the populated balance sheet and an **intercepted** missing-role comparison, the shortlist
  add/revisit/remove flow, the methodology calibration disclosure, mobile navigation,
  visible keyboard focus, and 320/390 page-overflow assertions. Rare honesty states use
  API-response interception; the production sample data was not changed. (E2E suite: 25
  tests.)

### Remaining (deferred) work

- The dedicated **motion pass** (intentional entrances/emphasis, reduced-motion tuning).
- A comprehensive **WCAG audit** and any resilience hardening beyond this baseline.
- Final cross-platform **visual-regression** coverage (kept out of CI as brittle snapshots).
- Whether the public demo cohort should include deliberately varied synthetic profiles so
  the honesty states are demonstrable without mocking (open since Cadence 2).

## Known limitations

- The territory is illustrative and coarse (thirds + box) with no lateral placement; it is
  not, and must never be presented as, positional/tracking data.
- Because the sample dataset contains only analyzed, high-coverage, mostly high-confidence
  players, several honesty states (profile-only, low/unknown confidence, missing/partial
  market, missing shared role) are currently only visible via component fixtures and
  Playwright response-interception across every surface — not in the live demo cohort.
- Cadence 3 delivers the **static** cross-surface hierarchy and responsive extension. The
  dedicated motion pass and a comprehensive accessibility/visual-regression audit are still
  outstanding, so this is **not** the completion of Milestone 7.
