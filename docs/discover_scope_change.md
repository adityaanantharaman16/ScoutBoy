# Discover scope change

## Previous scope

Discover defaulted to the strict `mvp_u23_att_mid_eu` universe:

- age 23 or younger at season end
- attacker or midfielder
- European competition eligibility
- minimum season minutes
- minimum performance-covered minutes
- successfully resolved identity

That cohort remains available, but it is no longer the default directory.

## New scope

Discover is now a broad player directory with evidence-aware analysis:

- **Analyzed** (default): players with at least one RoleFit rating for the selected/current season.
- **All records**: every player with a usable appearance/profile record for the selected/current
  season, including defenders, goalkeepers, unrated players, and limited-coverage players.
- **High-coverage U23**: the unchanged strict `mvp_u23_att_mid_eu` cohort, presented as
  "U23 attackers and midfielders meeting ScoutBoy's minimum performance-coverage threshold."

The URL/API parameter is `scope`. Legacy callers are preserved:

- `universe=mvp` maps to `scope=high_coverage_u23`
- `universe=all` maps to `scope=all_records`
- explicit `scope` wins when both are supplied

**Discovery no longer exposes a scope selector.** The rail has no Analysis Scope
control and the results summary does not report one; the UI always requests the
default `analyzed` scope. `scope` remains a supported API parameter, a
scope-bearing URL still loads and is still honoured, and an unrecognised value
falls back to the default rather than being forwarded.

Phase 8.2 did not reinstate it. The active-criteria list is deliberately not a
back door: it reports narrowing criteria the user can see and change, and
Analysis Scope is neither. Clear All still drops a legacy `scope` / `universe` /
`age_band` from the canonical URL.

## Exposed Discovery filters

Since Phase 8.2 the rail can express every filter `GET /api/players` accepts,
split between five always-visible core controls and an Advanced Filters
disclosure:

| Group | Controls |
| ----- | -------- |
| Core (always visible) | Search, Age Threshold, Position Group, Role, Sort |
| Advanced → Context | League, Club, Nationality |
| Advanced → Evidence & Fit | Minimum Minutes, Minimum RoleFit, Maximum RoleFit, Playstyle |
| Advanced → Market | Minimum Expected Asking, Maximum Expected Asking |

All three Context predicates are case-insensitive **literal substrings**.
League searches the competition's slug, name **and stored country**, so `England`,
`eng` and `Premier League` all reach the Premier League. Club is searched through a
versioned alias registry first (`configs/discovery/search_aliases_v1.yaml`), so `psg`,
`P.S.G.` and `Paris SG` resolve to Paris Saint-Germain and an ambiguous abbreviation
returns every club it defensibly names; anything that is not a configured alias is an
ordinary substring. There is **no fuzzy matching** anywhere. Nationality matches any
part of the stored country (`Eng` finds England) and a player with no stored
nationality still fails an active predicate. Playstyle matches a qualifying positive
badge and never a concern, and its options come from the Methodology contract rather
than a hand-written frontend list. The expected-asking inputs are typed in **EUR
millions** and serialized as the absolute EUR the API contract requires
(`12.5` → `value_max=12500000`); a player with no expected asking is excluded by
an active bound rather than read as EUR 0, and no midpoint of the two bounds is
ever computed or shown. All active filters compose with AND.

Confidence, evidence state and concern filtering remain **unsupported**: the
search contract has no predicate for them, and none was invented in the browser.

Progressive disclosure, the active-criteria list, the range-safety rule and the
Clear All reset are documented in
[docs/milestone_8_discovery_contract.md](milestone_8_discovery_contract.md).

**Filters decide inclusion; they never decide order.** Since Phase 8.3 the ledger
carries a collapsed "Why this order" disclosure that reports the active sort's exact
ordered key sequence, the role context each result's RoleFit is read from, how unknown
values are placed, the final tie-breakers and one limitation. No filter appears there
as a reason for rank — league, club, nationality, minutes, playstyle, age, value and
RoleFit bounds narrow the cohort and nothing else. A selected role is named there as
the rating every result is judged by, but under the Age, Expected Asking and Name
sorts the copy says explicitly that RoleFit did **not** order the page and names the
sort that did. `sort` is likewise not a narrowing criterion. The explanation and the
SQL `ORDER BY` are built from one backend-owned sort specification, and it is stated
in the surface itself that this describes ordering rather than recruitment
suitability.

