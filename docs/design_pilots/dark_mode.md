# Dark Mode Pilot — tokens, contrast, and what it does not settle

**Status: an isolated design pilot for visual approval. Not a theme, not scheduled, not
shipped.** Nothing on a production route was themed, no theme switching exists, and the
production token system was not refactored.

- Route: [`/design-pilots/dark-mode`](../../apps/web/src/app/design-pilots/dark-mode/page.tsx)
  (unlinked; reachable only by typing the URL, `noindex, nofollow`)
- Stylesheet: [`pilot.css`](../../apps/web/src/app/design-pilots/dark-mode/pilot.css)
- Screenshots: [desktop 1280](dark-mode-pilot-desktop-1280.png) ·
  [mobile 390](dark-mode-pilot-mobile-390.png) ·
  [current light theme for comparison](light-theme-discovery-1280.png)

## What the pilot is

The approved thesis is *a quiet modern recruitment desk with one living, evidence-honest
pitch*. The pilot translates it rather than replacing it. The reading is **the same desk
after hours**: warm paper becomes a warm charcoal desk, ink becomes off-white, the
hairlines stay, and the pitch — which is the darkest thing in the light theme — becomes
the one lit thing on the page.

That inversion is the pilot's single deliberate bet, and it also solves a real problem: on
a dark canvas a drop shadow is effectively invisible, so "the one elevated surface" cannot
be expressed as elevation. It is expressed as **luminance and chroma** instead. The pitch
field sits at 6.0× the panel's luminance and is the only strongly chromatic surface on the
page. Everything else stays flat and hairline-bordered, exactly as in production.

## Isolation contract

| Constraint | How it is enforced |
| --- | --- |
| Scoped to a pilot root | Every selector in `pilot.css` begins `.dark-pilot`; asserted by `dark-mode-pilot.test.tsx` |
| No production colour change | The pilot declares no `:root` block and no `--paper` / `--ink` / `--pitch` / `--line` / `--track` / `--elite` token; asserted |
| No theme switching | No toggle, no preference read or write; the page is a static server component with no client JS |
| No OS coupling | No `prefers-color-scheme` query anywhere; asserted |
| Not in navigation | Absent from `NavBar`'s `LINKS`; a Playwright check fails if any `design-pilot` link appears on Discovery |
| Not indexed | `robots: { index: false, follow: false, nocache: true }` |
| Production untouched | A Playwright check loads the pilot, then Discovery, and asserts `--paper`/`--ink` are unchanged and the body still renders light |

One consequence worth stating plainly: the root layout wraps every route in the production
navigation and footer, and the brief rules out editing shared production components to make
the pilot work. The pilot therefore takes over the viewport from inside its own scope
(`position: fixed; inset: 0`). The production navigation stays in the DOM behind it and
remains focusable, which is a wart in the artifact — not in any proposed theme. A real dark
theme would not need it.

## Proposed semantic tokens

Each name maps one-for-one onto an existing production light token, so approving this is a
value swap rather than a re-architecture. `dark-mode-pilot.test.tsx` fails if this table and
the stylesheet ever disagree.

### Surfaces

| Token | Dark | Light counterpart | Role |
| --- | --- | --- | --- |
| `--pilot-canvas` | `#1a2019` | `--paper #f4f2ea` | Page background — warm charcoal |
| `--pilot-panel` | `#222a21` | `--panel #fcfbf6` | Primary panel / ledger surface |
| `--pilot-panel-muted` | `#2b342a` | `--panel-muted #efede2` | Subordinate fill, hover, table head |
| `--pilot-track` | `#3a4438` | `--track #e4dfce` | Neutral bar track |

The canvas hue is not invented. ScoutBoy's light **ink** (`#182219`) is already a warm,
green-cast near-black — L\* 12.0, chroma 8.3 — so the dark canvas is built on that hue and
reads as ScoutBoy's own darkest colour grown into a surface. Measured: canvas L\* 11.4,
chroma 6.0. A neutral charcoal at the same lightness (`#191b18`, chroma 2.5) sits below the
just-noticeable chroma threshold and reads as plain near-black; that was the pilot's first
attempt and it was rejected in the critique pass.

### Hairlines

| Token | Dark | Light counterpart | Role |
| --- | --- | --- | --- |
| `--pilot-line` | `#414c40` | `--line #d8d3c2` | Decorative separator |
| `--pilot-line-strong` | `#6e7a64` | `--line-strong #b9b29d` | Control boundary |

