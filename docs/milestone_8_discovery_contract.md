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

**Status: implemented and supervisory-audited.**

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

---

## Phase 8.2 — Advanced Discovery interface

**Status: implemented and supervisory-audited.**

The main interface phase exposes the existing Phase 8.1 query contract without changing
the scoring model or database schema. Its corrective pass then makes three bounded query
semantics changes — partial nationality, league-country matching and deterministic club
aliases — and updates the OpenAPI descriptions accordingly. The final
`docs/api_contracts/openapi.json` and `apps/web/src/lib/api/schema.gen.ts` artifacts are
current and regenerate byte-identically. The primary change is how much of the contract
Discovery's rail can express, and how it stays readable while doing it.

Before 8.2 the rail exposed six filter groups. `league` and `playstyle` could be
supplied in a URL with no production control; `club`, `nationality`, `rolefit_max`,
`value_min` and `value_max` were reachable only by hand-writing an API request. A scout
could not compound "Bundesliga, under 25, at least 900 minutes, RoleFit 70-90, asking
under EUR 30M" from the interface at all.

Phase 8.2 exposes all seven, and keeps the default rail **shorter** than the one it
replaces, by moving the two existing specialized thresholds behind the same disclosure.

### Exactly which filters are exposed

Only parameters `GET /api/players` already accepts. Nothing was added to the backend and
nothing is filtered in the browser: one request carries every predicate and the ledger
renders exactly the rows it returns.

| Control | Parameter | Where it lives | Semantics |
| --- | --- | --- | --- |
| Search | `q` | core | case-insensitive substring across name, club, league, primary position |
| Age Threshold | `age_min` **or** `age_max` | core | the unchanged five-stop one-sided control |
| Position Group | `position_group` | core | `ATT` / `MID` / `DEF` / `GK` |
| Role | `role` | core | selected-role context (see Phase 8.1A) |
| Sort | `sort` | core | the six representable modes; **not** a narrowing criterion |
| League | `league` | Advanced → Context | case-insensitive substring over slug, name **and country** |
| Club | `club` | Advanced → Context | case-insensitive substring, with a deterministic alias table |
| Nationality | `nationality` | Advanced → Context | case-insensitive **substring** |
| Minimum Minutes | `min_minutes` | Advanced → Evidence & Fit | whole-season minutes, 0-10,000 |
| Minimum RoleFit | `rolefit_min` | Advanced → Evidence & Fit | 0-99, applicable role context |
| Maximum RoleFit | `rolefit_max` | Advanced → Evidence & Fit | 0-99, applicable role context |
| Playstyle | `playstyle` | Advanced → Evidence & Fit | a qualifying **positive** badge, never a concern |
| Minimum Expected Asking | `value_min` | Advanced → Market | absolute EUR; typed in EUR millions |
| Maximum Expected Asking | `value_max` | Advanced → Market | absolute EUR; typed in EUR millions |

