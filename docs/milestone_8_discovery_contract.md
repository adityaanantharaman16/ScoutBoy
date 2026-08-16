# Milestone 8 — Discovery Contract & Advanced Discovery

## Phase 8.1A — Discovery contract correctness

**Status: complete — supervisory audit passed 2026-08-16.**

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
  The SQL-side rewrite is Phase 8.1B — see below.

---

## Phase 8.1B — Discovery query execution moves into the database

**Status: implemented, pending supervisory audit.**

A behaviour-preserving query rewrite. No product or API redesign: no new filters, no
new controls, no visual change, no scoring change, and the Phase 8.1A contract above is
unchanged in every externally observable respect. What changed is *where the work
happens*.

Before this phase, `players_service.search_players` loaded every player-season of the
current season into Python — with a `session.get(Player, pid)` per player — evaluated a
predicate per row, sorted the whole list with a tuple key, and sliced a page out of it.
The page size bounded what was *returned*, not what was read. Now the database
identifies the qualifying rows, resolves the one role rating each row is judged by,
applies every predicate, applies the approved ordering and tie-breaks, counts the
distinct qualifying players, and returns only the requested page.

The Phase 8.1A invariant is unchanged and is now structural rather than procedural:

> the role, score and confidence shown on a Discovery result are the same stored role
> rating that filtered and ordered that result.

In 8.1A one helper (`_common.applicable_rating`) resolved that rating once per request
and every consumer read the result. In 8.1B the *same joined row* supplies the score
that bounds the row, the score and confidence that order it, and the figures that are
serialized, so they cannot disagree. `applicable_rating` had no remaining caller and
was removed.

### What moved into SQL

| Concern | Before | Now |
| --- | --- | --- |
| candidate set | every season appearance loaded, `session.get` per player | one season-scoped query |
| best-role rating | `sorted(ratings, …)[0]` in Python | `NOT EXISTS` anti-join |
| selected-role rating | `next(r for r in ratings …)` | `NOT EXISTS` anti-join, inner-joined |
| scope, text, categorical, age, minutes, RoleFit, market, playstyle predicates | a Python `keep()` per row | `WHERE` clauses and `EXISTS` predicates |
| ordering and tie-breaks | `list.sort(key=…)` | `ORDER BY` with explicit rank/sentinel expressions |
| total | `len(filtered)` | `COUNT(DISTINCT players.id)` |
| page | `filtered[start:start+size]` | `LIMIT` / `OFFSET` |
| card enrichment | already in memory | one bulk query for the page's ids |

`apps/api/app/repositories/discovery_repo.py` is the new home for the query;
`players_service.search_players` normalizes the request, canonicalizes the page against
the total, and serializes. The route is unchanged.

### How the two role contexts are resolved

Both are resolved by the same shape of subquery — "keep this rating unless another
rating of the same group outranks it" — so neither can multiply a candidate:

- **best role**: `ORDER BY final_score DESC, role_key ASC, id ASC`, expressed as a
  `NOT EXISTS` anti-join. Outer-joined, so an unrated player still appears under
  `all_records` and still qualifies as unrated.
- **selected role** (`role=<key>`): the stored rating for exactly that role, lowest id.
  **Inner**-joined, which is what makes a player without that rating fail to qualify.

`best_role*` always describes the player's own best stored rating, whatever was
filtered. `result_role*` describes the applicable context, and `confidence` equals
`result_role_confidence`. Nothing is rescored, in SQL or in the frontend.

### Missing values, ordering and dialect independence

No ordering depends on the database's default NULL placement. Every "unknown" carries
an explicit rank or the same sentinel the previous Python sort key used:

- **RoleFit**: `CASE WHEN score IS NULL THEN 1 ELSE 0 END` first, then
  `COALESCE(score, 0.0)`, then the confidence rank (`unknown < low < medium < high`),
  descending in **both** directions. Unrated records follow rated ones either way.