## Age filter

Age is calculated relative to the selected season's end date.

Discovery's age control is a five-stop threshold plus a direction. The stops are
**19, 22, 25, 28, 31** — roughly three-year career stages from U19 up — and the
direction decides which side of the stop is kept:

| Control state           | URL / API           | Meaning                    |
| ----------------------- | ------------------- | -------------------------- |
| All Ages                | neither bound       | no age restriction         |
| `<n>` Years And Younger | `age_max=<n>`       | `age <= n`                 |
| `<n>` Years And Older   | `age_min=<n>`       | `age >= n`                 |

Exactly one bound is ever emitted: switching direction clears the opposite bound
from both the request and the URL, and the All Ages reset clears both. The root
Discovery route is therefore unfiltered by age by default. Off-stop bounds in a
hand-crafted URL snap to the nearest stop so the displayed threshold and the
applied filter cannot disagree; when a URL carries both bounds, `age_max` wins.

Unknown ages remain visible with no age bound applied and are excluded by either
bound — an unknown age never passes an active minimum or maximum.

### Legacy `age_band`

`age_band` is still accepted by the API, but Discovery no longer writes it. A
legacy `age_band` URL loads safely and is normalized once, deterministically, by
a single rule: **a band with a lower bound becomes "older" at the smallest stop at
or above that bound; a band bounded only from above becomes "younger" at the
largest stop at or below it.**

| Legacy    | Old semantics        | Normalized to  |
| --------- | -------------------- | -------------- |
| `all`     | no restriction       | All Ages       |
| `u23`     | `age <= 23`          | `age_max=22`   |
| `24_26`   | `24 <= age <= 26`    | `age_min=25`   |
| `27_30`   | `27 <= age <= 30`    | `age_min=28`   |
| `31_plus` | `age >= 31`          | `age_min=31`   |

`31_plus` keeps its exact previous semantics. The closed bands become the nearest
one-sided threshold, because the control expresses a single direction by design.
The stale `age_band` parameter is dropped from the URL as soon as the new control
is used, and an explicit `age_min`/`age_max` on the same URL wins over it.

## Selected-role result semantics

Corrected in Phase 8.1A; see
[docs/milestone_8_discovery_contract.md](milestone_8_discovery_contract.md).

A Discovery result is always **about one stored role rating**, and that one rating
qualifies it, bounds it, orders it and is what the row displays.

| Query | Result role context |
| ----------------------- | ------------------------------------------------ |
| no `role`               | the player's own stored **best role**            |
| `role=<key>`            | the **stored rating for that role**              |

With `role=<key>`:

- only players with a stored rating for that role qualify;
- `rolefit_min` / `rolefit_max` apply to the selected role's stored score;
- `sort=rolefit_desc` / `rolefit_asc` order by that score and break ties on that
  rating's stored confidence;
- the row shows that role, its stored score and its stored confidence.

The response reports both contexts separately: `best_role`, `best_role_display`,
`best_role_score` and `best_role_confidence` always describe the player's own best
role, while `result_role`, `result_role_display`, `result_role_score` and
`result_role_confidence` describe the context actually used.
`result_role_source` is `best_role` or `selected_role`. `confidence` carries the
applicable context's confidence and equals `result_role_confidence`.

No `best_*` field is ever reused to carry a non-best role, nothing is recomputed, and
a player's stored best role is never overwritten or relabelled by a filter.

## Minimum minutes and RoleFit bounds

Two different domains, two different ranges. They are not derived from one another.

| Parameter                     | Range                      |
| ----------------------------- | -------------------------- |
| `min_minutes`                 | whole minutes, 0-10,000    |
| `rolefit_min` / `rolefit_max` | RoleFit points, 0-99       |

