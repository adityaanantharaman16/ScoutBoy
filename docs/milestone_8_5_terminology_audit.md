# Milestone 8.5 - Cross-Surface Terminology Audit

**Status: implemented and independently supervisory-audited. Exact commit and
remote CI status are recorded in repository history and GitHub Actions rather
than frozen into this implementation record.**

## 1. What this phase is, and is not

ScoutBoy accumulated a second name for several of its own stored concepts. The
same evidence channel read `High Data Coverage` in the Discovery ledger and
`High Coverage` on the dossier. The same market figure was `Expected Asking` in
the filter rail and the ranking explanation but `Asking Price` in the Sort
control directly above it, and `Asking price` again on the dossier. The same
collection announced itself as `My Favorites` to a signed-in scout and as
`shortlist` to a guest, in the same live region, on the same page. A player with
no stored rating reported `Profile Only` where a RoleFit score belongs -
borrowing an Evidence Coverage word to answer a rating-status question.

Two more were contradictions a scout could read in a single glance. A Compare
page with a Selected Role neither player is rated in printed "Unrated in this
role" in both balance columns and then, directly beneath them, "Not enough data
to compare in a shared role" - a claim about evidence volume standing in for a
claim about rating status, for the identical cause. And the dossier's Market
Value panel explained its own label with "expected asking mid ... vs model
range" three lines under a legend that had just named those same two figures
"Expected Asking Range" and "Model Value Range".

None of those was a behaviour defect. All of them were the product telling a
scout that two things are different when they are the same, or the same when they
are different, which is exactly the failure this product's explainability promise
cannot afford.

Most of the copy lives in the frontend, but four things are authored in the
backend and rendered verbatim: the Discovery ranking explanation, the comparison's
conclusion and confidence warnings, the market model's `label_basis` and
`disclaimer`, and the comparable-player group labels. Those are audited here too,
because a lexicon that stops at the API boundary is not a lexicon.

**This is a terminology and copy-consistency pass, and nothing else.** No RoleFit
calculation, rating data, ranking, filtering, confidence or coverage semantics
changed. No filter was added and the filter rail is unchanged. No saved-work type
was added; no notes, history, snapshots or frozen comparison results exist. No
account is required and the account suggestion's favourite-only trigger is
untouched. No layout was redesigned and no rounded geometry was introduced. No
URL, route, storage key, test id or API field name changed. Milestone 8.6 has not
been started.

## 2. The canonical terminology matrix

Column meanings:

- **Canonical term** - the one spelling a user-visible label, heading, chip,
  column header, accessible name or metadata title uses.
- **Permitted variants** - compact or in-sentence forms that are allowed, and
  where. Anything not listed here is a drift.
- **Prohibited** - spellings that are now absent from production sources and are
  held absent by test.

### 2.1 RoleFit

