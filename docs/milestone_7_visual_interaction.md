# Milestone 7 — Visual & Interaction Design (Recruitment Desk)

**Status: Cadence 2 (dossier) complete; Cadence 3 (Cross-Surface Extension) and Cadence 4
(static visual correction) implemented and self-verified — still NOT the completion of
Milestone 7.**
Cadence 2 implemented the approved visual direction on the **player dossier**
(`apps/web/src/app/players/[playerId]/page.tsx`). Cadence 3 (documented in
[Cross-Surface Extension](#cross-surface-extension-cadence-3) below) extends the same
visual and information grammar across discovery, the role leaderboard, comparison, the
shortlist, methodology, navigation, and the shared loading/empty/missing/error states.
Cadence 4 (documented in
[Static visual correction](#static-visual-correction-cadence-4)) corrects the Discovery
filter/results composition, takes the production corner language to a literal 90 degrees, and
normalizes comparison copy. **Dark mode and the dedicated motion pass remain deferred**, and a
comprehensive accessibility/visual-regression audit is still out of scope, so Milestone 7 is
not yet fully complete.

## Approved thesis

> A quiet printed recruitment desk with one living, evidence-honest pitch.

Direction B's information structure (a role-driven, two-pane analysis desk) executed in
Direction A's visual restraint (the existing warm-paper / restrained pitch-green / hairline
editorial language). The dossier is reorganised around a **role selector** that drives a
single signature element — an **illustrative Role Territory pitch** — supported by an
evidence/context rail. The typographic identity was later unified onto one modern sans
family (see [Typography](#typography-warm-paper-editorial-restraint-in-one-sans-family)).

## What is preserved

- Warm paper, ink, restrained pitch-green, hairline borders; one proportional family for
  identity and interface, mono-for-figures.
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
- **Dark mode.** An isolated pilot lives at `apps/web/src/app/design-pilots/dark-mode/` with
  its notes in `docs/design_pilots/`. It is deliberately quarantined from the production
  product — not expanded, integrated, or deleted — and is excluded from production-wide
  passes such as the Cadence 4 square-corner migration.

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

- `PageHeader` — the shared page introduction (eyebrow + title + lead + a dot-separated
  metadata line + an optional right-aligned control).
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
  on desktop; stacked above the ledger on tablet/mobile. Row composition and hierarchy were
  subsequently corrected — see [Discovery ledger correction](#discovery-ledger-correction)
  below. Profile-only rows never receive a fabricated score/confidence or empty analytical
  badges. URL-synced filters unchanged.
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
  (renamed from "Best shared"); it selects **symmetrically from shared rated roles only**
  (policy below), and its helper text states exactly that: *"Chooses the shared rated role
  where both players have the strongest joint fit."* The evidence-context summary reports
  only fields each side's `CompareSide.context` actually
  supplies (minutes, appearances/starts, matches/competition coverage, sample confidence,
  coverage/overall-evidence confidence, data source/type, translation risk/limitations);
  nothing is recomputed, combined, or graded, a genuine numeric zero is preserved, missing
  fields are omitted, long source/limitation/translation-risk text wraps, and an absent
  context object shows an explicit "Evidence context unavailable" fallback (flat + hairline,
  no new elevated surface). No RoleFit is recomputed and no metric categories are invented.
  - **Automatic role — shared-role candidates only.** When no `role_key` is requested,
    `compare_service._select_automatic_shared_role` intersects the two players' stored
    `role_ratings` and may only choose a role **both** players are already rated in. The
    superseded *Player A's `best_role`, else Player B's* fallback is gone: an automatic
    selection can no longer be one player's role that the other has never been rated for,
    and it is never order-dependent.
  - **Deterministic maximin / joint-fit ordering.** Over the shared candidates, using each
    role's **stored** `final_score`: (1) highest `min(a_score, b_score)` — maximise the
    weaker player's role fit; (2) highest `a_score + b_score` — prefer the stronger joint
    fit when the floor ties; (3) highest minimum **stored** confidence, as a tie-break only;
    (4) lexicographically ascending `role_key` as the final deterministic tie-break. The
    policy is symmetric by construction, so swapping Player A and Player B cannot change
    the selected role. It is deliberately **not** "smallest score difference", which could
    pick a role both players fit poorly.
  - **No shared rated role.** When the intersection is empty and no role was requested, the
    comparison still returns **HTTP 200** with `role_key`/`role_display` `null`, an empty
    `role_comparison`, and the honest conclusion *"No shared rated role is available for
    these players. Select a role to inspect the available analysis."* The surface shows a
    central **"No Shared Rated Role"** heading and that explanation; because no role was
    selected, neither side is labelled "Not rated in this role" and no score or role
    confidence is fabricated. Both player sides, normalized stat rows, market, evidence
    context and confidence warnings stay usable, and an explicit role can still be picked
    from the same selector. An **explicitly requested** role is never replaced by automatic
    selection and keeps the existing "Not rated in this role" state for an unrated side.
  - **Stored ratings only.** The selector is a presentation/comparison choice over already
    persisted ratings — it reads `final_score` and `confidence` as stored and **does not
    recompute, blend, or derive RoleFit**. No new comparison score, overall, similarity
    model, or weighted average is introduced, and no stored rating is modified.
- **Shortlist — saved-decision ledger.** A flat card grid of retained decisions: resolved
  count + "saved on this device" disclosure, best stored score/role when available, RoleFit
  confidence, evidence status, expected asking, a few playstyles, and compare/remove
  actions. Profile-only and missing market stay explicit; stale saved ids keep their removal
  path; the empty state links back to discovery. Browser-backed order preserved.
  **Superseded:** this surface is now `Saved Players` on the shared ledger — see
  [Ledger alignment & My Favorites](#ledger-alignment--my-favorites).
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

## Discovery ledger correction

**Status: implemented and self-verified; NOT the completion of Milestone 7.** A contained
correction to the **discovery result row**. The dossier, leaderboard, comparison and
methodology compositions are unchanged, Role Territory remains the only elevated surface, and
no backend, schema, YAML, calibration or sample-data changes were made. Nothing is recomputed
in the frontend. **My Favorites was subsequently brought onto this same row language — see
[Ledger alignment & My Favorites](#ledger-alignment--my-favorites) below.**

### Information hierarchy

The row is one entry of a continuous ranked ledger — not an isolated card, and not a nested
collection of cards. Reading order:

1. **Player information** — name; age · position · club; league · season · minutes.
2. **RoleFit hero** — the compact `RoleFit` eyebrow, the band-coloured score at the largest
   type in the row, and the selected/best role directly beneath it. Hierarchy comes from
   alignment, size and whitespace plus one restrained hairline divider — there is no
   surrounding box or nested card.
3. **Compound coverage/confidence status**, then **market status**, then a **dedicated
   playstyle line**.
4. **Action rail** — favourite and compare.

Desktop (`lg` and above) lays 1+3 as one column, the hero as a second column vertically
centred against the row's useful height, and the rail as a third full-height column. This is
a named-area CSS grid (`.ledger-row` in `globals.css`), so the mobile identity/RoleFit header
wrapper can dissolve with `display: contents` without changing placement. The hero and rail
tracks are fixed widths (see [Ledger alignment & My Favorites](#ledger-alignment--my-favorites)).

### Grouped but distinct coverage and confidence

`CoverageConfidenceStatus` (now in `components/common/LedgerRow.tsx`, shared by discovery and
My Favorites) replaces the two prefixed readouts (`Evidence:` / `RoleFit confidence:`) with one
sharp-edged unit holding two adjacent facts at equal typographic weight, separated by a plain
rule:

`High Data Coverage | ▮▮▮ High Confidence`

They are grouped for scanning but never collapsed into one inferred status:

- the coverage segment comes from `evidence_status` (`coverageStatusText`);
- the confidence segment comes independently from `confidence`, through the existing
  monochrome `ConfidenceMeter` — never recoloured with the score palette;
- so high coverage says nothing about confidence, and a mismatch (high coverage + low
  confidence) stays visible as two facts;
- unknown coverage and unknown confidence are explicitly neutral, never zero or "low";
- profile-only rows show a neutral `Profile Only` alone — no confidence bars are invented;
- the unit carries one accessible description, e.g. *"Evidence coverage: high. RoleFit
  confidence: high."*

The shared `EvidenceTag` / `ConfidenceReadout` primitives are untouched and keep their
labelled inline form on the other surfaces.

### Unified market status

One sharp rectangular unit per row — `Inflated · €58.5M – €87.8M`, `Fair · From €20M`,
`Unknown · Unknown` — added as a `layout="ledger"` variant of `MarketReadout`. That variant is
used by **discovery and My Favorites**; comparison, the leaderboard and the dossier keep their
own `inline`/`stacked` presentations. Risk label and range share
one box at the same size and weight (the range keeps monospace figures for alignment only, not
as a subordinate caption). Established risk colours are preserved (inflated amber, high-risk
red, unknown neutral), partial ranges stay `From €X` / `Up to €Y`, a missing endpoint is never
€0, and the unit wraps safely at narrow widths.

### Dedicated playstyle line

Playstyles are player traits, so they get their own line and never share a container with
market, coverage, confidence or actions. Positive playstyles render as sharp ink-on-paper
labels (`.ledger-playstyle`); supplied order and count are preserved and nothing is
fabricated. `No qualifying playstyles` and the profile-only `Analysis unavailable` fallback
occupy the same line as plain text rather than posing as badges.

### Sharp ledger labels

On ledger rows — **discovery and My Favorites** — the compound status, market status, playstyle
labels and the profile-only tag use sharp corners, consistent with the dossier's square
progress-bar correction. **Superseded twice:** this sharp treatment was first generalised to
every semantic tag on every surface (the `.ledger-status` / `.ledger-tag` /
`.ledger-playstyle` classes were folded into the shared primitive — see
[The semantic display-tag system](#the-semantic-display-tag-system)), and the residual 2px
radius was then taken to a literal 0px along with the rest of the product — see
[Sharp-corner production system](#sharp-corner-production-system-cadence-4).

### Responsive action rail

`PlayerActionRail` (a presentation variant of `PlayerActionRow`, reusing the same device-local
state and accessibility semantics) puts both actions in one hairline box:

- **`lg`+** — a full-height rail in the rightmost column: two equal-height rows, favourite on
  top, compare beneath, each filling the rail's width.
- **Below `lg`** — the rail moves to the bottom of the row as two equal-width columns, each
  exactly half the row width, each at least a 44px pointer target.

**Favourite** is an inline `currentColor` SVG heart at the player-name ink colour — outlined
when inactive, filled when active, at identical geometry (no emoji, Unicode glyph, image asset
or icon dependency). `aria-pressed` is preserved and the accessible name is
`Add <name> to My Favorites` / `Remove <name> from My Favorites`. **Compare** shows only
`Compare` (the `vs` glyph is gone) and keeps its player-specific name and queue behaviour.
Both selected states change background plus an inset marker only — never a dimension — so
toggling a player cannot reflow the rail. Verified: hero centre offset 0px, both actions
150×60 at 1280, 126×44 at 320, no page overflow at 390, 320, or the 200%-zoom equivalent
(640×450), where the identity/RoleFit header stacks cleanly rather than compressing.

### My Favorites presentation terminology

The primary-navigation destination label reads **My Favorites**, the always-visible counter
reads **My Favorites N · saved on this device**, and the destination page's eyebrow reads
**My Favorites**. This is presentation copy only:
the `/shortlist` route, the `scoutboy.shortlist.v1` local-storage key and order, component and
state identifiers, filenames, API contracts and saved user data are all unchanged, and the
`nav-shortlist` test id is declared explicitly rather than derived from the label. The action
buttons on the dossier, leaderboard, similar players and the compare tray still read
`Shortlist`; aligning that copy was left outside this correction's scope. **My Favorites itself
no longer shows a `Shortlist` action** — its rail is `Remove` + `Compare` (see
[My Favorites action rail](#my-favorites-action-rail)).

### Test coverage added

- **Component (Vitest, `discovery-ledger.test.tsx`; stale assertions updated in
  `cross-surface.test.tsx` and `components.test.tsx`):** no `Evidence:` / `RoleFit
  confidence:` prefix; coverage and confidence independently sourced, including a high
  coverage + low confidence mismatch; monochrome confidence versus band-coloured score;
  unknown coverage/confidence neutral; profile-only without fabricated confidence; market
  label + range in one unit with full/partial/missing ranges and preserved risk colours;
  playstyle order, dedicated container, sharp dark variant and both fallbacks; heart
  accessible names, pressed state and geometry stability; `Compare` with no visible `vs`;
  navigation label, counter, `/shortlist` href, stable test id and unchanged local-storage
  behaviour. (Web unit suite: 120 tests.)
- **E2E (Playwright, `cross-surface.spec.ts`):** desktop three-region composition with a
  vertically-centred hero and a full-height two-row rail (equal widths/heights, favourite on
  top); heart toggle, filled state, persistence across a My Favorites visit and a working
  compare queue; mobile stacked status/market/playstyle order with playstyles on their own
  line and an equal-width two-column bottom rail at 44px targets, with no page overflow at
  390 or 320. Existing discovery filter/pagination/empty/error/loading coverage is intact.
  (E2E suite: 30 tests.)

## Ledger alignment & My Favorites

**Status: implemented and self-verified; NOT the completion of Milestone 7.** This corrects the
desktop ledger's handling of long role names, makes the three status families occupy separate
lines by structure, and extends the discovery row language to My Favorites. Frontend
presentation only: no backend, schema, generated-contract, rating, calibration, YAML, ingestion
or sample-data change, and nothing is recomputed in the frontend.

### Stable desktop RoleFit track

`.ledger-row` previously used content-sized (`auto`) hero and rail tracks, so a long role such
as `Deep-Lying Playmaker` widened the RoleFit column and pushed its left divider further left
than rows reading `Shadow Striker` or `Advanced 8`. The desktop grid is now explicit:

```
grid-template-columns: minmax(0, 1fr) var(--ledger-hero-w) var(--ledger-rail-w);
```

with `--ledger-hero-w: 8rem` and `--ledger-rail-w: 9.5rem` as tokens in `:root`. Player
information/status flexes; the hero and rail are the same width on every row, so every RoleFit
divider and the whole action rail line up down the ledger. The hero keeps `align-self: center`
across both content rows and gains no box or card. Measured at 1280: hero `x` identical on all
12 rows, hero width 128px on all rows, hero centre offset 0–1px.

### Word-boundary role wrapping

The role caption is constrained independently of the track by an opt-in `ScoreReadout`
option, `captionWrap="words"` (default behaviour is unchanged for every other caller — compare,
leaderboard and the dossier are untouched). It renders one `white-space: nowrap` span per
space-delimited word with real spaces between them, so:

- a break can only fall on a word boundary;
- a hyphenated word stays intact (`Deep-Lying`, `Ball-Winning`), which plain wrapping would
  split at the hyphen;
- nothing is truncated, there is no ellipsis, and no letters are split;
- the rendered text content — and therefore the accessible name — is byte-identical to the
  supplied role name;
- the caption cannot resize the fixed track or move the divider.

Measured at 1280: `Deep-Lying Playmaker` and `Ball-Winning Midfielder` occupy two line boxes
with no horizontal overflow; single-line roles stay on one line; score bands unchanged.

### Three deliberate status lines

`LedgerStatusStack` renders the three status families as three block-level sibling containers —
`status-line-coverage`, `status-line-market`, `status-line-playstyles` — rather than letting
market share the coverage line whenever horizontal room allows. The market box therefore can
never ride up onto the coverage line at any width. The approved presentation is unchanged:
`High Data Coverage | [bars] High Confidence` from two independently sourced facts, one sharp
colour-coded market box, sharp dark playstyle labels on their own line, honest profile-only and
missing-data fallbacks, and missing numbers that never become zero.

### My Favorites on the shared ledger

The page heading is now **Saved Players** (eyebrow `My Favorites`, browser-local explanatory
copy and resolved-player count retained). The former two-column compact card grid is replaced
by the same single-column continuous ledger as discovery: same container and row separators,
identity typography, fixed RoleFit track, word-boundary role wrapping, vertically-centred
unboxed hero, three status lines, sharp corners and restrained hairlines. Measured at 1280: My
Favorites rows share discovery's hero `x` and 128px track, and each row spans the full ledger
width.

`PlayerCard` carries less per-season context than a search card — there is no
represented-minutes field — so the second context line reports only what the response actually
supplies (`context.minutes` when present). Nothing is invented. Profile-only, missing-market and
missing-playstyle states stay honest, and the saved-playstyle display keeps its existing
three-item limit and supplied order.

The row primitives moved from `components/search/DiscoveryStatus.tsx` to
`components/common/LedgerRow.tsx` (`LedgerRow`, `LedgerHeader`, `LedgerIdentity`,
`LedgerRoleFitHero`, `LedgerStatusStack`, `LedgerActionRail`, `CoverageConfidenceStatus`,
`PlaystyleLine`) now that both surfaces compose them. The leaderboard, dossier, comparison and
methodology surfaces keep their own compositions.

### My Favorites action rail

`SavedPlayerActionRail` puts two explicit actions in the shared `.rail-box`: **Remove** and
**Compare**, with no heart — the player is already saved, so Remove is the direct action. At
`lg`+ Remove is the top half and Compare the bottom half of the right-hand full-height rail
(measured 150×75 each); below `lg` the rail moves under the player information as equal-width
halves at a 44px minimum target (126×44 at 320px). Visible copy is exactly `Remove` and
`Compare`, with no `vs`. Remove carries a player-specific accessible name
(`Remove Anton Keller from My Favorites`) and drops the id from browser-local saved state;
Compare keeps the shared queue state, `aria-pressed`, its player-specific accessible name and
its dimension-stable selected treatment.

### Test coverage added

- **Component (Vitest):** three distinct status containers in coverage → market → playstyle
  order (analyzed and profile-only), market never inside the coverage line, long role text
  complete with one non-wrapping span per word for `Deep-Lying Playmaker` and `Ball-Winning
  Midfielder`, the `Saved Players` heading, My Favorites using the ledger status variants rather
  than `Evidence:` / `RoleFit confidence:`, independently sourced coverage and confidence on a
  saved row, profile-only rows without a fabricated score or confidence, partial and missing
  market ranges that never render €0, `Remove`/`Compare` with no visible `vs` and no heart,
  Remove's accessible name and browser-local removal, and compare-queue pressed state.
  (Web unit suite: 136 tests.)
- **E2E (Playwright):** desktop RoleFit column/divider alignment within 1px across a ledger
  mixing short and long roles, multi-line long roles without truncation, hero vertical centring,
  strictly increasing status-line positions from a common left edge, and consistent action-rail
  dimensions across rows — asserted on both discovery and My Favorites; My Favorites rows
  spanning the full ledger width in one column; equal desktop Remove/Compare halves; and at
  640/390/320 the stacked status order, equal-width bottom halves, 44px targets and absence of
  page-level horizontal overflow on both surfaces. Deterministic geometry assertions are used
  throughout — no screenshot snapshots. (E2E suite: 33 tests.)

## Typography: warm-paper editorial restraint in one sans family

**Status: implemented and self-verified; NOT the completion of Milestone 7.** The palette,
hairlines, spacing, score bands, confidence glyph and component geometry are unchanged — only
the typeface and the tracking that carries hierarchy changed.

### One proportional family

ScoutBoy previously mixed a serif face for identity (headings, player names, scores) with a
system sans for interface chrome. Both proportional stacks are now a single family:

```
"InterVariable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
"Helvetica Neue", Arial, sans-serif
```

declared once as `--sans` in `globals.css` and as Tailwind's `fontFamily.sans`. The existing
mono stack is untouched and still carries every deliberately tabular figure (`.mono`,
`font-mono`) — market ranges, ranks, metric values, axis labels.

The `--serif` token, the `.serif` utility and Tailwind's `fontFamily.serif` are all removed, as
is every `font-serif` class. `ScoreReadout`'s proportional variant is renamed `serif` → `sans`
(the new default), so no misleading serif API or comment remains. This search returns nothing:

```
rg -n "font-serif|--serif|\.serif|variant.*serif" apps/web/src apps/web/tailwind.config.ts
```

### Delivery

`inter-ui@4.1.1` is a direct dependency of `apps/web`, and
`inter-ui/inter-variable.css` is imported in `app/layout.tsx` **before** `globals.css`. The
package ships the `.woff2` files (`variable/InterVariable.woff2`, plus the italic face), which
the build bundles and serves from the app's own origin, and its `@font-face` rules already
declare `font-display: swap`. Deliberately **not** `next/font/google` or any runtime CDN: the
production build stays reproducible and offline, and CI needs no network fetch for fonts.

### Retaining hierarchy without a second face

Losing the serif/sans contrast is compensated with weight, scale, tracking and whitespace only:

- Every heading, identity and score keeps its existing size class (`text-2xl` section headings,
  `text-3xl sm:text-4xl` page headings, `text-4xl sm:text-5xl` dossier identity, `text-3xl`/
  `text-4xl` scores) and its existing weight.
- Display-scale text gains `tracking-tight`, which is how Inter reads as intentional at large
  sizes and what restores the presence the serif face used to supply.
- The wordmark is typographic — `font-extrabold` at `tracking-[-0.03em]`, with the
  `Recruitment` eyebrow keeping `uppercase tracking-[0.12em]`. No logo asset was added.
- Uppercase tracked eyebrows (`.label`), the body/muted/soft ink channels, score band colours,
  the monochrome confidence bars, and evidence/market styling are all unchanged.

### Re-audit under Inter's metrics

Inter's glyph widths differ from the old serif faces, so the affected geometry was re-measured
rather than assumed: navigation labels and the always-visible counter stay on one line inside
the viewport; discovery and My Favorites RoleFit dividers stay aligned within 1px; `Deep-Lying
Playmaker` and `Ball-Winning Midfielder` still break only between words with no clipping; no
result row overflows its own box; both action halves stay equal in width and height at a 44px
minimum; compare columns stay balanced within 1px; dossier role tabs stay equal width within
1px; and no page develops horizontal overflow at 1280, 640, 390 or 320. Cumulative layout shift
after the font loads is measured, not assumed. No text size was reduced anywhere.

### No-shared-role heading

The visible central heading is now title case — **`No Shared Rated Role`**. This is a UI
presentation change only: `compare_service`'s explanation constant, the API response copy and
the schema are untouched, and the explanatory sentence below the heading stays sentence case
(*"No shared rated role is available for these players. Select a role to inspect the available
analysis."*). The honesty behaviour is unchanged — no score or confidence is fabricated,
neither side is labelled "not rated" when no common role was selected, and market, evidence
context, normalized metrics and explicit-role selection all stay available.

### Test coverage added

- **Component (Vitest, `typography.test.tsx`):** no serif class survives on the shared heading
  primitives, ledger identity or `ScoreReadout`; heading/identity/score sizes and weights are
  preserved; the wordmark is weight-and-tracking only with no image or SVG asset; the eyebrow
  keeps its uppercase tracking; `ScoreReadout` defaults to `sans` and still offers `mono`; score
  band colours unaffected. `cross-surface.test.tsx` asserts the heading is exactly
  `No Shared Rated Role` while `why_higher` stays sentence case.
- **E2E (Playwright, `typography.spec.ts`):** `InterVariable` is loaded and reported with
  `font-display: swap`; every font request comes from the app origin and none from a font CDN;
  the computed proportional family on body, brand, page heading, player name, RoleFit score,
  dossier identity/score, comparison names and the central role heading contains
  `InterVariable` and none of the five old serif faces; no element on discovery, leaderboard,
  methodology or My Favorites resolves a serif stack while `.mono` stays monospaced; ledger
  divider alignment, word-boundary wrapping, nav/counter integrity, rail symmetry, compare
  column balance, role-tab symmetry, 1280/640/390/320 overflow, and cumulative layout shift.

Suite totals after this pass: **web unit 142 tests across 9 files**, **E2E 43 tests**, backend
**263 passed / 1 skipped**.

## The semantic display-tag system

**Status: implemented and self-verified; NOT the completion of Milestone 7.** The sharp tag
language approved on Discovery and My Favorites is now a single shared primitive used by every
surface, replacing the page-specific `.chip` variants. Static visual system only — no
interaction or motion, no palette change, no information-architecture change.

### The primitive

`components/common/DisplayTag.tsx` exports `DisplayTag` plus a `displayTagClass(variant, value,
compound)` helper. `.display-tag` in `globals.css` owns the invariant geometry: **square
90-degree corners** (never capsule ends; originally 2px, taken to a literal `0` in
[Cadence 4](#sharp-corner-production-system-cadence-4)), `inline-flex`, compact `px-2 py-0.5`
padding, a 1px border, semibold
`text-xs`, and `word-break: normal` / `overflow-wrap: normal` so a label wraps as a whole unit
between words and never breaks mid-word. `.display-tag-compound` adds the roomier two-fact box
used by the ledger's coverage/confidence and market units.

Semantic variants:

| Variant | Meaning | Treatment |
| --- | --- | --- |
| `playstyle` | player trait, every tier | ink fill, paper text, ink border |
| `concern` | flagged risk | red border/text on a restrained warning tint |
| `market` | valuation state | tone from the label (undervalued green, fair/unknown neutral, inflated amber, high-risk red) |
| `role-status` | positive role distinction (`Best`, `Best-Rated Role`) | pitch green |
| `confidence` | RoleFit confidence word | graded tone from the level |
| `evidence` | coverage availability, incl. `Profile Only` | restrained neutral |
| `neutral` | system/metadata status | restrained neutral |

### The contract

- New display tags **must** use `DisplayTag` (or `displayTagClass` when the tag needs bespoke
  ARIA, as the two compound ledger units do).
- Call sites choose a **semantic meaning**, never a colour. There is deliberately no
  `className` or colour prop, so a new colour needs a new reviewed variant rather than a
  per-page combination. `market` and `confidence` derive their tone from the value they are
  given, so their established meaning cannot drift.
- Playstyles are always the dark filled treatment. Tier stays in the label text (`· Elite`) and
  never changes colour, so a tier can never be mistaken for a confidence or market status. The
  former `tierBadge` formatter, which existed only to colour tiers, is removed.
- Concerns keep warning styling and are never ink-filled: `Inflated Market` in the concerns
  section stays a red concern tag, distinct from the amber `Inflated` market-valuation label.
- **Controls are not display tags.** Role-selector tabs, filters, navigation, action buttons
  and the favourite/compare rail keep their own component styles. (They no longer differ in
  *geometry*: since
  [Cadence 4](#sharp-corner-production-system-cadence-4) every production control is square
  too, with the single documented Discovery-rail exception.) `.chip` was removed only because
  an exhaustive audit showed every one of its call sites was a display tag; no control used
  it.

### Surfaces migrated

Discovery and My Favorites (already approved — migrated onto the shared primitive so they are
not a parallel styling system, with geometry preserved exactly), the player dossier
(Recruitment Desk `Best-Rated Role` and market, Peer-Ranked Roles `Best` and confidence,
Playstyles & Concerns, Market Value, the profile-only card header), comparison player summaries,
and methodology (role-group weights, playstyle and concern examples, calibration statuses). The
leaderboard is deliberately untouched: it presents playstyles as comma-separated prose and the
asking range as a table cell, which the brief excludes from tag conversion.

### Accessibility

Tags render as plain `<span>`s: no button semantics, no tab stop. Existing `title` and
`aria-label` values are passed through (a playstyle's `why_applied`, a confidence word's full
sentence), meaning never depends on colour alone, and the monochrome `ConfidenceMeter` bars are
untouched. Verified: every tag renders square with no clipping and no page-level horizontal
overflow at 1280, 1024, 640 (200%-zoom equivalent), 390 and 320.

## Static visual correction (Cadence 4)

A bounded, static pass over the **light production experience only**. It changes no product
logic, data, scoring, API, or information architecture: no scoring or market maths, no filter
semantics, no request or response shape, no role-selection policy, no evidence/confidence
semantics, no favourite or compare-queue state, no fixtures. Three things changed — the
Discovery composition, the corner language, and comparison copy.

### Sharp-corner production system (Cadence 4)

**The rule: every rectangular UI box in production is literally 90 degrees — computed
`border-radius: 0px`.** Cards, panels, bordered containers, filter panels, result ledgers,
tables and table shells, inputs, selects, buttons, role-selector tabs, evidence-group buttons,
navigation and mobile menu items, scope banners, empty/loading/missing/error states, the
comparison selector and result panels, My Favorites containers, methodology panels and code
blocks, dossier cards, the selected-role summary, the evidence/context rail, Role Territory and
its highlight rectangles, peer-ranked role cards, market/context/strengths/concerns panels,
face-stat, sub-stat and audit cards, similar-player containers, the compare tray and its player
labels, pagination buttons, semantic display tags and their compound forms, skeleton blocks and
rectangular legend swatches.

**How it is expressed.** Deliberately *not* a blanket `* { border-radius: 0 !important }`,
which would also flatten meaningful illustration geometry and the deferred dark-mode pilot.
Instead:

1. The shared primitives in `globals.css` — `.card`, `.input`, `.btn`, `.table-shell`,
   `.display-tag` (+ `.display-tag-compound`), `.rail-box`, `.territory-surface` and the
   `:focus-visible` ring — declare `border-radius: 0`.
2. Every remaining production `rounded*` utility and inline `borderRadius` was removed
   deliberately, file by file, so a box with no radius declaration computes to `0px` by
   default. Colour semantics, borders, spacing, typography, shadows, hierarchy and interaction
   states are otherwise unchanged.
3. A native `<select>` keeps a rounded platform bezel in Safari/WebKit, so `select.input`
   neutralizes `appearance` and paints its own chevron. It stays a real `<select>`: native
   keyboard handling, the OS option list, and screen-reader semantics are untouched — no
   custom JavaScript combobox.

**Shapes that stay curved,** because their meaning is a curve and they never carried a
`border-radius`: the heart SVG path, the pitch centre circle / penalty arcs / penalty spots,
and circular chart geometry. Rectangular data-visualization marks *are* squared: territory
highlight rectangles, legend swatches, `ConfidenceMeter` bar segments and its unknown marker,
and score bars.

**The one exception.** The approved Discovery heart/Compare action box keeps its existing 2px
geometry via a narrowly named modifier, `.rail-box-discovery`, applied only in
`PlayerActionRail`. It is deliberately separate from `.rail-box` so the exception stays
explicit: **the My Favorites Remove/Compare rail shares the component but not the exception and
renders square.** This is the only positive rectangular radius anywhere in production source.

`src/tests/sharp-corners.test.tsx` enforces this at source level: it strips comments first (so
prose like "~4 rounded ticks" is not a hit), skips `src/tests/**` and the deferred
`src/app/design-pilots/**` pilot, looks only at radius declarations (so SVG `circle`/arc
geometry is never flagged), and allows exactly the one documented `.rail-box-discovery` block —
also asserting that no file but `PlayerActions.tsx` uses that modifier.

### Discovery: aligned composition and a compact sticky rail

**Aligned top edges.** The result summary — player count, scope, age band, season, pagination
summary and `Ranked ledger` — moved *inside* the bordered results ledger as a compact header
row, separated from the first player row by the ledger's existing `divide-y` hairline. It
previously sat above the border, which pushed the ledger down and left the filter panel
starting higher than the player rows. With the summary inside, the filter panel and the
complete results-ledger container start at the same y on desktop (asserted to within 1px), and
**no artificial spacer was added above the filter panel** to fake it.

**Compact rail.** Analysis Scope (three tall option cards) and Age Band (a pill row) became
native `<select>`s matching the existing Position Group / Role / Sort boxes. Every option, its
value, URL-backed state and the page-reset behaviour are unchanged; the selected scope's
explanation is now restrained helper text beneath the selector, wired with `aria-describedby`
so it describes the control without being absorbed into its accessible name. The two short
numeric thresholds (Min minutes, Min RoleFit) share one row. Search still leads. No accordion,
custom combobox, animation, or new filter logic was introduced.

**Sticky behaviour.** At `lg`+ the column stays sticky at the existing `top-4` offset; the
compact rail now fits whole inside a 1280×720 laptop viewport, so no control is stranded below
the fold and no nested scroller was needed. Below `lg` it is not sticky and remains in normal
document flow above the results ledger.

### Comparison copy

- The shared `CompareQueueButton` label is exactly **`Compare`** — the decorative `vs` glyph is
  gone from every surface that uses it (player profile, similar players, leaderboard). Queue
  behaviour, the pressed/queued state, the player-specific accessible name (`Add <name> to
  compare queue`), padding and hit targets are unchanged. The button is narrower purely because
  it renders less text.
- The Compare page selectors read **`Player 1`** and **`Player 2`**, and the API's
  confidence-warning sentences now read `Player 1 (…)` / `Player 2 (…)`.
- **Presentation only.** `player_a` / `player_b` remain the response fields, `a` / `b` remain
  the query parameters on `/compare`, `player_a` / `player_b` remain the API request
  parameters, and `compare-a` / `compare-b` remain the stable test ids. The generated schema
  and the API contract are untouched.

### Test coverage added

- **Vitest `sharp-corners.test.tsx` (13):** the source-level radius scan described above; the
  primitives' zero-radius declarations; rendered discovery filters/rows, empty/loading/error/
  banner states, role-selector tabs, Role Territory + overlays + legend, comparison panels and
  the compare tray, and navigation all carry no rounded box; the Discovery rail keeps the
  exception and My Favorites does not; the heart path and the pitch circles/arcs survive.
- **Vitest `discovery-filters.test.tsx` (14):** scope and age band are accessible `<select>`s
  carrying every existing option; helper text is visible, tracks the scope, and stays out of
  the accessible name; both write to the URL and reset pagination, and drop back out of the URL
  at their defaults; the other filters keep their semantics; sticky classes are `lg`-only; the
  summary is the ledger's first child inside the border with the full metadata; nothing
  precedes the ledger in the results column; the empty state is unchanged.
- **Vitest `compare-copy.test.tsx` (9):** the shared action reads exactly `Compare` with the
  accessible name and pressed state intact; the page reads Player 1 / Player 2 with no
  `Player A`/`Player B` copy; test ids, query params and the `player_a`/`player_b` request
  remain; plus source guards for all three.
- **Pytest `test_api.py`:** every confidence warning matches `Player [12] (…)` and the response
  still carries `player_a` / `player_b`.
- **Playwright `sharp-corners.spec.ts`:** a **computed-style** audit (not class names) across
  discovery, leaderboard, compare, favorites, methodology and the full player dossier; the
  shared primitives at `0px` on a live page; the Discovery rail at `2px` and the My Favorites
  rail at `0px`; heart path and pitch circles/arcs intact; filter/ledger top edges within 1px;
  sticky at desktop and static at 390/768; scope/age selectors with URL state and page reset;
  and no overflow plus no rounded box at 320, 390, 768 and 1280.

### Still deferred after this pass

- **Dark mode remains deferred.** The isolated pilot under `apps/web/src/app/design-pilots/`
  and `docs/design_pilots/` was neither expanded, integrated, redesigned, nor deleted, and is
  explicitly excluded from the square-corner migration. No pilot styling reaches production.
- **Motion remains deferred.** The dedicated motion pass is still outstanding.
- The comprehensive WCAG / visual-regression audit is still outstanding.

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
- The ledger corrections were verified at 1280, 640 (200%-zoom equivalent), 390 and 320. The
  comprehensive **WCAG / resilience audit**, including a full 200% zoom pass across every
  surface, remains a subsequent cadence.
- Favourite/compare action copy outside the discovery and My Favorites rails still says
  `Shortlist`, so the presentation terminology is not yet uniform across surfaces.
- The fixed desktop RoleFit track is sized for the current role registry's longest single word
  (`Ball-Winning`). A future role name with a substantially longer unbroken word would need the
  `--ledger-hero-w` token widened rather than a wrapping change, because breaking mid-word is
  deliberately disallowed.
- Removing the `vs` glyph makes the shared `Compare` button narrower. Padding, min-height and
  hit targets are unchanged — the button is simply sized to less text.
- `select.input` neutralizes the platform appearance to guarantee a square outer border in
  WebKit, so the chevron is painted by us. The control is still a native `<select>`, but the
  indicator no longer matches the OS's own affordance pixel-for-pixel.
- The square-corner rule is enforced at source level plus a computed-style E2E sweep of the
  surfaces the sample data can render. States that need response interception (profile-only,
  missing shared role, API errors) are covered by component tests rather than the computed
  sweep.
