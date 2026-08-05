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