| | |
| --- | --- |
| **Canonical term** | `RoleFit` |
| **Definition** | The stored rating for a given role and player, on the 0-99 display scale. Displaying it, or changing which role is displayed, never recomputes anything. |
| **Permitted variants** | `RoleFit Score` (a column header or ordering-key label where a neighbouring column is `RoleFit Confidence`); `Best RoleFit` (the Best Role's score); `Selected Role RoleFit`; `Minimum RoleFit` / `Maximum RoleFit` (filter bounds). |
| **Prohibited** | `Rolefit`, `roleFit`, `ROLEFIT`, `Role Fit`, `role fit`; and a bare `Score`, `Rating` or `Fit` standing in for it. |
| **Internal identifiers, unchanged** | `rolefit_min`, `rolefit_max`, `rolefit_desc`, `rolefit_asc`, `rolefit_score`, `has_rolefit_analysis`, `orders_by_rolefit`, `ROLEFIT_SCALE_MIN/MAX`, `parseRoleFitThreshold`, `setRoleFit`, `roleFit*` locals, `rolefit-min-filter`, `row-rolefit`, `similar-rolefit`. |
| **Surfaces** | Discovery ledger hero and filter rail, Why This Order, role leaderboard, player dossier (desk summary, role selector, peer-ranked roles, comparable players), Compare, Methodology, saved-view criteria summaries. |

### 2.2 Best Role, Selected Role, Result Role

| | |
| --- | --- |
| **Canonical terms** | `Best Role`, `Selected Role`, `Result Role` |
| **Definition** | `Best Role` is the player's own best stored role. It is independent of the current query and is never relabelled by one. `Selected Role` is the role a user chose - a Discovery `role=` filter, a dossier role tab, a Compare role. `Result Role` is the role applicable to the current row or page: the Selected Role when one is active, otherwise the Best Role. That is exactly the stored `result_role_source` discriminator (`selected_role` \| `best_role`). |
| **Permitted variants** | `Best RoleFit` for the Best Role's score; `Selected Role RoleFit` for the selected context's score; `Automatic Role` for Compare's no-role-selected mode (it is a selection policy, not a third context); lower-case `best role` / `selected role` inside a running explanatory sentence that is not labelling a value. |
| **Prohibited** | `Best-Rated Role`, `best-rated role`, `Best rated role`; a bare `Best` as a tag; describing either context as a recommendation, a suggestion or a suitability judgement. |
| **Surfaces** | Discovery ledger hero and Why This Order role context, dossier header (`Best RoleFit` / `Best Role`), desk selected-role summary, peer-ranked roles, comparable players, Compare role spine, Advanced Filters helper copy. |

### 2.3 RoleFit Confidence and Evidence Coverage

| | |
| --- | --- |
| **Canonical terms** | `RoleFit Confidence`, `Evidence Coverage` |
| **Definition** | `RoleFit Confidence` is confidence in the stored RoleFit for the applicable role context (`unknown` < `low` < `medium` < `high`). `Evidence Coverage` is how much relevant evidence supports the analysis at all (`high_coverage`, `analyzed_limited`, `profile_only`). They are independent: high Evidence Coverage never implies high RoleFit Confidence, and the ledger renders them as two segments of one unit precisely so neither can be read off the other. |
| **Permitted variants** | Coverage values `High Evidence Coverage`, `Limited Evidence Coverage`, `Profile Only`, `Unknown Evidence Coverage`; the dossier's compact `High Coverage` / `Analyzed, Limited Coverage` under an explicit `Evidence Coverage` label; confidence values `High RoleFit Confidence`, `Medium RoleFit Confidence`, `Low RoleFit Confidence`, `Unknown RoleFit Confidence` where the visible value must stand on its own; and compact words `High` / `Medium` / `Low` / `Unknown` beside a confidence meter under an explicit `RoleFit Confidence` label. |
| **Prohibited** | `Data Coverage` in any form; `RoleFit confidence` or `Evidence coverage` with a lower-case second word where the phrase labels a value; using either word for the other's meaning. |
| **Deliberately distinct neighbours** | `Valuation Confidence` (the market model's own confidence, on the dossier's Market Value panel); `Coverage confidence`, `Sample confidence`, `Overall evidence`, `Competition coverage` (stored context fields inside Evidence & Context, each a different measurement and none of them RoleFit Confidence or Evidence Coverage). |
| **Surfaces** | Discovery ledger status unit and its accessible name, My Favorites ledger, dossier header and desk summary, role leaderboard column, Compare, dark-mode design pilot. |

### 2.4 Minutes

| | |
| --- | --- |
| **Canonical terms** | `Minutes Played`, `Minimum Minutes` |
| **Definition** | `Minutes Played` is the displayed statistic. `Minimum Minutes` is the Discovery filter threshold (0-10,000 whole minutes, a documented technical ceiling that never caps a stored or displayed figure). An unknown minutes figure renders the `-` sentinel and is never read as zero. |
| **Permitted variants** | `N min played` in a dense ledger context line, where the figure is adjacent to its number. |
| **Prohibited** | A bare `min` or `Minutes` as the statistic's label, because `Minimum Minutes` sits one control away and `min` reads as both. |
| **Surfaces** | Discovery ledger context line, My Favorites ledger, dossier Evidence & Context and Context & Coverage, Compare evidence context, Advanced Filters helper copy, saved-view criteria summaries. |

### 2.5 Market information

| | |
| --- | --- |
| **Canonical terms** | `Public Market Value`, `Model Value Range`, `Expected Asking Range` / `Expected Asking Price` |
| **Definition** | Three separate stored reads. `Public Market Value` is the provider's public figure. `Model Value Range` is ScoutBoy's own transparent rule-based range. `Expected Asking Range` is the modelled asking interval; the Discovery price sorts order by its **low** endpoint only, never the high endpoint and never a midpoint. Market-risk status (`Undervalued` / `Fair` / `Inflated` / `High-Risk` / `Unknown`) is a fourth, separate fact. |
| **Permitted variants** | `Expected Asking` as a compact label (Sort control, ordering keys, filter bounds, leaderboard column, comparable-player card); `Minimum Expected Asking` / `Maximum Expected Asking` for the filter bounds; `Valuation Confidence` for the market model's confidence. |
| **Prohibited** | `Asking Price` / `Asking price` / `Expected ask` as the concept's name; collapsing any of the three into a generic `value`; `No market data` where the honest state is `Unknown`; representing an unknown figure as `€0`. |
| **Surfaces** | Dossier Market Value panel (legend, chart row labels, chart accessible name, interpretation sentence, footer), Discovery ledger market readout, My Favorites ledger, role leaderboard column, Compare balance columns, comparable players, Sort control, Advanced Filters Market category, saved-view criteria summaries, Why This Order keys. |

### 2.6 Data and capability states

| Canonical term | Means | Chosen when |
| --- | --- | --- |
| `Rated` | A stored RoleFit exists for the relevant context. | A row, side or role has a rating. Appears as the ordering key `Rated Before Unrated` and in the leaderboard's `N rated players`. |
| `Unrated` | No stored RoleFit exists for that context, including honest profile-only states. | The Discovery/My Favorites RoleFit hero with no rating; the dossier header's Best RoleFit, Best Role and RoleFit Confidence slots; the desk's selected-role name; a Compare side with no rating for the Selected Role; the playstyle line's `Unrated: no playstyles`. |
| `Unknown` | The underlying value was not observed or is not known. | A missing market figure or range, a missing age, a missing score sentinel, an absent market record (`Market information unknown`), `Unknown Evidence Coverage`, the `Unknown` confidence level. |
| `Unavailable` | A referenced resource or requested value cannot currently be supplied - a stale or deleted reference, a load failure, a provider that never answered. | A saved player id that will not resolve; a saved comparison side whose player is gone; `Role evidence unavailable`; `Selected-role audit unavailable`; `Evidence context unavailable`; `Accounts unavailable`; `Audit trail unavailable`. |
| `Unsupported` | The requested capability or context falls outside configured product support. | A role key the configuration does not carry (a Compare URL's unknown `role`, a saved view's retired criterion, a saved comparison's retired role). |

**These were not applied by search and replace.** Each site was read first. The
two that changed meaning rather than spelling are called out here:
`Profile Only` in the RoleFit hero became `Unrated`, because that slot answers
"is there a rating?" and Profile Only answers "how much evidence is there?" - and
`Profile Only` remains, unchanged, in the Evidence Coverage unit beside it, where
it is correct. `Analysis unavailable` on the playstyle line became
`Unrated: no playstyles`, because nothing failed to load: the player was never
rated.

### 2.7 Favorites and saved work

| | |
| --- | --- |
| **Canonical term** | `My Favorites` |
| **Definition** | The user's player collection, and every action on it. `Saved` remains the umbrella navigation entry and the name of the workspace at `/saved`, of which My Favorites is the default section. |
| **Permitted variants** | The visible action pair `Favorite` / `Favorited`, whose accessible names are `Favorite: add {player} to My Favorites` and `Favorited: remove {player} from My Favorites` (WCAG 2.2 SC 2.5.3 Label in Name); `Remove` on a row that is already saved. |
| **Prohibited** | Any user-visible `shortlist`, `Shortlist`, `Shortlisted`, `shortlisted players`; and `Saved Players`, which was a third name for the same collection on the legacy route. |
| **Compatibility identifiers, deliberately retained** | Route `/shortlist`; storage key `scoutboy.shortlist.v1`; test ids `shortlist-record`, `shortlist-player`, `shortlist-ledger`, `shortlist-moved-notice`; component `ShortlistButton`, page `ShortlistPage`; state members `shortlistIds`, `isShortlisted`, `toggleShortlist`, `removeShortlist`, `SHORTLIST_KEY`. Each is read by an existing bookmark, by stored device data, or by existing tests, and none of them is user-visible. |
| **Legacy `/shortlist`** | Renders rather than redirects, as 8.4B established. Its eyebrow is `Saved work`, its heading and browser title are both `My Favorites`, and it carries one pointer: "My Favorites now lives under Saved, alongside your saved Discovery views and saved comparison setups. This page still works and shows the same players." No contradictory name appears on it. |
| **Surfaces** | Header counter, navigation, Saved hub section control, My Favorites ledger and its empty / loading / stale states, the legacy route, every favourite action on Discovery, the dossier, comparable players and the leaderboard, and both guest live-region announcements. |

### 2.8 Saved Discovery Views and Saved Comparison Setups

| | |
| --- | --- |
| **Canonical terms** | `Saved Discovery View`, `Saved Comparison Setup` |
| **Definition** | A saved Discovery view stores a filter and sort configuration and nothing else; opening it always starts on page 1. A saved comparison setup stores two player references, their saved display names and a role key - and, by schema, no score, conclusion, confidence or evidence summary. Opening either runs current ScoutBoy analysis. |
| **Permitted variants** | Compact headings `Views` and `Comparisons`; compact actions `Save View`, `Saved View`, `Rename View`, `Save Comparison`, `Saved Comparison`, `Rename Comparison`; in-sentence `saved Discovery view` and `saved comparison setup`. |
| **Prohibited** | Describing a saved comparison as a result, report, analysis, snapshot or frozen anything. `snapshot` appears exactly once in the product, inside the Saved hub sentence that denies it. |
| **Surfaces** | Saved hub leads and section controls, Views panel rows and their accessible names, Comparisons panel rows and their accessible names, the two save controls and their naming panels, empty and error states. |

### 2.9 Ordering explanations

| | |
| --- | --- |
| **Canonical term** | `Why This Order` |
| **Definition** | The page-level statement of how the current Discovery page is ordered: the active sort, the applicable role context, how unknown values are placed, the exact ordered key sequence and the tie-breakers. It names no player, quotes no player's values and compares no two rows. |
| **Permitted variants** | `Active Sort`, `Ordering Rules, In Order`, and the accessible name `Why this order. {summary}`. |
| **Prohibited** | `recommend`, `recommended`, `suggested player`, `why this player`, `suitab*`, `priority`, `best signing`, `should sign`, `target`, `verdict`, `boost` - with one exception: the limitation sentence, which exists to deny recruitment suitability and therefore has to name it. |
| **Neighbours that must stay distinct** | `Why This Score` (the dossier's audit explanation of one rating) and `Why This Valuation` (the market panel's label basis). Three questions, three names, no cross-talk. |

## 3. Casing rule

The multi-word product terms above are Title Case **when they label a value** -
as a heading, a chip, a column header, a form label, a metadata title, or the
`X: value` prefix of an accessible name. Inside a running explanatory sentence
that is not labelling a value, a lower-case noun phrase is permitted, provided it
is still the canonical phrase (`each player's best role` is fine; `each player's
fit` is not).

Two consequences worth stating, because they were the drift:

- The compound ledger status's accessible name is
  `Evidence Coverage: high. RoleFit Confidence: high.` Both are `X: value`
  prefixes, so both are Title Case, and they now match the visible segments and
  every other surface.
- `unknown` in lower case survives in exactly one shape: where it substitutes for
  a number inside a value phrase (`unknown yrs`). As a standalone state label the
  form is `Unknown`.

## 4. Surfaces audited

Discovery search and its filter rail; the ranked ledger, its header and
`Why This Order`; the player dossier (Recruitment Desk, identity block, role
selector, selected-role summary, Evidence & Context rail, Market Value, Context &
Coverage, peer-ranked roles, playstyles and concerns, sub-stats, audit trail,
comparable players, sources and limitations); role leaderboards (desktop table and
mobile ledger); Compare (automatic role, selected role, no-shared-role, unrated
side, malformed-URL notice, confidence warnings); the Saved Work hub and its three
sections; My Favorites; the legacy `/shortlist` route; Methodology; navigation and
the header counter; the account suggestion; the compare tray; the not-found page;
the global footer; and the dark-mode design pilot, which is a reachable production
route and therefore in scope.

Within each: empty, loading and error states; unrated, unknown, unavailable and
unsupported states; missing-data displays; stale and deleted saved references;
URL-restored state messages; toasts, notices and live-region announcements;
accessible names, ARIA labels, `title` attributes, tooltips, route metadata and
meaningful alternative text; and the API-authored copy the frontend renders
verbatim.

Distinguished from user-facing copy and left alone: internal route names, storage
keys, test ids, code identifiers, comments, generated API/schema artifacts
(`docs/api_contracts/openapi.json`, `apps/web/src/lib/api/schema.gen.ts` - neither
was hand-edited) and historical milestone documentation.

## 5. Old term to new term

| Old | New | Where |
| --- | --- | --- |
| `High Data Coverage` / `Limited Data Coverage` / `Unknown Data Coverage` | `High Evidence Coverage` / `Limited Evidence Coverage` / `Unknown Evidence Coverage` | `lib/formatters` -> Discovery ledger, My Favorites ledger, dark-mode pilot |
| `Evidence coverage: … RoleFit confidence: …` (accessible name) | `Evidence Coverage: … RoleFit Confidence: …` | ledger status unit, dark-mode pilot |
| `Evidence:` (tag prefix) | `Evidence Coverage:` | shared `EvidenceTag` |
| `Evidence` / `Confidence` (dossier header labels) | `Evidence Coverage` / `RoleFit Confidence` | player dossier header |
| `RoleFit confidence` / `Evidence coverage` (desk labels) | `RoleFit Confidence` / `Evidence Coverage` | Recruitment Desk summary, shared `ConfidenceReadout`, dark-mode pilot |
| `Score` (leaderboard column) | `RoleFit Score` | role leaderboard table |
| `Best-Rated Role` / `Not this player's best-rated role` | `Best Role` / `Not this player's Best Role` | Recruitment Desk summary |
| `Best` (role tag) | `Best Role` | peer-ranked roles |
| `Role` (dossier header label) | `Best Role` | player dossier header |
| `RoleFit` (comparable-player label over `best_role_score`) | `Best RoleFit` | comparable players |
| `Selected role: X` / `Best role for each player` | `Selected Role: X` / `Best Role for each player` | backend ranking explanation |
| `strongest joint fit` | `strongest joint RoleFit` | Compare role helper |
| `RoleFit score and confidence shown per side` | `RoleFit and RoleFit Confidence shown per side` | Compare role spine |
| `Confidence warning` | `RoleFit Confidence warning` | Compare notice |
| `{level} confidence - interpret with caution` | `{Level} RoleFit Confidence - interpret with caution` | backend compare warnings |
| `Not rated in this role` | `Unrated in this role` | Compare balance column |
| `Profile Only` (RoleFit hero) | `Unrated` | Discovery ledger, My Favorites ledger |
| `Profile only` / `Unavailable` / `Profile Only` (dossier header) | `Unrated` (all three slots) | player dossier header |
| `Unavailable` (selected-role name) | `Unrated` | Recruitment Desk summary |
| `Analysis unavailable` | `Unrated: no playstyles` | ledger playstyle line |
| `Minutes` | `Minutes Played` | dossier Context & Coverage, Evidence & Context, Compare evidence context |
| `N min` | `N min played` | Discovery ledger, My Favorites ledger |
| `Whole minutes 0-10,000` | `Whole Minutes Played 0-10,000` | Advanced Filters helper |
| `Asking Price (High → Low)` / `(Low → High)` | `Expected Asking (High → Low)` / `(Low → High)` | Sort control |
| `Expected asking` | `Expected Asking` | leaderboard table and ledger, comparable players, shared `MarketReadout` |
| `Asking price` | `Expected Asking` | dossier Evidence & Context rail |
| `Public market value` / `Model value range` / `Expected asking price` | `Public Market Value` / `Model Value Range` / `Expected Asking Range` | Market Value legend and chart accessible name |
| `EXPECTED ASK` / `MODEL` / `PUBLIC` (chart rows) | `EXPECTED ASKING` / `MODEL VALUE` / `PUBLIC VALUE` | Market Value chart |
| `Expected ask opens … above the model's high end.` | `Expected Asking opens … above the Model Value Range high end.` | Market Value interpretation |
| `Public value, model range, and expected ask …` | `Public Market Value, Model Value Range, and Expected Asking Range …` | Market Value lead |
| `Valuation confidence` | `Valuation Confidence` | Market Value panel |
| `expected asking mid €X vs model range €Y–€Z` | `Expected Asking midpoint €X vs Model Value Range €Y–€Z` | market model `label_basis`, rendered under Why This Valuation |
| `Public value, model value, and asking price are distinct concepts.` | `Public Market Value, Model Value Range and Expected Asking Range are three distinct reads.` | market model `disclaimer` |
| `Similar profile, lower expected asking price` | `Similar profile, lower Expected Asking` | comparable-player reason |
| `Similar style at a lower expected asking price.` | `Similar style at a lower Expected Asking Range.` | comparable-player group description |
| `Similar style with a higher RoleFit score.` | `Similar style with a higher RoleFit.` | comparable-player group description |
| `Not enough data to compare in a shared role.` | `At least one player is unrated in this role, so there is no shared-role comparison. …` | Compare conclusion, beneath two columns already reading Unrated in this role |
| `No market data.` | `Market information unknown. No market record is stored for this player.` | Market Value panel |
| `No market data` | `Unknown` | dossier Evidence & Context rail |
| `unknown` (standalone sentinels) | `Unknown` | `StatBar`, Market Value chart |
| `added to shortlist` / `removed from shortlist` | `added to My Favorites` / `removed from My Favorites` | guest live-region announcements (three call sites) |
| `Shortlist` / `Shortlisted` (button) | `Favorite` / `Favorited` | dossier action row |
| `Add {player} to shortlist` (accessible name) | `Favorite: add {player} to My Favorites` | dossier action row |
| `Resolving shortlisted players…` | `Loading My Favorites…` | My Favorites skeleton |
| `Favorites` (hub section) | `My Favorites` | Saved hub |
| `Saved Players` (legacy heading) | `My Favorites` | legacy `/shortlist` route |
| `No players saved yet. …` | `No players in My Favorites yet. …` | My Favorites empty state |
| `… could not be resolved and may be stale.` | `… could not be resolved. Those players are unavailable and the reference may be stale.` | My Favorites stale state |
| `No saved views yet` / `No saved comparisons yet` | `No saved Discovery views yet` / `No saved comparison setups yet` | Saved hub empty states |
| `Rename this saved view` / `Rename this saved comparison` | `Rename this saved Discovery view` / `Rename this saved comparison setup` | naming panels |
| `Open/Rename the saved comparison X` | `Open/Rename the saved comparison setup X` | Comparisons panel accessible names |
| `{role} · Opens with current analysis` | `{role} · Saved setup, opens with current analysis` | Comparisons panel row |
| `Part of this saved view is no longer available` | `Part of this saved Discovery view is no longer supported` | Views panel |
| `The role saved with this comparison is no longer available` | `The role saved with this comparison setup is no longer supported` | Comparisons panel |
| `is no longer available, so this comparison opened with Automatic Role` | `is not a supported role, so this comparison opened with Automatic Role` | Compare URL notice |
| `View leaderboard →` + `View the X leaderboard` | `View Leaderboard →` + `View Leaderboard: X` | peer-ranked roles |
| `Back to discover` | `Back To Discovery` | player dossier, not-found page |
| `Read the methodology` | `Read The Methodology` | not-found page |
| `Full market detail ↓` / `Full context & coverage ↓` | `Full Market Value ↓` / `Full Context & Coverage ↓` | dossier Evidence & Context rail |
| `Choose a role to analyse` | `Choose a role to analyze` | Recruitment Desk |
| `Coverage is limited … Profile-only and low-confidence states …` | `Evidence Coverage is limited … Unrated and low-confidence records …` | global footer |
| `Best rated role` / `Profile only` / `Confidence` (pilot labels) | `Best Role` / `Unrated` / `RoleFit Confidence` | dark-mode design pilot |

## 6. Where the lexicon is enforced

**`apps/web/src/tests/terminology.test.tsx` (43 tests, new).** Half source scans
over production sources with comments stripped and `schema.gen.ts` and the test
tree excluded, half rendered assertions. The scans declare every permitted
internal spelling explicitly (`ROLEFIT_INTERNAL_SPELLINGS`,
`FAVORITES_INTERNAL_SPELLINGS`), so a compatibility identifier is documented
rather than silently tolerated, and a *new* spelling cannot slip past. Covers:
RoleFit capitalization; Best Role versus Result Role, including a role-filtered
row proving the hero shows neither the Best Role's score nor its name; RoleFit
Confidence versus Evidence Coverage, including the high-coverage/low-confidence
case; Minutes Played versus Minimum Minutes and a missing figure that is not
zero; the three market reads, the Sort control's labels and the absent-record
Unknown; all five data and capability states; the absence of user-visible
`shortlist` anywhere; both guest live-region announcements; Label in Name for the
favourite action; saved Discovery view and saved comparison setup semantics plus
the frozen-result denial; Why This Order carrying no advisory wording and no
cross-talk with Why This Score or Why This Valuation; empty, loading, error,
stale and URL-restored copy; and accessible names that match their visible
labels.

**`apps/web/src/tests/copy-conventions.test.tsx` (31 tests, extended).** The
existing em-dash, route-title and Title Case guards, now also covering
`app/saved/layout.tsx` (previously the one route title with no assertion) and the
three renamed actions, with their old spellings added to the retired list.

**`apps/api/app/tests/test_terminology.py` (20 tests, new).** The backend copy the
frontend renders verbatim: the two role-context labels and their detail
sentences, the ordering-key label lexicon, RoleFit capitalization in every rule
sentence, the missing-value sentences that refuse to read a gap as zero, the
limitation that denies recommendation, the compare warning naming RoleFit
Confidence with a display word rather than a raw enum, the conclusion that names
an unrated side Unrated rather than "not enough data", the market model's
`label_basis` and `disclaimer`, the comparable-player group copy, and the
Methodology prose.

**Existing suites, updated rather than dropped**: `discovery-ledger`,
`cross-surface`, `components`, `phase2-corrections`, `recruitment-desk`,
`leaderboard`, `display-tag`, `filter-layout`, `discovery-filters`,
`similar-players`, `saved-work`, `account-favorites`; and the Playwright specs
`accessibility`, `cross-surface`, `saved-work`, `display-tags`,
`discovery-ranking`, `dark-mode-pilot`, `player-desk`, `discovery-contract` and
`sharp-corners`.

## 7. Verification

Every figure below is from a command executed on this machine.

| Gate | Command | Result |
| --- | --- | --- |
| Frontend typecheck | `pnpm --filter @scoutboy/web typecheck` | clean |
| Frontend lint | `pnpm --filter @scoutboy/web lint` | clean, zero warnings |
| Frontend tests | `pnpm --filter @scoutboy/web vitest run` | **953 passed across 27 files** (was 906 across 26) |
| Backend tests | `pytest` | **840 tests: 822 passed, 14 skipped, 4 failed** - all four pre-existing, see below |
| API contract | `app.export_openapi` + `pnpm gen:api` | both artifacts regenerate **byte-identical** (MD5 unchanged); no schema drift |
| Auth-free production build | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= pnpm build` | succeeded; the publishable key verified **absent** from `.next/static` |
| Auth-enabled production build | `pnpm build` with the key present | succeeded; the key verified **present** in `.next/static` |
| Playwright, production build | `playwright test` against the auth-free build and an isolated fixture database | **428 passed, 0 failed** |

**The four backend failures are a local-environment condition, not a regression.**
`apps/api/app/tests/test_account_favorites.py` asserts the shape of a deployment
with *no* Clerk configuration, and `Settings` reads the repository's gitignored
`.env`, which on this machine supplies `SCOUTBOY_CLERK_ISSUER` and
`SCOUTBOY_CLERK_AUTHORIZED_PARTIES`. **The same four tests fail identically at
`dbbbd45` with this milestone's changes stashed**, which is how this was
established rather than assumed. Nothing in this phase touches auth configuration.

**How the Playwright suite was run.** `scripts/run_e2e.sh` could not run on this
Windows host: it builds its fixture database at a POSIX `mktemp -d` path that
SQLite cannot open through `sqlite:////tmp/...`, and `playwright.config.ts` starts
the API with `env PYTHONPATH=... .venv/bin/uvicorn`, which is not a Windows command
line. The equivalent stack was therefore assembled by hand and the suite run
against it with `SCOUTBOY_E2E_REUSE_EXISTING_SERVER=1`: a throwaway SQLite fixture
database (migrate to head, ingest the committed `sample` provider, recompute
ratings / playstyles / market), the API served from it in the anonymous deployment
shape the suite requires (`SCOUTBOY_AUTH_ENABLED=0`, no Clerk issuer - which is
what the local `.env` would otherwise have overridden), and the auth-free
production web build served by `next start`. The developer's `db/scoutboy.db` was
neither read nor written.

Four full runs, reported honestly. The first reported 12 failures: nine were this
milestone's own stale test expectations, now updated; one was the `.env` auth
condition above; and two were a strict-mode collision between the product's
`role="alert"` error state and Next.js 16's own `__next-route-announcer__`, which
also carries `role="alert"`. After those fixes the second run was **428 passed, 0
failed**.

The third and fourth runs, on the final code, were 426/2 and 427/1. Every one of
those three failures is a local parallel-execution artifact, and each was
confirmed by re-running its whole spec file serially:

| Failure | Cause | Serial re-run |
| --- | --- | --- |
| `resilience.spec.ts` "discovery error is an alert" | `[role="alert"]` matches the product's error state **and** Next.js's own `__next-route-announcer__` | `resilience` + `state-contrast`: **31/31 passed** |
| `state-contrast.spec.ts` comparison error state | 60s timeout waiting for `/players?page_size=100` under load | same run: **31/31 passed** |
| `filters-and-cards.spec.ts` tablet-768 grid | `net::ERR_NO_BUFFER_SPACE` - the Windows socket-exhaustion artifact already recorded in the Phase 8.3 evidence | `filters-and-cards`: **56/56 passed** |

None of the three touches copy, and none is caused by this milestone.

## 8. Visual verification

The Browser pane in this environment could not composite frames, so **no rendered
screenshots were captured**. Verification was done instead by driving the
production build in a real headless Chromium and *measuring* the properties this
milestone asks about - which is stronger than eyeballing for overflow and
clipping, and weaker for pure aesthetics. Stated plainly rather than papered over:
a human eye has not looked at these screens.

**16 routes and states x 8 viewports = 128 measured checks. Zero problems.**

Viewports: 1440x900, 1280x800, 1024x768, 768x1024, 640x900, 390x844, 320x720, and
640x450 as the compact / 200%-desktop-zoom equivalent.

| # | Route / state |
| --- | --- |
| 1 | Discovery, four active filters, populated ledger (`/?age_max=25&min_minutes=450&role=touchline_winger&value_max=90000000`) |
| 2 | Discovery with `Why This Order` **expanded** |
| 3 | Discovery zero-result empty state |
| 4 | Player dossier (`/players/7`) |
| 5 | Role leaderboard (`/roles/touchline_winger`) - desktop table above 768px, mobile ledger below |
| 6 | Compare, Automatic Role (`/compare?a=7&b=8`) |
| 7 | Compare, Selected Role (`...&role=touchline_winger`) |
| 8 | Compare, Selected Role with **both sides unrated** (`...&role=tempo_controller`) |
| 9 | Compare with an **unsupported role** in the URL (`...&role=not_a_role`) |
| 10 | Compare empty state, no players chosen |
| 11 | Saved Work: My Favorites (`/saved`) |
| 12 | Saved Work: Views (`/saved?section=views`) |
| 13 | Saved Work: Comparisons (`/saved?section=comparisons`) |
| 14 | Legacy `/shortlist` |
| 15 | Methodology |
| 16 | Not-found |

Measured at each of the 128 combinations:

- **Document horizontal overflow** - 0px everywhere, including 320px and 640x450.
- **Clipped text** - no element's content exceeds its own box under
  `overflow: hidden`/`clip`. Deliberate `truncate` treatments and `.sr-only`
  visually hidden labels are excluded, because clipping is their mechanism.
- **Nested scrollers** inside the filter rail or the results ledger - none.
- **Unsanctioned corner radii** - none. The only non-zero radius in production
  remains the approved `.rail-box-discovery` 2px exception, unchanged.
- **Right-aligned control groups** (header account group, ledger action rails)
  staying inside the viewport - none escape at any width, including 320px where
  the header pair wraps and stays right-aligned.
- **Contradictory terminology on one screen** - every retired term
  (`Data Coverage`, `Asking Price`, `Shortlist`, `Shortlisted`, `Best-Rated Role`,
  `Saved Players`, `Analysis unavailable`, `Not rated in this role`) checked
  against every leaf text node **and** every `aria-label` and `title` attribute:
  zero occurrences on any route at any viewport.

**Keyboard.** 28 consecutive Tab presses on filtered Discovery at 1280x800: focus
never lands on `<body>`, and every stop reports a `2px solid` outline - the
product's shared `--pitch` focus ring. The first ten stops are Skip to main
content, the wordmark, the five navigation links, `Save View`, the active-criteria
toggle and `Clear All`: DOM order and visual order alike.

**Two probe false positives, checked by hand and dismissed.** An earlier revision
of the probe reported the leaderboard's `.sr-only` "Actions" header as clipped -
which is what visually hidden means - and reported `Saved Players` on `/saved`, an
artifact of collapsing whitespace between `<h1>Saved</h1>` and a lead paragraph
beginning "Players you have set aside...". No element contains that phrase,
confirmed by a leaf-node query in the live page. The probe was corrected and both
disappeared. The leaderboard was additionally inspected directly at 640px, where
the mobile ledger renders `RoleFit Confidence:` and `Expected Asking:` per row.

## 9. Deliberate residuals

- **`/shortlist` and `scoutboy.shortlist.v1` stay.** Changing either would break
  a bookmark or orphan a guest's saved players for no terminology benefit. The
  route renders `My Favorites` and says where the surface now lives.
- **Test ids, component names and state members keep their `shortlist` spelling**
  for the same reason, and because they are read by roughly a dozen existing
  assertions whose value is behavioural rather than lexical.
- **`Profile Only` is still user-visible**, and correctly so: it is an Evidence
  Coverage value, alongside `High Evidence Coverage` and `Limited Evidence
  Coverage`. What changed is that it no longer also answers a rating-status
  question - the RoleFit hero, the dossier header and the desk summary now say
  `Unrated` there instead.
- **`Coverage confidence`, `Sample confidence`, `Overall evidence` and
  `Competition coverage`** keep their sentence-case labels inside the dossier's
  Evidence & Context and Context & Coverage panels. They are stored context
  fields, each a different measurement, and none of them is RoleFit Confidence or
  Evidence Coverage; renaming them would create the conflation this pass removes.
- **`Valuation Confidence`** is deliberately a different name from RoleFit
  Confidence, on a surface where both can be read.
- **`formatAge(null)` still returns lower-case `unknown`**, because it renders
  inside `unknown yrs · ST · Stuttgart` where a capital would read as a new
  sentence. Documented in §3 as the one permitted lower-case form.
- **`find_similar`'s `expected_asking_high_eur or 0` residual** from Phase 8.1A is
  unchanged. It is a query defect, not a copy defect, and remains out of scope.
- **`manual_review_reasons`** (`"asking price is >Nx model value"`, from
  `market_model/guardrails.py`) keeps its wording. It is stored explanation data
  that no surface renders - the dossier shows only the flag itself, "Flagged for
  manual review (outlier guardrail)" - so it is internal, not user-visible copy.
