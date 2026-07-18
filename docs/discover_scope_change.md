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

## Age bands

Age is calculated relative to the selected season's end date:

- All ages: no age restriction
- U23: `age <= 23`
- 24-26: `age >= 24 and age <= 26`
- 27-30: `age >= 27 and age <= 30`
- 31+: `age >= 31`

Unknown ages remain visible under All ages and are excluded from specific age bands.

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