RoleFit bounds apply to the **applicable role context**: each player's stored best role
with no `role` selected, and only that role's stored rating when one is. All active
filters compose with AND. The three Context predicates are detailed in
[Phase 8.2 corrective pass](#phase-82-corrective-pass--context-search-decimal-typing-and-utf-8).

**Deliberately not exposed.** Analysis Scope stays retired (Phase 8.1A): the rail has no
scope selector, the ledger header reports none, and the active-criteria list does not
offer one either — listing it as removable would reinstate the control by the side door.
A scope-bearing or `universe=`-bearing URL still loads and is still honoured, and Clear
All drops it from the canonical URL. Legacy Age Band keeps its documented normalization.

**Confidence, evidence state and concern filtering remain unsupported.** They may be
future product concepts, but `GET /api/players` has no predicate for any of them. No
control was invented, and nothing is filtered out of already-returned rows to fake one.

### Units: EUR millions in, absolute EUR out

The asking-price inputs are the one place in the product with two units, because
`12500000` is unreadable in a 248px column and one keystroke away from a tenfold error.
The **input** is EUR millions; the **request, the URL and `SearchFilters`** are absolute
EUR, exactly as the contract states.

| typed | URL / API |
| --- | --- |
| `5` | `value_min=5000000` |
| `12.5` | `value_max=12500000` |
| `0` | `value_min=0` |

The conversion lives in `lib/filters` (`parseAskingMillions` / `askingMillionsInput`), not
in the component, so the input, the URL, the readable summary and the request cannot
disagree about which unit they hold. Blank is no bound; zero is a real bound; non-finite
and negative values are rejected as no bound rather than clamped, because there is no
meaningful ceiling to clamp to and rewriting `-5` as `0` would invent an active predicate.
Conversion rounds to whole euros, so a hard-loaded `value_min=1234567` displays as
`1.234567` and round-trips back to the same euros instead of being quietly rewritten as
EUR 1.2M by its own control.

Readable summaries go through the shared `formatEur`, so a bound reads exactly like every
other euro figure in the product. **No midpoint of the two bounds is ever computed or
shown**, and the copy says "Expected Asking" throughout.

### Missing-data behaviour

Unchanged from the backend contract, and now stated in the rail:

- an asking-price bound requires the endpoint it depends on to be **known**; a player
  with no expected asking fails an active predicate rather than passing as EUR 0;
- an active range needs both endpoints plus an overlap with the requested interval;
- RoleFit bounds require a stored rating; unrated players never receive a placeholder;
- an unknown age is excluded by any active age bound and visible when none is active.

### Progressive disclosure

The rail is one bordered panel divided by internal hairlines into square regions — the
same construction as the results ledger beside it, so the two columns read as objects of
one kind and their top edges still align.

```
  Narrow results                          URL-backed     header
  3 Active Criteria                        Clear All     active criteria (absent when none)
    Search: Anton · League: Bundesliga · +1 more
  Search / Age Threshold / Position Group / Role / Sort   core controls
  Advanced Filters                              [3] +     disclosure
      Context                                   [1] +
      Evidence & Fit                            [2] −
        Minimum Minutes / Minimum RoleFit
        Maximum RoleFit / Playstyle
      Market                                        +
```

Rules, all enforced by test:

- **One category open at a time.** Opening Market closes Context, so the expanded rail
  stays roughly one category tall however many criteria are in play.
- **Closing never clears.** Every field is derived from URL-backed request state, so
  collapsing is pure presentation: no value changes, no URL write, no refetch. A closed
  category keeps reporting its own active count.
- **Open state is local, not URL state.** A shared link describes a cohort, not which
  drawer the sender had open. It is seeded once at mount from the hydrated request: a
  hard-loaded compound URL opens Advanced Filters onto the first category it is actually
  using, so nothing is active-but-invisible.
- Both regions stay in the DOM and toggle with the `hidden` attribute, so every
  `aria-controls` reference resolves in both states and no field is focusable while its
  category is shut.

Advanced Filters and each category header are the same component (`FilterDisclosure`): a
real `<button>` with `aria-expanded`, `aria-controls`, a 44px (category: 40px) row, the
product's shared focus ring, and an accessible name that speaks its count
("Advanced Filters, 3 active"). Enter and Space are the platform's.

Field grids repeat the core grid's three column counts — one column below 640px, two on
tablet, one again in the narrow desktop rail — with **no `order` utilities anywhere**, so
DOM order is visual and keyboard order at every width.

### Range safety

RoleFit and asking-price pairs must never send `min > max`: RoleFit would silently return
nothing and `value_min > value_max` is a documented 422. One deterministic rule,
implemented once in `coherentBounds` and used by both pairs and both entry points:

> **The edited bound wins, and its companion follows it.** Raising a minimum past its
> maximum raises the maximum to match; lowering a maximum past its minimum lowers the
> minimum to match.

The edit is never discarded or withheld, and the companion move is written to the
control, the URL, the active summary and the request in the same update, so all four
always agree. Nothing outside the pair is touched. A hard-loaded URL has no edited side,
so the **minimum is authoritative**: `?rolefit_min=80&rolefit_max=20` loads as `80-80` —
the same normalization the age control already applies to an off-stop URL bound — and the
next interaction writes the canonical pair back. A browser-level assertion records every
`/api/players` request made during a range edit and fails if any carries an inverted pair.

### Active criteria

A compact area directly below the filter header, **absent entirely** when nothing
narrows. Collapsed it is one square row: the total count, the first two criteria in rail
order, and "+N more", with a long search needle or club name truncating rather than
widening the rail. Expanded it is one flat rectangular row per criterion — field, readable
value, and a remove action named after it ("Remove League: Bundesliga."). These are
deliberately **not** `DisplayTag`s: a display tag is a non-interactive semantic label with
no tab stop, and these are filter controls.

Clear All sits in the header row rather than only inside the expanded list, so a complete
reset is always one press away — including from a zero-result ledger, which is when it
matters most.

- **Removing one criterion** clears only its own parameters, resets to page 1, and
  carries every unrelated criterion through untouched. Removing Age clears `age_min`,
  `age_max` **and** the legacy `age_band`, so a criterion that arrived through a legacy
  link does not survive its own removal.
- **Clear All** hands the serializer exactly the default request
  (`scope=analyzed`, `sort=rolefit_desc`, `page=1`, `page_size=12`), which produces the
  clean root URL: every default is omitted and any legacy `scope` / `universe` /
  `age_band` the incoming link carried is simply not among the keys written back.
  Device-local shortlist and compare state lives outside the URL and is untouched.
- **Focus survives both.** The removed button is gone, so the next stop is chosen
  explicitly: the remove action that slid into that position, else the last one, else
  Clear All, else the summary toggle, else the Search box. Focus is never left on
  `<body>`.

A typed zero is a real, listed, removable bound throughout — `min_minutes=0`,
`rolefit_min=0` and `value_min=0` all appear in the list and the counts.

### Result communication

The ledger header reports four facts and only four: total matching players, the number of
active narrowing criteria when nonzero, the season, and the current page of the total.
The criteria are **counted, never listed** — Phase 8.2 can carry thirteen at once, and
spelling them out would turn the ledger's header into a second filter rail; the readable
list with a remove action per criterion belongs in the rail beside it. Zero is reported as
silence, not as "0 active criteria". Both counts come from one derivation
(`lib/filters/criteria.ts`), so the rail and the header cannot disagree.

The atomic `pane-enter` replacement is unchanged, so a stale count and fresh rows can
still never be seen together. Empty and error states leave the rail fully usable — it is a
sibling of the results pane — and the empty state names the recovery route ("Remove one of
the 3 active criteria in the filter rail, or Clear All.").

### Playstyle options come from the Methodology contract

`usePlaystyleOptions` reads `GET /api/methodology`, which serializes the same
`configs/playstyles/playstyles_v1.yaml` the engine applies badges from. A hand-written
list in the frontend would be a second copy free to drift from the keys the backend
actually filters by. Only `positives` are offered: `playstyle=<key>` matches a qualifying
positive badge (`is_concern = false`), so offering a concern would silently return
nothing. A browser test compares the select's options against the Methodology page's own
rendered playstyle tags and asserts every concern is absent. A key a slow contract has not
delivered yet still renders as the selected option, so the control never disagrees with
the request.

### Sticky rail

The compact rail keeps its approved `lg:` stickiness at the same 16px offset, and
**releases to normal document flow while a disclosure region is showing**. A sticky box
taller than the scrollport pins itself at its offset and puts everything past the
viewport's bottom edge permanently out of reach; the alternative — a nested scroller
inside the rail — is explicitly not allowed. The rule is CSS-only
(`.filter-column:has(.filter-region:not([hidden]))`) and keys on region *visibility*
rather than on `aria-expanded`, because a category header inside a closed Advanced region
legitimately reports itself expanded while contributing no height.

### Visual system

No new geometry. Every new rectangle is 90 degrees; there are no pills, chips, bubbles,
glass effects, gradients, glows or decorative shadows. Open state is an inset marker plus
a `+`/`−` glyph — paint only, never a dimension — so opening a category cannot shift the
rail, the ledger, or their shared top edge. The disclosure rows join the existing
`background-color, box-shadow` transition rule rather than adding a fourth cadence; the
remove and Clear All actions join the existing `.btn`/`.input` feedback rule. **No layout
property is animated**, disclosure content appears in the same frame, and under
`prefers-reduced-motion: reduce` the rail runs zero animations. The 2px Discovery
heart/Compare rail remains the single documented rectangular exception; no second one was
created. The desktop rail stays inside its 240-280px track with every category open.

### Evidence

**Frontend unit tests — 586 passing across 21 files** (was 436 across 19).

| suite | what it holds |
| --- | --- |
| `discovery-criteria.test.ts` (new, 47) | EUR millions ↔ absolute EUR both ways and round-tripping, blank/zero/negative/non-finite, the range rule exhaustively over every `{min, max, edited}` combination, the criteria model, per-category counts, removal patches |
| `discovery-advanced-filters.test.tsx` (new, 78) | the disclosure contract, single-open categories, counts, the collapsed summary and "+N more", individual removal, Clear All, focus restoration, the URL contract for all seven new fields, compound hydration, reload and back/forward, empty-result recovery, unsupported filters absent, DOM/tab order |
| `discovery-filters.test.tsx` (81) | every Phase 8.1 gate, updated: retired scope, the age control, legacy `age_band`, both threshold domains plus the new RoleFit ceiling, sort, pagination canonicalization, the ledger header |
| `filter-layout.test.tsx` (48) | the new panel composition, the five-item core grid, category grids and helper spans, the disclosure/criteria CSS contract, the sticky-release rule, Title Case copy |
| `sharp-corners.test.tsx` | unchanged source scan and rendered-DOM audit, now covering the new components |

`discovery-advanced-filters.test.tsx` runs a **live URL harness**: the mocked
`useSearchParams` subscribes to what the rail writes, exactly as Next.js keeps it in sync
with the native History methods, so "remove a criterion" is a real state transition rather
than a string assertion about an address bar.

**Browser tests — 305 passing across 15 files** (was 265), on Chromium against the
committed sample fixture cohort through a production build.

- `discovery-advanced.spec.ts` (new, 40): the collapsed rail's contents, Enter/Space on
  every disclosure, one-category-at-a-time from the keyboard, closing changing neither URL
  nor ledger, focus escaping an open region, a hard-loaded compound link restoring every
  control **and** narrowing the ledger with per-row AND verification, reload,
  back/forward, no history entry per keystroke, EUR-millions typing, the range invariant
  checked against every recorded request, individual removal with page reset, focus after
  removal, Clear All to the clean root URL, legacy-parameter stripping, favourites and
  compare surviving it, zero-result recovery two ways, truncation, **seven viewports** ×
  (no overflow collapsed and with each category open, field sizes, target sizes,
  accessible names), rail/ledger alignment at 1024/1280/1440, focus order following visual
  order, no animated layout property, and reduced motion.
- `sharp-corners.spec.ts`: a computed-radius scan of every Phase 8.2 surface open and
  closed; the collapsed rail proven materially shorter than the expanded one and restored
  exactly on close; sticky release with the last control reachable by page scrolling; no
  nested scroller in the rail.
- `accessibility.spec.ts`: axe with the active-criteria list expanded and with each of the
  three categories expanded, plus the same at 320×720 and at 640×720 (200% desktop zoom).
  **Zero violations.**
- `discovery-contract.spec.ts`, `filters-and-cards.spec.ts`, `main-flow.spec.ts`,
  `resilience.spec.ts`, `motion.spec.ts`, `typography.spec.ts`, `display-tags.spec.ts`,
  `cross-surface.spec.ts`: the pre-existing gates, updated for the new structure rather
  than dropped.

**Cross-browser:** `playwright.cross-browser.config.ts` — Chromium 11/11, Firefox 11/11
and WebKit 11/11 pass, including the Discovery filter flow.

**Contract:** `app.export_openapi` + `pnpm gen:api` regenerate
`docs/api_contracts/openapi.json` and `apps/web/src/lib/api/schema.gen.ts`
**byte-identical** (MD5 unchanged both sides). No contract drift, intended or otherwise.

### Limitations

- **Visual-regression baselines were not compared, and were not regenerated.** The Phase
  8.1B renderer-version mismatch is unresolved — the committed images were captured with
  Chromium 1208 / WebKit 2248 and the pinned Playwright now requires 1228 / 2311 — so a
  pixel difference on this machine would measure rasterization rather than the product.

  The Discovery baselines **will** legitimately change: the rail's construction, its
  header row and the ledger header's wording all changed. They were deliberately left
  alone. Regenerating them on a renderer that does not match the platform that captured
  the originals would bake this machine's rasterization into the reference set, which is
  exactly the failure mode `playwright.visual.config.ts` warns about. `tests/visual/` is
  untouched by this phase (`git status` is clean for it); regenerating and hand-reviewing
  those images belongs with a release-review run on the reference platform.
- **The `has()` sticky release requires `:has()` support** (Chromium 105+, Safari 15.4+,
  Firefox 121+). The pinned Chromium, WebKit and Firefox engines all exercise the phase's
  disclosure flows successfully.
- **Nationality has no enumeration.** The backend matches it by case-insensitive equality
  against stored values and the frontend has no list of countries to offer, so it is a
  free-text field with its semantics stated in the helper copy. A typo returns nothing
  rather than a suggestion.
- **The playstyle options depend on `GET /api/methodology`.** If that request fails the
  select falls back to "Any Playstyle" plus whatever key the URL carried; every other
  control is unaffected. There is no retry beyond React Query's default.
- Discovery's own request cost is unchanged: this phase adds predicates the query already
  supported and no new statement. The extra methodology request is one cached call per
  session.
- The Leverkusen-centered pilot limitation is unchanged. Nothing here widens coverage or
  makes any claim about data quality.

---

## Phase 8.2 corrective pass — Context search, decimal typing and UTF-8

**Status: implemented and supervisory-audited.**

A focused repair pass over the Phase 8.2 surface after its layout, responsive,
accessibility and sharp-corner audits had passed. Five defects, no redesign: the
information architecture, the 240-280px rail, the one-category-open rule, the square
geometry and the retired controls are all untouched.

### Root causes

| # | Symptom | Cause |
| --- | --- | --- |
| 1 | `nationality=Eng` returned nothing, so the field read as broken | the predicate was case-insensitive **equality** |
| 2 | `England`, `Portugal`, `Italy` matched no league; `eng`, `por`, `ita` only appeared to work | the predicate searched `slug` + `name`, and those codes happen to lead the stored slugs. `Competition.country` was never searched |
| 3 | `club=psg` and `club=spurs` returned nothing | a bare substring cannot turn an abbreviation into a stored name |
| 4 | a trailing space in a Context field silently matched nothing | `parseTextFilter` deliberately did not trim, on the mistaken premise that trimming would eat the space between two words |
| 5 | typing `12.5` into an asking bound one key at a time never got past `12.` | the controlled `<input type="number">` re-derived from the canonical URL value on every keystroke, and the browser's own value sanitization rewrote the intermediate state. `fill("12.5")` sets the whole value at once and hid it |

### 1. Nationality is a substring

`nationality` is now a case-insensitive **literal substring** of the stored value, so
`Eng`, `england` and `ENGLAND` all match England. Nothing else moved:

- case folding is still Python's `str.lower()` on both dialects, so `TÜRKİ` matches the
  stored `TÜRKİYE` while a naive `türkiye` still does not — the change widened the match,
  it did not weaken the Unicode rule;
- `%`, `_` and the LIKE escape character stay literal (the needle is escaped, never
  interpolated into a pattern), and the cohort carries a decoy for each so a wildcard
  reading would fail loudly. That matters more than before: substring matching made
  nationality a second place a needle could have reached a pattern;
- a player with **no** stored nationality still fails an active predicate — a `COALESCE`
  to the empty string can contain no non-empty needle — however short the needle is;
- AND composition with every other filter is unchanged.

### 2. League searches the country too

The league haystack is now `slug` + `name` + **`country`**, joined by the same
`_space_joined` helper the free-text search uses, so a missing country simply
contributes nothing. `Competition` was already outer-joined, so this adds no join, no
statement and no scan.

| typed | matches through |
| --- | --- |
| `England`, `Germany`, `France`, `Portugal`, `Italy`, `Spain` | the stored country |
| `eng`, `ger`, `fra`, `por`, `ita`, `esp` | the slug code, and for most of them the country as well |
| `Premier League`, `Serie A` | the name |
| `eng_premier_league` | the slug |

`portgual` is a **single curated misspelling**, resolved by the alias table below to
`portugal`. It is not fuzzy matching: `portugual`, `portgal`, `prtugal`, `englnd` and
`germny` all return nothing, and a test asserts exactly that.

### 3. Club abbreviations and nicknames

A versioned registry at **`configs/discovery/search_aliases_v1.yaml`**, loaded and
validated once per process by `app.core.search_aliases`.

**Lookup, not fuzzy matching.** No edit distance, no phonetic key, no scoring, no "did
you mean". An input either normalizes to a key in the file or it does not; anything that
does not falls straight through to the ordinary substring search it always had.

**Key normalization.** Outer whitespace trimmed, repeated whitespace collapsed, Python
`str.lower()` — the same case rule the SQL uses, so the two layers cannot disagree — and
abbreviation punctuation (`.`, `·`, apostrophes) removed, so `P.S.G.`, ` psg ` and `PSG`
are one key. **Hyphens are deliberately kept**, because they carry meaning in real names
(`Saint-Étienne`). Only the lookup is normalized; stored names are never rewritten and
never transliterated.

**Targets are literal substrings matched against `Team.slug` OR `Team.canonical_name`**,
so a target may be written in either provider shape and still resolve. `%`, `_` and the
escape character in a target stay literal, exactly as in a typed needle.

**A matched club alias RESOLVES**: its targets replace the typed needle rather than being
unioned with it. `club=` is a statement of *which club*, and unioning would let a
two-letter abbreviation such as `om` drag in every club whose name merely contains those
letters. **`q=<alias>` ADDS instead**, because `q` is a broad "find anything" search and
narrowing it would be the more surprising behaviour; only a normalized **whole-input**
alias is considered, with no token parsing of compound prose — `q=psg winger` is searched
exactly as typed.

The shipped registry: 26 club aliases across the top five leagues, and one league
misspelling.

| aliases | resolve to |
| --- | --- |
| `spurs`, `thfc` | Tottenham |
| `man utd`, `man united`, `mufc` | Manchester United |
| `man city`, `mcfc` | Manchester City |
| `lfc` | Liverpool |
| `gunners` | Arsenal |
| `barca`, `barça` | Barcelona |
| `atleti` | Atlético Madrid |
| `rma` | Real Madrid |
| `bvb` | Borussia Dortmund |
| `b04` | Bayer Leverkusen |
| `rbl` | RB Leipzig |
| `juve` | Juventus |
| `inter milan`, `nerazzurri` | Internazionale |
| `rossoneri` | AC Milan |
| `psg`, `paris sg` | Paris Saint-Germain |
| `om` | Olympique de Marseille |
| `ol` | Olympique Lyonnais |
| `losc` | Lille |
| **`fcb`** | **Barcelona AND Bayern Munich** |
| `portgual` (league) | Portugal |

`fcb` is the deliberate ambiguous case: it is claimed by two major clubs, so it returns
both rather than silently choosing one. `united`, `city`, `real` and `blues` are
deliberately **absent** — each names several major clubs — and a test asserts they never
become aliases. `inter` alone is absent for the same reason, and `rossoneri` exists
precisely because a bare `milan` reaches AC Milan's name *and* Internazionale's slug.

**Malformed configuration fails loudly.** A missing `version`, a non-list group, a
missing or empty `alias`, an empty `targets` list, an alias not written in normalized
form, a duplicate normalized key or an unknown key each raises `AliasConfigError` at load
time — never an empty table that would leave the field quietly broken again.

**No migration, no alias table, no schema change.** This is bounded configuration.

### 4. Free-text trimming

`parseTextFilter` now trims outer whitespace and treats a whitespace-only value as unset.
Internal spacing is untouched and never collapsed, so `Paris Saint-Germain` and
`Paris  Saint-Germain` are both preserved exactly as typed.

The original no-trim decision was wrong about the mechanics — trimming only removes
leading and trailing runs — but it was guarding a real failure: a *controlled* input that
normalizes on every keystroke writes the normalized value straight back, so `Paris `
becomes `Paris` and the space between two words can never be typed. The fix is a **raw
text draft** (`useEditDraft`), not the absence of trimming:

- while a field is being edited it shows the user's own text;
- the URL, the request and the readable summary always carry the trimmed value;
- the draft records the canonical value it is synchronized with, so an outside change —
  Clear All, removing the criterion, back/forward, a hard load, the companion of a
  coherent min/max pair — drops it and the field converges on the URL;
- blur drops it too, so a trailing space is visibly gone rather than lingering as a state
  nothing else shares.

This is the same adjust-state-during-render pattern the age slider already used.

### 5. Sequential €M decimal typing

Both asking-price controls are now `type="text"` with `inputMode="decimal"` — the numeric
keypad without the browser's destructive value sanitization — over the same
`useEditDraft`. A raw keystroke is classified three ways rather than two, because "clear
this bound" and "do not send this" are different intentions:

| raw | outcome |
| --- | --- |
| blank / whitespace | clear the bound |
| a finite, non-negative number | commit `round(value × 1_000_000)` absolute EUR |
| negative, non-finite or unparseable | **hold the text, send nothing**, and mark `aria-invalid` |

Typing `12.5` one key at a time now leaves `12.5` visibly in the control and
`value_min=12500000` in the URL. The intermediate `12.` is a harmless `12` — JavaScript
reads it as such — and what preserves the visible point is the draft. Blur, reset,
removal, back/forward and a hard load all converge deterministically on the URL. The
regression test presses **one key at a time**; `fill("12.5")` cannot reproduce the
defect.

The coherent min/max rule is unchanged, and one consequence of combining it with a
per-keystroke commit is worth stating plainly: typing a large **maximum** passes through
small intermediate values, and "the edited bound wins and its companion follows" drags
the minimum down with each of them. Starting from `value_min=12.5` and typing `120.75`
into the maximum leaves the minimum at `1`. That is pinned by a test rather than worked
around, because the alternative — deferring the pull until the value looks finished —
would let `min > max` reach the API between keystrokes, and never emitting an invalid
request is the invariant the rule exists to protect. Both fields update visibly together
and the URL always matches what is on screen.

### 6. Windows UTF-8 determinism

Two genuine, platform-specific failures, both from text I/O that used the locale encoding:

- `CalibrationContract.load()` and `FixtureSuite.load()` opened committed UTF-8 YAML
  without `encoding=`. On a cp1252 locale the em dash, arrow, `≈` and `≤` in
  `configs/calibration/rolefit_calibration_v1.yaml` decoded to mojibake, and because
  `config_hash` is a hash of the **parsed** document it moved to `f13659a3a30461d7` —
  failing `test_matches_committed_baseline` against a baseline that is itself correct.
- The calibration CLI wrote its Markdown report with the locale encoding, so
  `make calibration-evaluate` died with a `UnicodeEncodeError` on the status emoji.

All three sites now specify `encoding="utf-8"`, stdout is reconfigured where the stream
allows it, and the tests read and write UTF-8 explicitly. Two regression assertions were
added: one decodes the committed YAML and asserts its non-ASCII characters survive
loading, and one pins the contract hash to the committed **`6f25ab01e7b575c4`** with a
message naming an encoding regression rather than "RoleFit config changed". The baseline
was **not** regenerated: it is correct under UTF-8, and supported Python 3.11 already
produces it.

The repair is deliberately narrow. No repository-wide text-I/O refactor was attempted.

### Query and performance invariants

Unchanged, and asserted:

- Discovery is still database-backed. Nothing materializes the cohort or post-filters in
  Python; alias targets compile into the same `WHERE` clause as one `OR`.
- **A normal request is still four statements** — current season, count, page, page
  playstyles. `test_an_alias_request_costs_the_same_statements_as_a_plain_one` measures a
  plain needle, a one-target alias, a three-target alias, a league alias and a `q` alias,
  and asserts all five issue exactly four.
- `test_alias_resolution_issues_no_database_statement` asserts the registry load and
  lookup emit **zero** SQL.
- The documented eight-statement ceiling and the 5,000-record volume gate are unchanged
  and still pass.
- Pagination, sorting, the applicable RoleFit context, count/row atomicity, missing-data
  behaviour and the deterministic tie-breaks are untouched. An alias pages coherently
  because it is one predicate, not a post-filter.
- SQLite and PostgreSQL agree: the new rules are asserted inside `discovery_parity`, which
  the PostgreSQL smoke also runs.

### What the differential matrix now proves

`reference_search` began as a transcription of the pre-8.1B in-Python implementation.
Three Context rules deliberately changed here, so those three are now **restated** in the
reference rather than transcribed. The matrix therefore still proves that the database and
an independent Python implementation agree on every case; it no longer claims those three
rules are unchanged from pre-8.1B, because they intentionally are not. Everything else in
the reference is still the original transcription.

### Tests

**Backend — 429 passed, 7 skipped, coverage 91.70%** (gate 90%).

| suite | what it adds |
| --- | --- |
| `test_search_aliases.py` (new) | key normalization including punctuation, hyphen preservation and `str.lower()` parity; lookup and miss; the shipped registry's version, size, normalized keys, target sanity and absence of generic aliases; 16 malformed-document shapes each raising `AliasConfigError`; a missing file, invalid YAML, and a UTF-8 round trip |
| `test_discovery_context_search.py` (new) | an isolated synthetic cohort with 20 real top-five-league clubs and six countries: full/partial/mixed-case nationality; league by country, code, name and slug for all six countries; the `portgual` alias and five typos that are *not* aliases; **every shipped alias** resolving; the ambiguous `fcb`; slug-target matching; non-alias fallback; generic abbreviations staying non-aliases; AND composition; count/row agreement and coherent paging; whole-input `q` aliases; and the two query-count assertions |
| `discovery_parity.py` | a new `_assert_context_search_semantics` block, run on **both** dialects, plus substring and LIKE-metacharacter cases for nationality |
| `discovery_cohort.py` | competition countries (including one NULL), two alias-named clubs, one Portugal-league player, one player with no nationality, and 22 new matrix cases |
| `test_calibration.py` | the UTF-8 decode assertion and the pinned contract hash |

**Frontend — 607 passed across 21 files** (was 586).

| suite | what it adds |
| --- | --- |
| `discovery-criteria.test.ts` | trimming: blank/whitespace-only unset, outer whitespace removed, internal spacing preserved and never collapsed |
| `discovery-advanced-filters.test.tsx` | sequential decimal typing, the trailing point, leading zero, long decimals, paste, backspace-to-blank, a malformed draft never reaching the URL, blur snap-back, draft dropped on removal / Clear All / a replayed URL, the coherent rule mid-typing; multi-word club typing, raw-vs-trimmed display, blur settling, whitespace-only clearing, all four predicates trimmed, a trimmed hard-loaded URL; alias values staying readable in the criteria list; and the corrected Context helper copy |

**Browser — Playwright, against the production build and the committed fixture cohort.**
`discovery-advanced.spec.ts` gains a `Context search` group — partial nationality, league
by country for all six countries, the `portgual` alias, `psg` through both Club and
Search, multi-word typing, whitespace, AND composition with zero-result recovery, helper
copy — and five asking-price cases driven by **`pressSequentially`**, keyboard editing,
paste, clearing, malformed-draft withholding, reload and back/forward.

### Limitations

- **The alias registry is curated, not complete.** Twenty-six club aliases across the top
  five leagues. Anything outside it is an ordinary substring search, by design; nothing
  guesses.
- **`fcb` is the only ambiguous alias shipped.** Others exist in the wild; each would need
  the same deliberate "return all defensible targets" decision.
- **A matched alias resolves rather than widening**, so an unusually spelled provider name
  that none of an alias's targets reach will not be found by that alias even if the typed
  text happens to be a substring of it. The trade is deliberate: it is what keeps `om`
  from returning every club containing those two letters.
- **The committed sample cannot exercise most of the registry.** It is a 24-player
  synthetic fixture with PSG but no Tottenham, Barcelona or Juventus, so the browser tests
  use PSG and the exhaustive alias coverage is backend-side against a synthetic database.
  No production player was fabricated.
- **Nationality has no enumeration**; it remains free text over stored values.
- **`portgual` is one reported misspelling**, not a spelling corrector.

---

## Phase 8.3 — Deterministic ranking explanation

**Status: implemented and supervisory-audited — 2026-08-17.**

Discovery already retrieved, filtered, ordered, counted and paged deterministically.
What it could not do was say *which ordering it had applied*. Phase 8.3 answers that
with the real backend ordering rules — and with nothing else.

It is an explainability phase. **No scoring model changed, no calibration changed, no
ranking changed, and no new composite score exists.** The ordering contract below is
the Phase 8.1B contract, unaltered; what is new is that it now has one authoritative
machine-readable form that the SQL and the explanation are both built from.

It is deliberately **page-level**. It describes the ordering, not the results: it names
no player, quotes no player's values and compares no two rows. A scout reads which
player sits above which off the sorted ledger itself; what the ledger could not tell
them, and now does, is what the sort actually did and in what order.

The six questions the surface answers, and where each is answered:

| Question | Answered by |
| --- | --- |
| What ranking mode is active? | `ranking.summary`, `ranking.sort`, `ranking.direction` |
| What exact ordered key sequence does it use? | `ranking.keys`, first key first |
| Which role context supplies each result's RoleFit, and did it order the page? | `ranking.role_context` |
| How are unknown values placed? | `ranking.missing_values`, plus each key's own rule |
| What tie-breakers apply? | `ranking.tie_breakers`, derived from `keys` |
| What can and cannot be inferred? | `ranking.limitation` |

### One sort specification, two consumers

The whole phase rests on one structural decision: **there is no second description of
the ordering.**

Before 8.3 the ordering existed only as a dict of SQLAlchemy `ORDER BY` fragments
inside `_Candidates.order_by`. The obvious way to explain it — a parallel map of
labels and sentences — would have been free to drift from the SQL the moment either
was edited, and a stale ranking explanation is worse than none: it is a confident
statement about something the database did not do.

So the sequence is declared **once**, in
`apps/api/app/repositories/discovery_sort.py`, as an ordered tuple of `SortKey`
objects per mode. Each key carries, inseparably:

| Member | What it is |
| --- | --- |
| `order(ctx)` | the `ORDER BY` element the database sorts by |
| `key` / `label` / `direction` / `direction_label` / `role` / `unit` / `rule` | its identity and its one deterministic sentence |

`_Candidates.order_by` builds SQL by walking a mode's tuple;
`services/discovery_explanation.py` walks the identical tuple. Adding, removing or
reordering a key therefore moves both at once. The reported tie-breakers are derived
from `keys` through `SortSpec.tie_breakers` rather than listed beside it, and
"does this mode order by RoleFit at all?" is derived through `SortSpec.orders_by_rolefit`
rather than declared, for the same reason.

**This is held structurally, not by convention.** In
`apps/api/app/tests/test_discovery_ranking.py`:

1. `test_the_sql_order_by_is_exactly_the_declared_key_sequence` compiles the real
   `ORDER BY` of a Discovery page statement and consumes it one declared key at a
   time: each key's own compiled expression must be the next clause, and when the last
   key is consumed nothing may remain. A key dropped, reordered, duplicated,
   described-but-never-applied or applied-but-never-described fails here.
2. `test_changing_the_specification_moves_the_sql_and_the_explanation_together`
   removes the final tie-break from one mode's specification and asserts that **both**
   the compiled SQL and the reported key sequence lose an entry. A hand-written
   description map would fail this immediately.
3. `test_the_served_order_is_the_documented_one` differences every mode's whole served
   page, under three role contexts, against an **independent oracle** — a transcription
   of the written contract over the serialized card fields that never calls
   `discovery_sort`. That is what makes the reported sequence meaningful rather than
   merely self-consistent.

The frontend renders backend-owned structured data and encodes no ordering rule of its
own; a source scan holds it to that (see *Frontend* below).

### The ordering contract, unchanged and now named

Each row is one declared key. "Placement" keys put known values before unknown ones;
"measure" keys order by a stored value; "tie-breaker" keys only ever resolve rows the
rest left equal.

| Mode | Key sequence (machine keys, in order) |
| --- | --- |
| `rolefit_desc` | `rated_first` → `result_role_score` (desc) → `result_role_confidence` (desc) → `canonical_name` → `player_id` |
| `rolefit_asc` | `rated_first` → `result_role_score` (asc) → `result_role_confidence` (desc) → `canonical_name` → `player_id` |
| `age_asc` | `age` (asc, unknown last) → `canonical_name` → `player_id` |
| `age_desc` | `age` (desc, unknown last) → `canonical_name` → `player_id` |
| `value_desc` | `asking_low_known_first` → `expected_asking_low_eur` (desc) → `canonical_name` → `player_id` |
| `value_asc` | `asking_low_known_first` → `expected_asking_low_eur` (asc) → `canonical_name` → `player_id` |
| `name_asc` | `canonical_name` → `player_id` |

Notes that matter, all pinned by test:

- **Expected Asking uses the LOW endpoint.** Never the high endpoint, never a midpoint.
  The key's own `rule` sentence rules both out in so many words, and a test asserts no
  key whose machine name contains "high" exists in any mode.
- **Confidence is an ordering key only in the RoleFit modes**, only *after* the score,
  and descending in **both** directions. A test asserts it is absent everywhere else
  and never precedes the score.
- **Every mode ends with canonical name then player id.** In `name_asc` the name is the
  ordering rather than a tie-break, so only the id is reported as a tie-breaker — which
  is what the SQL does.
- **Age folds its unknown placement into one key**, because that is exactly what the
  SQL does: `COALESCE(age, 999) ASC` and `-COALESCE(age, -1) ASC` are single
  expressions carrying both the direction and the "unknown last" rule. RoleFit and
  asking price have a *separate* placement expression in SQL, so they have a separate
  key. The explanation is asymmetric here because the SQL is; `missing_values` states
  the semantics uniformly for every mode.
- `age_desc` is API-only, as before: the Sort control does not offer it, and a URL
  carrying it is not forwarded.

### Role context

`ranking.role_context` reports **two separate facts**, because conflating them is
exactly the mistake this text exists to avoid.

**Which stored rating every result displays**, never conflating the two contexts:

- **`selected_role`** — `role=<key>` is active. Every result's `result_role*` group is
  that role, and the explanation names it. `best_role*` is never read.
- **`best_role`** — no role selected. `result_role*` is each player's own stored best
  role, which may differ from row to row, and the detail sentence says so rather than
  naming a single role the page does not have.

**And whether that rating ordered anything.** Only `rolefit_desc` and `rolefit_asc`
order by it; `age_asc`, `age_desc`, `value_desc`, `value_asc` and `name_asc` order by
something else entirely. So the detail sentence branches:

| Mode | What the detail says |
| --- | --- |
| RoleFit modes | "…That rating's stored score and confidence are two of the ordering keys below, and are what this page is ordered by." |
| Age / Expected Asking / Name | "…That rating is what each result DISPLAYS. It did not order this page: the ordering comes from the *Age* sort (*youngest first*), as the keys below state." |

The branch is taken on `SortSpec.orders_by_rolefit`, which is derived from the key
sequence itself, so the copy cannot claim RoleFit ordered a page RoleFit had no part
in. Tests assert the RoleFit modes make the claim and the other five never do, and that
a selected role's detail never mentions a best role.

A regression test drives the Phase 8.1A defect directly: the cohort's
`Cohort Conflicted Winger` is 42.0 in the selected role and 88.0 in another, and under
`role=<selected>` the page must be ordered by 42.0 — which the independent order oracle,
reading `result_role_score`, is what proves.

### The copy contract

**Every sentence is a fixed template over the specification. Nothing is generated**, and
no external service is involved. Examples of the shipped copy:

- "Ordered by RoleFit, highest first."
- "Only on an equal score: High Confidence, then Medium, then Low, then Unknown.
  Descending in both RoleFit directions."
- "The stored expected-asking LOW endpoint, highest first. Never the high endpoint and
  never a midpoint of the two."
- "A player with no known birth date has an unknown age and is placed after every known
  age, in both directions."
- "The stable player ID, ascending, decides anything still equal."
- "This explains ordering, not recruitment suitability. …"

A copy test sweeps every sentence of every mode for "recommend", "suitab", "priority",
"best signing", "should sign", "target", "verdict" and "boost". The single permitted
occurrence of "suitability" is the limitation sentence, which exists to deny it. A
compound-filter request is included in the sweep, so no filter can appear as a reason
for rank. Every sentence is bounded and terminated, and a test asserts the serialized
`ranking` block contains no cohort player's name.

### Page independence

Because the explanation describes the ordering rather than the rows, it is **identical
on every page of the same query** — a test asserts pages 1, 2 and 3 serialize to the
same object — and it is well-formed and complete for a page of one result, for a zero-
result page, and for a database with no season at all. There is no page-boundary caveat
to state, because nothing here is row-specific.

### Query cost

**Unchanged: four statements** — current season, count, page, page playstyles — and two
for an empty result. The explanation issues no query of its own and reads no rows: it
is built from the active sort and the role context alone. `test_the_explanation_needs_no_session_at_all`
calls the builder with no database in reach and asserts the result is byte-identical to
the served one.

The page query selects exactly what a search card needs; no column exists in it to be
explained. (An earlier revision added two ordering-evidence columns for a per-row
feature that has since been removed, and they were removed with it.) The
four-statement shape and the documented eight-statement ceiling are unchanged, and the
5,000-record volume gate still passes.

**Rating audit groups were deliberately NOT surfaced.** They were permitted as optional
page-level context; adding them would have cost a fifth statement and a second
"why this score" surface inside Discovery, where the dossier already owns that
question. The trade is recorded here rather than taken silently.

### Frontend: "Why this order"

One compact, collapsed-by-default disclosure **inside the results ledger**, between the
count header and the first result row.

- **Not in the filter rail.** The rail owns cohort narrowing; a filter never explains
  rank. A test asserts the disclosure is absent from `filter-column` entirely and that
  the phrase does not appear there.
- **Not per row.** One disclosure for the page: no explanation panel per result, no
  repeated "Why?" button.
- Collapsed, it is one 44px row: the label plus the active-sort line ("Ordered by
  RoleFit, highest first."). It does not become a second header — the cohort counts
  stay in the ledger header above it.
- Expanded, it is one flat square region divided by internal hairlines into three
  sections, in this order: the active sort (summary, role context, unknown-value
  placement), the ordered rule sequence as repeated rectangular rows followed by the
  tie-breaker sentence, and the limitation. Nothing sits between the rules and the
  limitation, and the limitation is last — asserted in Vitest and in Playwright. Long
  role labels and long rule sentences wrap; nothing truncates into unreadability and
  nothing scrolls.
- It **does not grow with the page**. A Vitest case renders a 1-result page and a
  12-result page and asserts the region's markup is identical.

**Geometry and motion.** Every rectangle is 90 degrees — a computed-radius scan of the
whole open region asserts it. No pill, chip, bubble, gradient, glass effect or
decorative shadow. Open state is an inset marker plus a `+`/`−` glyph, paint only, so
opening cannot move the ledger, the rail or their shared top edge. The row joins the
existing `background-color, box-shadow` transition rule rather than adding a cadence;
**no layout property is animated**, and under `prefers-reduced-motion: reduce` the final
state is reached in the same frame with zero running animations. The single sanctioned
rectangular radius (`.rail-box-discovery`) is untouched and no second exception was
created.

**Accessibility.** A real `<button>` with `aria-expanded` and `aria-controls`; Enter and
Space are the platform's (no key handler shadows them, asserted by source scan); the
accessible name leads with the visible label and states the purpose ("Why this order.
Ordered by RoleFit, highest first."). The region stays in the DOM in both states and is
toggled with `hidden`, so `aria-controls` always resolves and no content is focusable
while shut. The region introduces **no focusable element at all**, so nothing can trap
focus and nothing can be stranded when it closes — focus stays on the control. The
focus ring is the product's shared 2px `--pitch` outline; the row is 44px tall at every
width.

**No frontend comparator.** `WhyThisOrder.tsx` renders `ranking` as supplied. A source
scan asserts it contains no ordering-key name, direction label or rule text as a
literal; no `.sort(`, `.reverse(`, `localeCompare` or `Math.min`/`Math.max`; no
relational operator applied to any response value; and that the only comparison in the
file at all is `tieBreakers.length > 0`. A rendering test feeds it a deliberately
reversed key sequence and asserts it renders unchanged.

### API contract

`GET /api/players` now returns **`DiscoverySearchResponse`** instead of the generic
`Paginated[PlayerSearchCard]`. The five pagination fields (`items`, `total`, `page`,
`page_size`, `total_pages`) are unchanged in name, type and meaning; `ranking` is
additive. A dedicated schema rather than a `ranking` field on the generic model, because
ranking is a Discovery concern and every other paginated response would otherwise have
carried a field it can never fill.

New schemas: `RankingExplanation`, `RankingKey`, `RankingRoleContext`.
`docs/api_contracts/openapi.json` and `apps/web/src/lib/api/schema.gen.ts` were
regenerated; `Paginated_PlayerSearchCard_` no longer appears in the generated types
because nothing references it any more.

`RankingExplanation` in full:

```
sort, sort_label, direction, direction_label, summary
keys[]          RankingKey: position, key, label, direction, direction_label,
                            role, unit, rule
role_context    RankingRoleContext: source, role_key, role_display, label, detail
missing_values
tie_breakers[]  RankingKey, derived from keys
limitation
```

### Evidence

All figures below are from commands actually executed on this machine.

**Backend — 674 passed, 7 skipped; coverage 91.86% (gate 90%).** `discovery_sort.py`
and `discovery_explanation.py` are both at 100%; `discovery_repo.py` is at 99%.

`test_discovery_ranking.py` (150 tests) covers: every mode's exact key sequence and
directions, written out longhand from the contract rather than read back from
`SORT_SPECS`; the SQL/specification identity tests above; the whole served order of
every mode under three role contexts against the independent oracle; rated/unrated,
known/unknown age and known/unknown asking placement; confidence tie-breaking in both
RoleFit directions; Unicode-aware lowercased name ordering and the id fall-through for
names that lowercase to one key; selected-role and best-role correctness; the
sort-aware role-context copy, including that the five non-RoleFit modes never claim
RoleFit ordered the page; profile-only honesty; paging, one-result, zero-result and
seasonless behaviour; page-to-page identity of the explanation; byte-identical repeated
responses; the four-statement count; the no-per-player-id N+1 gate; and the copy
contract.

**SQLite / PostgreSQL parity.** `_assert_ranking_explanation_matches_the_page` in
`discovery_parity.py`, which both the SQLite suite and the PostgreSQL smoke run,
asserts the reported key sequence per mode (written out again, independently), the
served order of every mode against a second independent transcription, the sort-aware
role-context copy, and the tie-break tails — including the `Cohort Kelvin Twin` pair,
two different stored spellings that lowercase to one key, which is the assertion most
exposed to a dialect difference. **PostgreSQL 16: 5 passed**, against a migrated,
ingested and recomputed database.

**Frontend — 653 passed across 22 files.**
`discovery-ranking-explanation.test.tsx` (45) covers the collapsed default, expanded
content, exact key-sequence rendering including a reversed sequence, ledger-not-rail
placement, the limitation rendering immediately after the rules and last, the
page-level absences (no adjacent section, no player named, no first-visible note),
identical markup for a 1-result and a 12-result page, the selected-role and best-role
contexts, the five non-RoleFit modes' "did not order this page" copy, every
representable sort, a real control → URL → request → explanation round trip,
one-result / zero-result / loading / error / ranking-absent states, the accessibility
contract, long-label containment, the absence of a nested scroller, square geometry and
the no-comparator source scan. `sharp-corners.test.tsx` carries a rendered-DOM audit of
the region open and closed.

**Browser — 365 passed** in the Playwright suite against a production build, of which
`discovery-ranking.spec.ts` is 45: the default and selected-role explanations, the
"did not order this page" copy under Age / Expected Asking / Name, all six representable
sorts, per-mode unknown-value wording, the lower-endpoint wording, the confidence
tie-break position, page 2 asserting an identical explanation and no row named,
Next/Prev, hard load / reload / back-forward, compound filters proving no filter becomes
a reason for rank, keyboard disclosure with Enter and Space, focus retention, target
size, axe at 1280/640/320 with the region **open** (zero violations), the WCAG
text-spacing override, forced colours, seven viewports (320/390/640/768/1024/1280/1440)
asserting zero document overflow and an unchanged ledger and rail width, the Milestone
8.2 390px min-content regression, no nested scroller, a computed-radius sweep, no
animated layout property, and reduced motion.

One unrelated test (`motion.spec.ts`, reduced-motion scroll behaviour) failed once on
the parallel run with a Windows `ERR_NO_BUFFER_SPACE` socket error and passed on re-run;
that is a local socket-exhaustion artifact, not a product failure.

**Cross-browser — 36 passed (12 × Chromium/WebKit/Firefox)**: the smoke suite opens the
disclosure by pointer and by keyboard on every engine, asserts the backend key sequence
and the tie-breaker sentence render, asserts no player-versus-player text appears, and
asserts the ledger keeps its width.

**Containers — full-stack Docker smoke passed**: build, PostgreSQL, migration,
bootstrap, API liveness and readiness, web root, and a clean teardown of every
container, volume and network.

### Limitations and deliberate omissions

- **No per-player ordering explanation is offered, by decision.** The surface does not
  say why one particular result sits above another; that is legible from the sorted
  column of the ledger itself, and the earlier per-pair implementation made the open
  region as tall as the page for it. What was genuinely missing — which sort is active,
  what it orders by, in what order, and what happens to unknown values — is what
  remains. The whole vertical slice behind the removed feature (its API fields, its
  service code, its extra page-query columns and its tests) was removed with it rather
  than left as dead architecture.
- **The committed 24-player sample fixture is fully rated, priced and dated**, so it
  produces no confidence tie, no unrated player, no unknown value and no colliding
  name. Since the explanation is page-level, none of those states changes a word of it,
  and the ORDERING they affect is proven exhaustively against a synthetic cohort built
  to contain a tie at every level. No production player was fabricated in the fixture
  database, and no browser test intercepts the API.
- **Rating audit groups are not surfaced**, by decision (see *Query cost*). The dossier
  remains the deeper "why this score" surface; Phase 8.3 does not duplicate it inside
  Discovery.
- **The name ordering is the database's own lowered key**, which on PostgreSQL is ICU's.
  The Phase 8.1B residual is inherited rather than added to: 40 of 1,433 cased code
  points (35 Vithkuqi, four recent Latin additions, one Glagolitic) are left unchanged
  by ICU where CPython lowercases them, none of them in name-bearing ranges, and
  `test_postgres_smoke.py` still fails if that stops being true.
- **Open state is local presentation state**, deliberately not in the URL. Whether it
  survives a page change therefore depends on whether the new page resolves from React
  Query's cache; a reload always starts collapsed. Neither is load-bearing.
- **The leaderboard, the dossier and Analysis Scope are untouched.** No confidence,
  evidence-state or concern filter was added.
- The Leverkusen-centered pilot limitation is unchanged. Nothing here widens coverage or
  makes any claim about data quality.
- **Visual-regression baselines were not compared and not regenerated**, for the
  unchanged Phase 8.1B/8.2 reason: the committed images were captured with Chromium
  1208 / WebKit 2248 and the pinned Playwright requires 1228 / 2311, so a pixel
  difference on this machine would measure rasterization rather than the product. The
  Discovery baselines will legitimately change — the ledger has a new row — and
  regenerating them belongs with a release review on the reference platform.
  `tests/visual/` is untouched by this phase.