`min_minutes` supports realistic season thresholds such as 450, 900, 1,500 and 2,000.
Empty means no minutes threshold; `0` is a real accepted value and is not confused
with empty. 10,000 is a documented technical safety ceiling (`MINUTES_FILTER_MAX` in
`scoutboy_shared`) rather than a football limit, and stored or displayed player
minutes are never capped or altered by it. `-1` and `10001` are validation errors.

`rolefit_min` / `rolefit_max` stay on the authoritative 0-99 RoleFit scale
(`DISPLAY_SCALE_MIN` / `DISPLAY_SCALE_MAX`). The RoleFit calculation and display scale
are unchanged.

### Coherent pairs

Both inclusive pairs the rail can now express — `rolefit_min`/`rolefit_max` and
`value_min`/`value_max` — are kept coherent by one deterministic rule, so `min >
max` can never reach the API (RoleFit would silently return nothing; an inverted
asking range is a 422):

> **The edited bound wins, and its companion follows it.** Raising a minimum past
> its maximum raises the maximum to match; lowering a maximum past its minimum
> lowers the minimum to match.

The companion move is written to the control, the URL, the active-criteria
summary and the request in the same update, and nothing outside the pair is
touched. A hard-loaded URL has no edited side, so the **minimum is
authoritative**: `?rolefit_min=80&rolefit_max=20` loads as `80-80`, the same way
an off-stop age bound snaps, and the next interaction writes the canonical pair
back to the URL.

## Asking-price ordering

`sort=value_asc` and `sort=value_desc` order by `expected_asking_low_eur` — the lowest
plausible expected ask — as the explicit scalar. The expected ask is a range, and no
midpoint, composite or hidden market score is invented from it.

- ascending: known lower bounds from lowest to highest;
- descending: known lower bounds from highest to lowest;
- **a missing lower bound sorts after every known value in both directions**;
- missing market information is never represented as EUR 0;
- both directions finish with canonical-name then player-id tie-breaks.

The API-only `value_min` / `value_max` predicates are absolute EUR, must be
non-negative, and require the endpoint they depend on to be known: `value_min` needs
an expected-asking high endpoint at or above it, `value_max` needs an expected-asking
low endpoint at or below it, and an active range needs both endpoints plus an overlap
with the requested interval. Missing information fails an active predicate rather than
passing as zero. An active range with `value_min > value_max` is rejected.

## Sort modes and pagination

Accepted sort values are `rolefit_desc` (default), `rolefit_asc`, `age_asc`,
`age_desc`, `value_desc`, `value_asc` and `name_asc`. An unknown value is a validation
error, not a silent fallback to RoleFit descending. `age_desc` is deliberately
API-only: the Discovery Sort control has no option for it, so a URL carrying it is not
forwarded and the visible control always agrees with the request that was sent.

`page` is a 1-based integer and `page_size` is 1-100. Any filter or sort change resets
Discovery to page 1. A valid request for a page beyond the available pages returns the
last available page and reports the page actually served; the browser URL is
synchronized to it, so an out-of-range page is never presented as "no players match
these filters". A genuinely empty result is page 1.

Since Phase 8.1B these semantics are executed by the database rather than in Python:
the total is a distinct-player count, the effective page is chosen from it, and only
that page is retrieved with `LIMIT`/`OFFSET`. Every behaviour on this page is unchanged
— see [docs/milestone_8_discovery_contract.md](milestone_8_discovery_contract.md) for
the query architecture and the equivalence evidence.

## Evidence states

Search cards derive evidence from season-specific analysis and high-coverage membership:

- **High coverage**: member of the strict high-coverage U23 universe
- **Analyzed, limited coverage**: has at least one RoleFit rating but is not high coverage
- **Profile only**: has a season profile but no RoleFit rating

Rating value and evidence quality are separate. Unrated players do not receive zero, placeholder,
or synthetic RoleFit scores.

## Out of scope

- New defender RoleFit models
- New goalkeeper RoleFit models
- Fabricated or synthetic ratings for unrated players
- Broader league coverage not present in local assets
- Claims of current/live data
- Replacing the existing StatsBomb coverage threshold
- Deep integration with a new data provider
