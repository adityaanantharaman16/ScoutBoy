# Milestone 8 — Discovery Contract & Advanced Discovery

## Phase 8.1A — Discovery contract correctness

**Status: implemented, pending supervisory audit.**

A bounded correctness phase. No redesign: the Milestone 7 visual and interaction
system (Inter, warm-paper palette, restrained green, sharp rectangular geometry, the
existing filter rail and ranked ledger, the semantic score / confidence / coverage /
market / playstyle presentation, current responsive and accessibility behaviour) is
the unchanged baseline. No new filters, no ranking explanations, no scoring changes,
no defender or goalkeeper RoleFit — the all-position RoleFit pivot remains
Milestone 11.

The objective was to make the existing contract internally truthful before anything
is built on top of it. The central invariant:

> the role, score and confidence shown on a Discovery result must be the same stored
> role rating used to filter and order that result.

### Audited causes

1. **The role context split in two.** `players_service.search_players` resolved the
   selected role's rating for filtering and ordering, but `_to_card` serialized
   `best_role*` and `confidence` from the player's best rating, and the RoleFit
   confidence tie-break read `row.best.confidence`. Under `?role=touchline_winger`
   the sample cohort ranked correctly by Touchline Winger (83.1, 66.9, 54.8, 40.6,
   39.4) while displaying best-role scores (83.1, 66.9, **83.7**, **72.9**, 39.4), so
   a correctly ordered ledger read as mis-sorted on screen and two rows attributed
   the score of a role the query had not asked about.
2. **One ceiling for two domains.** `min_minutes` shared `SCORE_FILTER_MAX =
   DISPLAY_SCALE_MAX` (99) with the RoleFit bounds, so `min_minutes=450` was a 422
   and the frontend's shared `parseThreshold` clamped a typed or pasted 1,500 to 99.
   The rail's helper sentence stated "Whole numbers 0-99" for both inputs.
3. **Zero standing in for unknown.** The price sorts read
   `expected_asking_high_eur or 0`, so a player with no market record sorted first
   ascending as if free; `value_min` / `value_max` coerced missing endpoints with
   `or 0`, letting unknown pass a ceiling and fail a floor for no reason other than
   the substitution. Neither had a non-negative bound or a coherent-range check.
4. **Unvalidated enumerations.** `sort` was a free string resolved by
   `dict.get(sort, rolefit_desc)`, so a typo silently became RoleFit descending;
   `role` and `position_group` were unvalidated.
5. **Pagination.** The Sort control called `onChange` directly, bypassing the
   page-resetting `set` helper, so changing the ranking kept a stale page; `page` and
   `page_size` were parsed by an unbounded `Number.isFinite` check; nothing
   canonicalized a page past the end, which rendered as an empty ledger
   indistinguishable from "no players match these filters".
6. **Drifting request type.** The handwritten `SearchFilters` interface had fallen
   behind the generated contract, omitting `club`, `nationality`, `rolefit_max`,
   `value_min`, `value_max` and `universe`.

### The role-context field structure

Flat and additive, matching the existing card's convention. Two contexts, reported
side by side, never conflated:

| Group | Fields |
| --- | --- |
| best role — independent of the query | `best_role`, `best_role_display`, `best_role_score`, `best_role_confidence` |
| result role context — what filtered and ordered this row | `result_role`, `result_role_display`, `result_role_score`, `result_role_confidence` |
| discriminator | `result_role_source`: `best_role` or `selected_role` |
| compatibility | `confidence` — the applicable context's confidence, equal to `result_role_confidence` |

`best_role_confidence` and the `result_role_*` group are new. `confidence` predates
them and is retained because callers read it as the row's headline confidence; it now
follows the applicable context, which is identical to its previous value whenever no
role is selected. No `best_*` field ever carries a non-best role.

**One helper resolves the applicable rating.** `_common.applicable_rating(ratings,
role_key)` is the single definition, and `_apply_role_context` calls it once per
request to set `_Row.result`. Filtering (`keep`), ordering (`sort_key`), the
confidence tie-break and serialization (`_to_card`) all read that one field, so they
cannot drift into three readings of the same query.

### Corrected semantics

- **Filtering.** No role: the best-role rating. `role=<key>`: the stored rating for
  that role, and a player without it does not qualify. `rolefit_min` / `rolefit_max`
  apply to the applicable context's stored score. Profile-only players stay unrated
  and never receive a placeholder score.
- **Ordering.** RoleFit modes use the applicable context's stored score and break ties
  on its stored confidence; unrated records follow rated ones in both directions. The
  price modes use `expected_asking_low_eur` with unknown lower bounds after every
  known value in both directions. Every mode ends with `canonical_name` then
  `player_id`. No missing value becomes a meaningful zero.
- **Minutes vs RoleFit.** `min_minutes` is 0-10,000 whole minutes
  (`MINUTES_FILTER_MAX`, a documented technical safety ceiling that never caps stored
  or displayed minutes); `rolefit_min` / `rolefit_max` stay 0-99
  (`DISPLAY_SCALE_MAX`). Separate constants, separate parsers, separate input
  attributes, and a helper sentence that states both.
- **Validation.** `sort`, `position_group`, `role` and the price range are validated in
  the service — roles against `configs/roles/*.yaml`, position groups against
  `DISCOVERABLE_POSITION_GROUPS` — and raise `QueryValidationError`, a 422 in
  FastAPI's own body shape. No business logic entered a route handler. The documented
  compatibility fallbacks for `scope`, legacy `universe`, `age_min`/`age_max` and
  legacy `age_band` are deliberately untouched, and the Analysis Scope control stays
  retired.
- **Pagination.** Every filter and sort change resets to page 1. A page past the end
  returns the last available page and reports it; the frontend synchronizes the URL to
  the served page via the same replace-style write as any filter change, and
  `usePlayerSearch` seeds the canonical query key with the response already in hand so
  the correction costs no extra request and no skeleton flash. A genuinely empty result
  is page 1.
- **Presentation.** The ledger is unchanged. The RoleFit hero and the
  coverage/confidence line read `result_role_*`, so the visible role, score and
  confidence are the ones that ranked the row. Score magnitude, RoleFit confidence and
  evidence coverage remain three separate concepts; long role names keep the
  established word-boundary wrapping.
- **Typing.** `SearchFilters` is derived from
  `operations["search_players_api_players_get"]`, so a contract change is a compile
  error rather than silent drift. There is no second handwritten copy of the request
  schema.

### Known residual work

- `players_service.find_similar`'s "similar but cheaper" comparable group still reads
  `expected_asking_high_eur or 0`. It is a dossier comparable, not the Discovery
  asking-price sort this phase scoped, and was left alone deliberately.
- The repository still loads every player-season into memory and filters in Python.
  The SQL-side rewrite is Phase 8.1B and is explicitly out of scope here.