These are two different jobs and are held to two different bars — see
[Border visibility](#border-visibility).

### Text

| Token | Dark | Light counterpart | Role |
| --- | --- | --- | --- |
| `--pilot-text` | `#eef0e6` | `--ink #182219` | Primary — off-white, warmed |
| `--pilot-text-muted` | `#bcc2b4` | `--ink-muted #49564c` | Secondary |
| `--pilot-text-soft` | `#98a08f` | `--ink-soft #6e7a6f` | Tertiary / captions |

Primary text is off-white rather than `#ffffff`: pure white on a dark canvas halates, and
the warmed off-white keeps the paper lineage.

### Football and action

| Token | Dark | Light counterpart | Role |
| --- | --- | --- | --- |
| `--pilot-green` | `#4eb083` | `--pitch #1c5a3c` | Fills, bars, selection markers |
| `--pilot-green-text` | `#82d4a8` | `--pitch-dark #13402b` | Green text and links |
| `--pilot-green-fill` | `#2c7454` | `--pitch` (button fill) | Primary action fill |
| `--pilot-green-selected` | `#223a2b` | `#e9f0ea` | Selected control background |
| `--pilot-focus` | `#86d6ab` | `--pitch` | Focus ring |

The primary action is a muted fill carrying a lighter green border, so the control clears
3:1 at its boundary without the fill itself becoming loud.

### Score bands

Identical thresholds to the production `scoreBand` function.

| Token | Dark | Light counterpart | Band |
| --- | --- | --- | --- |
| `--pilot-band-red` | `#f08a7d` | `--red #9c2e22` | below 40 |
| `--pilot-band-rust` | `#dd8f63` | `--rust #8d3f24` | 40 – 54.9 |
| `--pilot-band-amber` | `#e2a951` | `--amber #9a5a0b` | 55 – 69.9 |
| `--pilot-band-green` | `#86c9a2` | `--pitch #1c5a3c` | 70 – 79.9 |
| `--pilot-band-emerald` | `#3fca8f` | `--pitch-mid #0f7a5f` | 80 – 89.9 |
| `--pilot-band-elite` | `#7cabf5` | `--elite #2e74e6` | 90 and above |
| `--pilot-band-unknown` | `#98a08f` | `--ink-soft #6e7a6f` | null — unknown, never zero |

### Status

| Token | Dark | Light counterpart | Role |
| --- | --- | --- | --- |
| `--pilot-amber` | `#e2a951` | `--amber #9a5a0b` | Inflated market, caution |
| `--pilot-amber-bg` | `#3a2f1e` | `#f6ecd7` | Inflated market chip and caution fill |
| `--pilot-rust` | `#dd8f63` | `--rust #8d3f24` | Lower-reliability caption |
| `--pilot-red` | `#f08a7d` | `--red #9c2e22` | High-risk market, error |
| `--pilot-red-bg` | `#3a2622` | `#f4e8e3` | High-risk market chip and critical fill |
| `--pilot-elite` | `#7cabf5` | `--elite #2e74e6` | Elite score accent |
| `--pilot-tag-bg` | `#39432f` | `--ink #182219` | Playstyle label fill |

The playstyle label is the light theme's solid ink-on-paper block, inverted. It is
deliberately borderless: that is what keeps it readable as a *different kind of object*
from the hairline-outlined status boxes above it, so a neutral `Fair` market chip and an
`Interceptor` playstyle never look like the same thing.

### Role Territory — the one elevated surface

| Token | Dark | Light counterpart | Role |
| --- | --- | --- | --- |
| `--pilot-territory-surface` | `#2b342a` | `--panel` + `--elevation-territory` | Signature card surface |
| `--pilot-pitch-field` | `#27704f` | `--pitch-field #285a3f` | Pitch field |
| `--pilot-pitch-field-alt` | `#29734f` | `--pitch-field-alt #2d6446` | Solid mowing band |
| `--pilot-pitch-line` | `#e2eae0` | `--pitch-line` | Pitch markings |
| `--pilot-pitch-tab` | `#16281d` | — (new) | Solid plate behind a zone label |

`--pilot-pitch-tab` is the only token with no light counterpart. It exists because on a lit
field the zone-label contrast would otherwise depend on how bright the zone underneath
happens to be; anchoring the label to a solid plate fixes it at 13.46:1 regardless.

## Contrast results

All measured with the WCAG 2.2 relative-luminance formula against the exact hex values
above. Targets: **4.5:1** for text (1.4.3 AA), **3:1** for user-interface component
boundaries and meaningful graphics (1.4.11 AA).

| Pair | Foreground | Background | Ratio | Target | Result |
| --- | --- | --- | --- | --- | --- |
| primary text / canvas | `#eef0e6` | `#1a2019` | **14.43:1** | 4.5:1 (AA text) | Pass |
| primary text / panel | `#eef0e6` | `#222a21` | **12.84:1** | 4.5:1 (AA text) | Pass |
| primary text / panel-muted | `#eef0e6` | `#2b342a` | **11.21:1** | 4.5:1 (AA text) | Pass |
| muted text / canvas | `#bcc2b4` | `#1a2019` | **9.11:1** | 4.5:1 (AA text) | Pass |
| muted text / panel | `#bcc2b4` | `#222a21` | **8.10:1** | 4.5:1 (AA text) | Pass |
| soft text / canvas | `#98a08f` | `#1a2019` | **6.14:1** | 4.5:1 (AA text) | Pass |
| soft text / panel | `#98a08f` | `#222a21` | **5.46:1** | 4.5:1 (AA text) | Pass |
| soft text / panel-muted | `#98a08f` | `#2b342a` | **4.77:1** | 4.5:1 (AA text) | Pass |
| link text / canvas | `#82d4a8` | `#1a2019` | **9.44:1** | 4.5:1 (AA text) | Pass |
| link text / panel | `#82d4a8` | `#222a21` | **8.40:1** | 4.5:1 (AA text) | Pass |
| green selection text / selected background | `#82d4a8` | `#223a2b` | **6.99:1** | 4.5:1 (AA text) | Pass |
| green button text / green fill | `#eef0e6` | `#2c7454` | **4.89:1** | 4.5:1 (AA text) | Pass |
| elite blue text / panel | `#7cabf5` | `#222a21` | **6.33:1** | 4.5:1 (AA text) | Pass |
| elite blue text / canvas | `#7cabf5` | `#1a2019` | **7.12:1** | 4.5:1 (AA text) | Pass |
| amber warning text / amber background | `#e2a951` | `#3a2f1e` | **6.25:1** | 4.5:1 (AA text) | Pass |
| amber warning text / panel | `#e2a951` | `#222a21` | **7.06:1** | 4.5:1 (AA text) | Pass |
| rust caption / panel | `#dd8f63` | `#222a21` | **5.76:1** | 4.5:1 (AA text) | Pass |
| rust caption / territory surface | `#dd8f63` | `#2b342a` | **5.03:1** | 4.5:1 (AA text) | Pass |
| red warning text / red background | `#f08a7d` | `#3a2622` | **5.83:1** | 4.5:1 (AA text) | Pass |
| red warning text / panel | `#f08a7d` | `#222a21` | **6.08:1** | 4.5:1 (AA text) | Pass |
| score band green (70–79) / panel | `#86c9a2` | `#222a21` | **7.66:1** | 4.5:1 (AA text) | Pass |
| score band emerald (80–89) / panel | `#3fca8f` | `#222a21` | **7.08:1** | 4.5:1 (AA text) | Pass |
| playstyle text / tag fill | `#eef0e6` | `#39432f` | **9.04:1** | 4.5:1 (AA text) | Pass |
| pitch zone label / zone label plate | `#eef0e6` | `#16281d` | **13.46:1** | 4.5:1 (AA text) | Pass |
| territory text / territory surface | `#eef0e6` | `#2b342a` | **11.21:1** | 4.5:1 (AA text) | Pass |
| control border / panel | `#6e7a64` | `#222a21` | **3.26:1** | 3:1 (AA non-text) | Pass |
| control border / canvas | `#6e7a64` | `#1a2019` | **3.66:1** | 3:1 (AA non-text) | Pass |
| focus ring / canvas | `#86d6ab` | `#1a2019` | **9.66:1** | 3:1 (AA non-text) | Pass |
| focus ring / panel | `#86d6ab` | `#222a21` | **8.60:1** | 3:1 (AA non-text) | Pass |
| focus ring / panel-muted | `#86d6ab` | `#2b342a` | **7.51:1** | 3:1 (AA non-text) | Pass |
| focus ring / territory surface | `#86d6ab` | `#2b342a` | **7.51:1** | 3:1 (AA non-text) | Pass |
| green fill (bar, marker) / panel | `#4eb083` | `#222a21` | **5.53:1** | 3:1 (AA non-text) | Pass |
| pitch markings / pitch field | `#e2eae0` | `#27704f` | **4.86:1** | 3:1 (AA non-text) | Pass |

Every pair meets or exceeds its target. Nothing in the table was left failing and presented
anyway; the canvas, hairlines, pitch field and zone labels were all adjusted until they
passed.

### Border visibility

Separators and control boundaries are different things and are held to different bars.

| Pair | Ratio | Basis |
| --- | --- | --- |
| control border `#6e7a64` / panel | **3.26:1** | WCAG 1.4.11 — a real UI-component boundary, so 3:1 applies |
| control border `#6e7a64` / canvas | **3.66:1** | as above |
| hairline `#414c40` / canvas | 1.84:1 | decorative separator — see below |
| hairline `#414c40` / panel | 1.64:1 | decorative separator |
| bar track `#3a4438` / panel | 1.45:1 | decorative — the filled portion carries the meaning |
| pitch field `#27704f` / territory surface | 2.16:1 | large chromatic surface, not a boundary |

`--pilot-line` is used only for panel edges, row separators and section rules. WCAG 1.4.11
applies to user-interface components and to graphics required to understand content; a
purely visual row separator is neither — no information is lost if it is missed, because
the rows are already separated structurally. It is recorded here rather than being quietly
excluded.

Everything that actually bounds a control — the scope buttons, the age-band pills, the role
tabs, the text inputs, the buttons and the action rail — uses `--pilot-line-strong` and
clears 3:1, **including in the unselected state**. An unselected control is still a control.
A Playwright check walks every such element, resolves its computed border against its
resolved background, and fails below 3:1.

Worth flagging for the product owner: this is a **proposed improvement, not a translation**.
Production's light equivalents currently bound the same unselected controls with
`--line #d8d3c2` on `--paper #f4f2ea`, which is about 1.35:1. If a dark theme is approved,
the same correction is worth making on the light side rather than leaving the two themes
inconsistent.

### Colour is never the only channel

- Every market state prints its word (`Inflated`, `High-Risk`, `Fair`, `Unknown`) at the
  same size and weight as its range.
- Confidence uses a monochrome segmented glyph plus a word, and never the score palette.
  The pilot's low-confidence notice is deliberately monochrome for this reason — an amber
  caution would have put a third amber object within 200px of an amber score and an amber
  market chip.
- Unknown is a hatch plus the word "unknown", never an empty meter and never zero.
- Selected controls change background **and** gain an inset marker rule; they never change
  dimension.
- The active navigation item gains an underline rule as well as a colour change.

### What this does *not* claim

This is one page of purpose-built specimens. It says nothing about the accessibility of
ScoutBoy as a whole, and it is not a WCAG audit of the product. No production surface was
evaluated here. Screen-reader behaviour, keyboard traversal across real flows, zoom
reflow beyond the four widths below, and every production state not shown remain unaudited.

## Responsive results

Verified at 1280, 640 (the 200%-zoom equivalent), 390 and 320. At each width both the
document and the pilot's own scroller were measured: `scrollWidth <= clientWidth` in every
case, so there is no page-level horizontal overflow. The pilot stylesheet deliberately does
**not** set `overflow-x: hidden`, which would have hidden exactly the defect the check
exists to catch.

Also verified: role captions break only on word boundaries, so `Ball-Winning Midfielder`
stays intact and nothing is truncated; the two mobile action halves are equal in width to
within 1px and at least 44px tall; the focus ring is a solid 2px outline.

## How the pilot changed after the critique pass

One bounded critique pass was run against the first render. What was accepted, and what was
not:

**Accepted**

1. *The canvas had drifted to near-black neutral.* Measured chroma 2.46 at L\* 9.45 — less
   chromatic than the light theme's brightest surface, and darker than the light theme's
   ink. Rebuilt the whole neutral ramp on the ink's own hue: canvas now L\* 11.4, chroma 6.0.
2. *The pitch's decoration was louder than its data.* A continuous opacity ramp put ~2.5 L\*
   between a group score of 81 and one of 94, while the decorative mowing stripes carried
   3.8 L\*. The zone fill is now **quantised to ScoutBoy's six score bands** — discrete steps
   ~5 L\* apart against ~1 L\* for the stripes, so the data is roughly 4.6× louder than the
   lawn.
3. *White zone labels failed AA* at 3.03:1 on the brighter zones. Labels now ride on a solid
   plate at 13.46:1, which also means the encoding direction did not have to be inverted.
4. *Zone rectangles were rounded stickers over square pitch markings.* Now square-cornered.
5. *Seven bordered evidence cards stacked in a column read as elevation everywhere.* They
   are now hairline-separated rows on one panel — elevation stays reserved for the pitch.
6. *A neutral market chip and a playstyle tag looked identical.* The playstyle tag is now a
   solid borderless block again, as in the light theme.
7. *The confidence caution borrowed the score palette.* Now monochrome, which is both calmer
   and more faithful to ScoutBoy's rule that confidence never uses the score colours.
8. *Medium confidence was stated six times on one screen.* Reduced to the meter, one notice,
   and the stored explanation text.
9. *The filter rail's panel title and first section label ran together* as one heading, and
   *the coverage unit's divider stranded itself* at the end of the first line when the unit
   wrapped. Both fixed; the divider is now a border on the segment it introduces.
10. *"No Shared Rated Role" was the loudest type on the page.* The absence of data is an
    honest finding, not a headline; it is now set in the muted ink.
11. *No specimen actually rendered an unknown score.* Added an honesty-states block showing
    the `—` sentinel, the confidence hatch, a partial market range and the profile-only tag.

**Declined, with reasons**

- *Make market state monochrome and reserve hue for score magnitude.* The critique is right
  that the score band and the market chip share hexes — but they already do in production,
  and Cadence 3 explicitly preserved "inflated amber, high-risk red, unknown neutral" as
  established risk colours. Changing that is a product-wide semantic decision, not a
  dark-mode one. It is raised below as an open decision instead of being changed silently.
- *Crop the pitch to the attacking half.* Roughly 45% of the illustration is an empty own
  half for a Shadow Striker, which is real: he has no midfield or defensive evidence groups.
  Cropping would misrepresent an illustration that is explicitly a whole pitch with an
  "Attacking Direction ↑" caption. Noted as an observation below.
- *Split evidence coverage out of the shared coverage/confidence unit.* That unit is the
  approved production pattern, documented at length in the Discovery ledger correction —
  grouped for scanning, never collapsed into one inferred status.
- *Label the favourite control in words and drop the pill-shaped age filters.* Both are
  production behaviour, unrelated to the theme.
- *Replace the mobile filter rail with a collapsing summary bar.* A real improvement, but a
  production interaction change rather than a dark-mode question.

## Compared with the current light theme

| | Light (production) | Dark pilot |
| --- | --- | --- |
| Canvas | Warm paper `#f4f2ea`, L\* 95 | Warm charcoal `#1a2019`, L\* 11 — the light theme's own ink hue |
| Metaphor | A printed dossier on a desk | The same desk after hours |
| Elevation | One drop shadow, on Role Territory only | Luminance and chroma, on Role Territory only — no shadow anywhere |
| The pitch | **Darker** than its surroundings (dark green on paper) | **Lighter** than its surroundings, at 6.0× the panel's luminance |
| Zone encoding | Continuous translucency, brighter = higher | Quantised to the six score bands, brighter = higher |
| Zone labels | White text with a text shadow | White text on a solid plate — measurable, at 13.46:1 |
| Hairlines | `#d8d3c2` on paper | `#414c40`, with a separate `#6e7a64` for real control boundaries |
| Playstyle tags | Solid ink block, paper text | Solid `#39432f` block, off-white text — the same inversion |
| Score bands | Six steps, darkening toward elite blue | Six steps, lightening toward elite blue |
| Typography | Inter Variable, one proportional family | Unchanged — same family, sizes, weights and tracking |
| Geometry | Square ledger units, fixed RoleFit track, 44px targets | Unchanged |

Nothing about the information architecture, the four evidence channels, the honesty rules,
or the typographic system changes. The dark theme is a value swap over the same structure —
which is the main thing the pilot is trying to demonstrate.

## Production components that would need token migration

Only if a dark theme is approved. This is an inventory, not a plan, and no sequencing or
estimate is implied.

**Token sources (2)** — these define the vocabulary and would have to gain a second value
set before anything else can move:

- `apps/web/src/app/globals.css` — the `:root` block plus `.card`, `.chip`, `.label`,
  `.input`, `.btn`, `.btn-primary`, `.btn-on`, `.table-shell`, `.data-table`,
  `.ledger-status`, `.ledger-tag`, `.ledger-playstyle`, `.rail-box`, `.rail-action`,
  `.territory-surface`, `.skip-link`, `::selection`, `:focus-visible`
- `apps/web/tailwind.config.ts` — the `paper` / `ink` / `line` / `pitch` / `accent` /
  `elite` / `track` colour scales

**Literal colours that bypass the token system (the real work)** — every hard-coded colour
outside the `:root` block, found by grepping the source. Each needs a semantic token before
it can respond to a theme, because a literal cannot be swapped:

| Location | Literals | What they colour |
| --- | --- | --- |
| `app/globals.css` | `#e9f0ea` ×2 | `.btn-on` and the pressed `.rail-action` |
| `lib/formatters/index.ts` | `#e9f0ea`, `#f6ecd7`, `#f2e3dc`, `#f4e8e3` | `confidenceColor`, `marketLabelColor`, `tierBadge` |
| `components/common/index.tsx` | `#f4e8e3`, `#f6ecd7` | `ErrorState`, `Notice` caution tone |
| `components/common/DisplayTag.tsx` | `#f4e8e3`, `#e9f0ea` | tag tone backgrounds |
| `components/player/RoleSelector.tsx` | `#e9f0ea` | selected role tab |
| `components/search/PlayerSearchFilters.tsx` | `#e9f0ea` | selected scope and age band |
| `components/player/MarketValuePanel.tsx` | `#e0cfa4`, `#f6ecd7` | valuation chart axis and intervals |
| `components/player/RoleTerritory.tsx` | 11 × `rgba()` | zone overlays, hatch, borders, text shadows, legend |

`ConfidenceMeter.tsx` and `NavBar.tsx` contain no literals — they reference `--pitch` and
the Tailwind ink scale, so both would follow automatically once the token sources gain a
dark value set.

**Composition surfaces that would need a visual pass but no new tokens** —
`app/page.tsx`, `app/players/[playerId]/page.tsx`, `app/roles/[roleId]/page.tsx`,
`app/compare/page.tsx`, `app/shortlist/page.tsx`, `app/methodology/page.tsx`,
`components/common/LedgerRow.tsx`, `components/compare/PlayerCompareTable.tsx`,
`components/methodology/CalibrationPanel.tsx`, and the remaining `components/player/*`
panels.

**Not covered by this pilot at all** — the market valuation SVG chart, the audit accordion,
the calibration panel, similar players, sub-stats tables, face stats, the leaderboard table,
and every loading / empty / error state.

## Decisions

### Demonstrated by the pilot

- A warm charcoal built on ScoutBoy's own ink hue reads as this product rather than as a
  generic dark dashboard.
- Every proposed semantic text/background pair meets WCAG 2.2 AA.
- Role Territory survives as the single signature surface using luminance instead of shadow.
- The four evidence channels — score magnitude, RoleFit confidence, evidence coverage,
  market state — stay visually separate on a dark canvas.
- All six score bands stay distinguishable from one another.
- The composition holds at 1280, 640, 390 and 320 with no horizontal overflow, equal mobile
  action halves, 44px targets and a visible focus ring.
- The honesty states (unknown score, unknown confidence, partial market range, profile-only)
  survive the inversion without reading as disabled chrome.

### Unresolved — needs a product-owner decision

1. **Should ScoutBoy have a dark theme at all?** This pilot exists to answer that and
   nothing else.
2. **If yes: dark-only, or user-selectable?** And if selectable, should it follow the
   operating system, and does the preference persist per device or per account? The pilot
   deliberately implements none of this.
3. **Should the pitch stay lighter than its surroundings?** This inverts the light theme's
   relationship. It is the pilot's central bet and the thing most worth rejecting if it
   feels wrong.
4. **Should score magnitude and market state keep sharing hues?** Amber, rust, red and elite
   blue are currently the same value in both channels — in production as well as here. Dark
   makes the collision more visible. Separating them is a product-wide semantic change and
   is explicitly out of this pilot's scope.
5. **Should the pitch illustration be croppable** when a role has no midfield or defensive
   evidence, or does the whole pitch always have to be drawn?
6. **Does the printed-paper metaphor survive** in a dark context, or does the dark theme need
   its own identity language?
7. **Do the SVG chart surfaces** (market valuation, calibration) need a separate treatment
   pass before a theme could be considered complete?

### Would happen later, only if approved

Listed so it is clear what is *not* being proposed now:

- Migrating the literal colours listed above onto semantic tokens.
- Adding a theme mechanism, if a switch is wanted.
- A full accessibility audit across every production surface and state.
- Dark-mode visual-regression coverage.
- A dark treatment for the surfaces this pilot does not cover.

None of this is scheduled, sized, or assumed.