- **Asking price**: `CASE WHEN expected_asking_low_eur IS NULL THEN 1 ELSE 0 END`
  first, then `COALESCE(low, 0.0)`. A missing lower bound trails every known one in
  both directions, and is never rendered as EUR 0.
- **Age**: `COALESCE(age, 999)` ascending, `-COALESCE(age, -1)` ascending — the exact
  sentinels the previous tuple key used.
- **Name**: `canonical_name` lowercased the way Python's `str.lower()` does it (see
  [Unicode case folding](#unicode-case-folding) below) and collated to code-point order
  (`BINARY` on SQLite, `"C"` on PostgreSQL) so the tie-break matches the previous Python
  ordering on both databases. PostgreSQL's default locale collation would not. The two
  are separate concerns: the lowering decides the value, the collation decides how the
  lowered values compare.
- Every mode ends with canonical name then player id.

**Age is never computed with dialect-specific date arithmetic in a predicate.** The
rounded age is `round((season_end - birth_date).days / 365.25, 1)`, a step function of a
whole number of days, so every age bound has an exact equivalent birth-date boundary.
The service derives that boundary in Python (`_days_for_age_floor` /
`_days_for_age_ceiling` step around a closed-form estimate using the very same rounding
expression) and the database compares stored dates. A record with no birth date is
therefore visible with no bound active and excluded by every active bound, which is
what a NULL date comparison already yields. Non-finite and absurd bounds are answered,
not raised: infinity narrows to nothing, `NaN` excludes only unknown ages, exactly as
the previous float comparison did.

The age *ordering key* is the only place Discovery does date arithmetic in SQL. It uses
SQLAlchemy's portable `extract("epoch", …)` — `STRFTIME('%s', …)` on SQLite,
`EXTRACT(epoch FROM …)` on PostgreSQL — and is asserted equal to the Python expression,
per birth date, on whichever dialect is running. Rounding cannot diverge: `days/365.25`
lands exactly on a `k/10 + 1/20` midpoint only when 80 divides an odd number, which
never happens, so half-up, half-even and half-away-from-zero all agree.

### Unicode case folding

Discovery's case-insensitivity was Python's `str.lower()` before this phase — free-text
search, the club and league substring predicates, the nationality equality predicate, and
the canonical-name ordering key all went through it. Preserving that means reproducing
the full Unicode lowercase mapping, including its one expanding mapping (`İ` → `i` +
U+0307) and the context-sensitive Greek final-sigma rule (`ΟΔΟΣ` → `οδος`).

**Neither database's own `lower()` does that, and one of them is not even stable across
deployments:**

| | behaviour of the database's own `lower()` |
| --- | --- |
| SQLite | ASCII-only, always. `lower('Étienne')` is `'Étienne'`. |
| PostgreSQL | follows the database's `LC_CTYPE`. On this project's own cluster (initdb'd `LC_CTYPE=C`) it is **also** ASCII-only: measured, it differs from `str.lower()` for 1,407 of the 1,433 cased code points. Under a UTF-8 locale it applies libc's *simple* mapping, which still cannot produce the two-code-point `İ` result and has no final-sigma rule. |

An earlier version of this phase tried to close the gap by folding the needle's uppercase
forms into the haystack with bounded `replace()` calls. That works only where a
character's lowercase round-trips through `.upper()`, and Unicode lowercase mappings are
frequently neither one-to-one nor reversible: `İ` lowercases to *two* code points and
nothing uppercases to it; `ß`'s uppercase is `SS`, so `ẞ` could not be found by inverting
it; the Kelvin (U+212A) and Ohm (U+2126) signs lowercase to `k` and `ω`, whose uppercase
forms are the ordinary `K` and `Ω` at different code points; and `ſ` is already lowercase,
so inverting `.upper()` would have wrongly folded plain `s` into it. It also could not
help the ordering key at all, which must lowercase whole stored names rather than a known
needle.

The lowering is therefore explicit, in `app/core/text_search.py`, as one expression with
a per-dialect compilation:

| dialect | compiles to | mechanism |
| --- | --- | --- |
| SQLite | `scoutboy_unicode_lower(x)` | a deterministic connection function that *is* `str.lower()`, registered by a global SQLAlchemy `connect` listener so every engine the project creates — application, tests, Alembic — has it on every pooled connection |
| PostgreSQL | `lower(x COLLATE "unicode")` | PostgreSQL 16's built-in ICU root collation. ICU applies Unicode **full** case mapping, so it reproduces the `İ` expansion and the final-sigma rule regardless of the database's own `LC_CTYPE` |

Both sides implement the same thing, and `discovery_parity.py` holds them to it with the
same assertion body on both dialects: the expression is compared directly against
`str.lower()` for a probe set, then through the search, equality and ordering predicates.

**Stated limitation.** ICU ships its own Unicode tables, which can lag CPython's.
Measured with the shipped expression on PostgreSQL 16.15 (ICU collation version 153.14,
Unicode 15.0) against CPython 3.13.14 (Unicode 15.1), **40 of the 1,433 cased code points
diverge**. All 40 diverge the same way — ICU does not recognise the character and returns
it unchanged, rather than lowercasing it differently — and they are 35 Vithkuqi letters
(U+10570..U+10595), four recent Latin additions (U+A7C0..U+A7D8) and one Glagolitic letter
(U+2C2F). **Zero** of them lie in the Latin, Latin-1, Latin Extended, Greek, Cyrillic or
Letterlike-Symbols ranges that a player, club or competition name is written in.
`test_postgres_smoke.py` re-measures this against the live server on every smoke run and
fails if any divergence reaches those ranges, so the residual cannot quietly grow into
real names. SQLite has no such residual: it is `str.lower()` itself, and is swept against
the entire repertoire.

The free-text haystack reproduces `" ".join(filter(None, …))` exactly, separator
placement included, because a needle may legally span two fields. `%`, `_` and the LIKE
escape character in a needle stay literal — the needle is escaped, never interpolated into
a pattern — and the cohort carries a decoy for each so a wildcard reading would fail
loudly.

### Count, page and enrichment

The total is a `COUNT(DISTINCT players.id)` over the same candidate relation, so it
cannot be inflated by a one-to-many join and is known *before* any row is fetched. The
effective page is then `min(page, total_pages)`, and only that page is queried, with
`LIMIT`/`OFFSET`. A page past the end therefore costs one aggregate and one page — never
a full scan that is later sliced. A genuinely empty result issues no page query and no
enrichment query at all.

Card enrichment is bounded to the page: the candidate row already carries identity,
club, league, minutes, position group, both role contexts, high-coverage membership and
the market figures, so the only remaining query binds the page's player ids to load
their playstyle badges.

### Evidence

**Query count.** Instrumented at the SQLAlchemy statement level. One Discovery request
issues **four** statements — current season, count, page, page playstyles — and **two**
for an empty result. The count does not move with cohort size, page size, the number of
returned players, the role context, or how deep the page is:

| cohort players | request | page size | statements |
| --- | --- | --- | --- |
| 24 | default (best-role context) | 20 | 4 |
| 24 | selected role | 20 | 4 |
| 24 | selected role | 100 | 4 |
| 24 | filters + playstyle + sort | 20 | 4 |
| 24 | page past the end | 20 | 4 |
| 24 | empty result | 20 | 2 |
| 524 | default (best-role context) | 20 | 4 |
| 524 | selected role | 100 | 4 |
| 524 | page past the end | 20 | 4 |
| 5,024 | default (best-role context) | 20 | 4 |
| 5,024 | selected role | 20 | 4 |
| 5,024 | selected role | 100 | 4 |
| 5,024 | filters + playstyle + sort | 20 | 4 |
| 5,024 | page past the end | 20 | 4 |
| 5,024 | empty result | 20 | 2 |

The tests assert a documented ceiling of 8 rather than an exact 4, so an extra lookup
is allowed but per-player work is not, and they additionally assert that no statement
mentions a single player id — which is what the removed `session.get(Player, pid)`
pattern looked like.

**Semantic equivalence.** Two independent proofs.

1. A differential suite: a purpose-built cohort is queried through both the SQL
   implementation and a transcription of the previous in-Python one, across **73 filter
   combinations × 7 sort modes = 511 comparisons**, asserting identical ids, order,
   total, served page and page count. Because the reference is a transcription, its
   case-insensitivity is Python's own `str.lower()`, so every Unicode case below is
   differenced against the real pre-8.1B behaviour rather than against a restatement of
   the new one. The cohort deliberately contains conflicting best/selected ratings, tied
   scores with differing confidence, two players sharing a name *and* score *and*
   confidence so only the player id can separate them, unrated players, missing birth
   dates, missing market rows, market rows with only one endpoint, concern-only
   playstyles, high-coverage members and non-members, a player with three appearances, a
   player with two appearances of identical minutes, a position-group fallback, an
   unmapped position, an accented club name, two players whose rounded age is equal but
   whose birth dates are not, and — added by the Unicode correction — the `É`, `İ`, `ẞ`,
   Kelvin-sign, Ohm-sign, long-`ſ`, Greek final-sigma, Greek and Cyrillic cases, two
   pairs of *different* names that lowercase to the *same* key so only the player id can
   order them, and `%`, `_` and `/` names each with a decoy a wildcard reading would
   also match. **34 of the 73 filter cases** are Unicode or LIKE-metacharacter cases.
2. An end-to-end control run: the pre-8.1B API (a detached worktree at commit `0de9d6f`,
   which still filters and sorts in Python) and the corrected API were served from the
   **same** fixture database on two ports, and **448 request variants** (Unicode
   free-text needles, Unicode nationality/club/league predicates, LIKE-metacharacter
   needles, and every sort with pagination — 406 of them non-empty) returned
   **byte-identical** JSON. The fixture database was seeded with Unicode-named players,
   clubs and competitions specifically so the comparison exercises the corrected
   behaviour rather than agreeing trivially on ASCII data.

**Volume.** A deterministic ~5,000-record cohort (5,024 players including the
characterization rows) with real ratings, markets, playstyles, repeated scores, missing
birth dates, missing market rows and missing endpoints. It asserts correct totals and
page counts, byte-identical repeated output, a bounded statement count, page-sized
materialization, and that a full page walk visits every player exactly once. There is
no wall-clock threshold.

### Indexes

Four composite indexes were added — `(season_id, player_id)` on `appearances`,
`role_ratings`, `market_values` and `player_playstyles` — in the ORM metadata and in
Alembic migration `0006_discovery_query_indexes`, verified to upgrade, downgrade and
re-upgrade cleanly.

They are not speculative. Every per-candidate lookup Discovery makes is season-scoped
and player-correlated, and the pre-existing indexes lead with only one of those two
columns. `EXPLAIN QUERY PLAN` on the 5,000-player cohort, before and after:

```
SEARCH best_rating USING INDEX ix_role_ratings_season_id (season_id=?)   -- before
SEARCH best_rating USING INDEX ix_role_ratings_season_player (season_id=? AND player_id=?)
```

The Discovery count went from roughly **1.1s to roughly 7ms**, and a playstyle-filtered
search from roughly **555ms to roughly 14ms**. A test asserts the plan still uses all
four and contains no per-candidate `SCAN`, and another asserts the ORM metadata and the
migration declare exactly the same set, so an index cannot be added to one without the
other.

`player_universe_memberships` was deliberately excluded: its existing unique constraint
already leads with `player_id` and serves its `EXISTS` probe.

The "one row per group" shape is a correlated `NOT EXISTS` rather than a `ROW_NUMBER()`
window for the same measured reason. The window form was implemented and profiled
first: SQLite materializes the ranked relation and then re-scans it once per candidate
(`SCAN best_rating LEFT-JOIN`), which no index can fix because the relation is
ephemeral. The anti-join reads real tables that both databases can satisfy from an
index.

### SQLite / PostgreSQL validation

`apps/api/app/tests/discovery_parity.py` holds one body of assertions — the differential
matrix plus explicit filtering, selected-role ordering, unknown-last ordering, counting,
pagination, tie-break, rounded-age, position-group, Unicode lowercase, Unicode search,
LIKE-literal, name-ordering and null-season-end checks — and is run by **both** the
SQLite suite and the PostgreSQL smoke, which now also asserts the four composite indexes
are present on PostgreSQL and that the ICU collation the text predicates depend on
exists. The cohort is written inside a transaction and rolled back, so neither database
is left changed. A dialect disagreement fails one of the two runs. There is no weaker
PostgreSQL variant of any assertion: both dialects run the identical body.

This was executed against a real PostgreSQL 16.15 server (migrate from base to head,
ingest the sample provider, recompute, then the smoke), not only in CI, and it **found a
defect SQLite had hidden**: with a season that has no end date, the age ordering key was
a bare `literal(None, Numeric)`. Sent as an untyped parameter, PostgreSQL infers `text`
and then refuses to return it through a numeric result processor
(`Unknown PG numeric type: 25`); SQLite is untyped enough not to notice. `Season.end_date`
is nullable, so that is a reachable production state. The expression is now an explicit
`CAST(NULL AS NUMERIC)`, and a parity assertion drives a real Discovery request — all
four sort modes and three age bounds — against a season whose end date has been nulled,
so the whole path is covered on both dialects rather than just the expression.

### Remaining limitations

- The Leverkusen-centered pilot limitation is unchanged: the real data is still 34
  StatsBomb matches around one club, and nothing here widens coverage or makes any
  claim about data quality.
- The volume evidence is a 5,000-record deterministic fixture on SQLite. That
  demonstrates the query shape does not degrade with cohort size and that no per-player
  work remains; it is not a production capacity claim, a benchmark of PostgreSQL under
  concurrency, or a latency SLO. The PostgreSQL run used the 24-player sample cohort,
  so the volume evidence itself is SQLite-only.
- The recorded query plans are SQLite's `EXPLAIN QUERY PLAN`. The indexes were verified
  to exist on PostgreSQL and every parity assertion passes there, but PostgreSQL's own
  planner output was not captured.
- **Unicode lowercasing on PostgreSQL is ICU's, not CPython's.** The two implement the
  same rule (Unicode full case mapping, final sigma included) and agree on every
  character a Latin, Greek or Cyrillic name can contain, but ICU carries its own Unicode
  tables. Measured today: 40 of 1,433 cased code points — 35 Vithkuqi, four recent Latin
  additions, one Glagolitic — are left unchanged by ICU where CPython lowercases them.
  Zero are in name-bearing ranges, and the smoke fails if that ever stops being true. It
  is a version-table lag, not a semantic difference, and it is not claimed to be zero.
  SQLite has no equivalent residual: its function is `str.lower()` itself.
- Discovery's text predicates now require a PostgreSQL built with ICU (PostgreSQL 16
  ships the `unicode` collation when it is). ADR 0001 already pins PostgreSQL 16; a
  server without ICU fails the smoke with an explicit message rather than silently
  matching less.
- `find_similar` still assembles the whole position-group cohort in Python; it needs
  every candidate to score cosine similarity. Its `expected_asking_high_eur or 0`
  residual from 8.1A is also still there. Both remain out of scope.
- The visual-regression baselines could not be compared meaningfully on the authoring
  machine: the committed images were captured with Chromium 1208 / WebKit 2248, and the
  pinned Playwright now requires 1228 / 2311, whose text rasterization differs. The
  mismatch is renderer-side and affects surfaces Discovery does not touch. See the
  Phase 8.1B verification notes for the evidence.
