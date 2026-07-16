# Milestone 3 — Real U23 Pilot

> Status: **complete for the approved Transfermarkt + StatsBomb vertical-slice pilot**.
> `make verify-milestone-3` passes. This is not completion of the future 100-player,
> five-league scale gate; it is the tested pilot that makes that expansion possible.

## 0. Repo audit (current state, verified)

| Area | Current behavior | M3 gap |
| --- | --- | --- |
| Transfermarkt adapter | `_fetch_csv` expects a **pre-aggregated** `appearances.csv` (player_id, club_id, competition_id, season, minutes, …) | Real dcaribou `appearances.csv` is **per-match** with no season; must join appearances→games→competitions and aggregate. |
| DuckDB path | Minimal (players + valuations only) | Must be **feature-equivalent** to CSV over the 12-table schema. |
| Provenance | Only `player_metrics_raw.source_snapshot_id` (string) + `rating_runs.source_snapshot_ids_json` | No first-class **SourceSnapshot** model (provider, version, as-of, checksum, license, path, row counts). |
| Age | `_age()` returns **21.0** when DOB unknown | Must be **null/excluded**, never defaulted. |
| Role eligibility | recompute gates on `role.position_group == player_pg` only | Must enforce `eligible_positions`; resolve CAM/Shadow-Striker cross-group cleanly. |
| Peer groups | ATT/MID only | Role-eligible peer populations / documented buckets + min-peer-size + fallback. |
| Identity | exact source id → name+DOB | Add manual overrides + **quarantine** for ambiguous fuzzy matches (never auto-merge). |
| Valuations | current `market_value_in_eur` or first valuation row | Select **as-of the reference date**; use valuation history. |
| Context | static config multipliers; team strength not season-specific | Context **v1.1** from documented inputs; avoid double-counting; conservative bands. |
| Reports | data-quality report only | Add cohort / coverage / unresolved-identity / metric-coverage / league-distribution / role-eligibility / rating-distribution reports. |
| Tests | 93 py + 11 web, all green; synthetic E2E | Add real-schema parity, aggregation, identity, eligibility, peer, context, market tests + real-shaped integration + skippable real-cohort smoke. |

## 1. Target season

- **Default `TARGET_SEASON = 2023-2024`** (`games.season = 2023` in dcaribou), configurable via
  `--target-season` / `TARGET_SEASON`. Rationale: newest *completed* season with full dcaribou
  coverage at planning time; the final value is pinned to the newest season **shared by the
  identity snapshot and the performance snapshot actually obtained** (§8).
- **Age reference date:** age ≤ 23 measured on **2024-06-30** (season end). DOB comes from
  `players.date_of_birth`; age is whole years on that date. Unknown DOB ⇒ excluded from the
  U23 cohort (never defaulted).
- Identity/value data is pinned to the same season: valuations selected **as of** the reference
  date; never mix one season's performance with unlabeled current values.

## 2. Source permissions / terms (must confirm before download)

| Source | Use | Terms status |
| --- | --- | --- |
| dcaribou/transfermarkt-datasets | identity, clubs, competitions, games, per-match appearances, valuations, transfers, contracts | Code MIT; **data derived from Transfermarkt** and intended for personal/non-commercial use. Raw files **gitignored** (never redistributed). Needs explicit approval to download. |
| Performance metrics (xG, carries, pressures, …) | RoleFit inputs via the CSV contract | **Not present and not freely available at the 8-league scope.** Requires an *authorized* local player-season CSV, or a clearly-labelled StatsBomb Open Data pilot (partial). |
| StatsBomb Open Data | optional real event-data pilot | Free under StatsBomb's non-commercial user agreement + attribution; **selected coverage only** — must not be presented as full European coverage. |
| Football-Data.co.uk | match results → team-strength/stakes context only | Free for personal use; **not** a player-performance source. |

No live scraping, private APIs, fabricated metrics, or undocumented datasets.

## 3. Cohort gates (Definition of Done)

- Positions ST, CF, LW, RW, CAM/AM, CM, DM; age ≤ 23 on the reference date; ≥ **450** club minutes.
- Target leagues: Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Eredivisie, Primeira
  Liga, Belgian Pro League.
- **Completion gate: ≥ 100 eligible players across ≥ 5 leagues** (preferred: all 8).
- A RoleFit score is > low-confidence only when ≥ **70%** of one eligible role's required metrics
  are present.
- If the approved performance snapshot cannot meet these gates → **coverage + blocker report**,
  not a completion claim, and no fabricated data.

## 4. Real dcaribou schema → canonical mapping (key tables)

- `competitions.csv`: `competition_id` (e.g. `GB1`,`ES1`,`L1`,`IT1`,`FR1`,`NL1`,`PO1`,`BE1`),
  `name`, `type`, `country_name`, `confederation`, `domestic_league_code` → map `competition_id`
  → canonical slug (`eng_premier_league`, …) via a new `configs/context` competition map.
- `games.csv`: `game_id`, `competition_id`, **`season`** (start year int), `date`,
  home/away club ids/goals → provides the season for each appearance + team-strength inputs.
- `clubs.csv`: `club_id`, `name`, `domestic_competition_id`, `total_market_value`, `squad_size`,
  `average_age` → team season context inputs.
- `players.csv`: `player_id`, `name`, `date_of_birth`, `country_of_citizenship`, `sub_position`,
  `position`, `foot`, `height_in_cm`, `contract_expiration_date`, `current_club_id`,
  `market_value_in_eur` → identity + contract.
- `appearances.csv`: `appearance_id`, `game_id`, `player_id`, `player_club_id`, `competition_id`,
  `minutes_played`, `goals`, `assists`, `yellow_cards`, `red_cards` → **aggregate** by
  player/club/competition/season (join `game_id`→`games.season`): Σ minutes, appearances count,
  starts (from `game_lineups` if used), goals/assists totals → per-90.
- `player_valuations.csv`: `player_id`, `date`, `market_value_in_eur`, `current_club_id` →
  as-of-reference-date valuation + history.
- `transfers.csv`: `player_id`, `transfer_date`, `transfer_season`, fees, `market_value_in_eur`.
- **Not available in dcaribou:** per-player international caps (only a club-level
  `national_team_players` count) and scouting metrics (xG/carries/pressures/etc.). Caps ⇒ null;
  scouting metrics ⇒ must come from the performance snapshot (§2).

## 5. Provenance + schema migration plan (migration 0003, additive/guarded)

- New `source_snapshots` table: id, provider, dataset_version, as_of_date, target_season,
  local_path, checksum (sha256), license_url, row_counts_json, ingested_run_id, created_at.
- Link `player_metrics_raw` / valuations / appearances rows to a `source_snapshot_id` FK
  (keep the existing string column working; add nullable FK).
- Performance contract **v1.1** (compatible superset of v1): add `metric_provider` (distinct
  from identity `source_name`), `scope` (e.g. `domestic_league` vs `all_competitions`),
  `snapshot_id`, keeping v1 columns valid so v1 CSVs still import.
- `player_universe_memberships` already exists (M2) — reused for the real cohort.
- Migration is inspector-guarded like 0002 (safe on fresh create_all + existing DBs; SQLite+PG).

## 6. Eligibility / peer groups / context / market plan

- **Role eligibility:** recompute filters roles by `eligible_positions` (position in the role's
  list), not just position_group. CAM/AM eligible for Shadow Striker etc. per role YAML.
- **Peer groups:** per-role eligible population for percentiles; if a role's eligible pool is
  below `MIN_PEER_SIZE` (documented, e.g. 8), fall back deterministically to position-group,
  then to all-cohort, recording which bucket was used + lowering confidence.
- **Context v1.1:** team strength season-specific from documented inputs (club season points/GD
  via Football-Data.co.uk or dcaribou `club_games`); keep league/opposition/stakes conservative
  and avoid double-counting (opposition proxy folded into league unless real opponent data used).
- **Market v1:** use valuation history + contract years remaining + (null) caps; missing
  contract/leverage widens asking range and lowers confidence (already partially implemented).

## 7. Implementation order (once §8 resolved)

1. This doc (done). 2. Migration 0003 + provenance models. 3. Real CSV/DuckDB ingest + match→
season aggregation + checksums/provenance. 4. Contract v1.1 + source precedence + deterministic
metric aggregation + identity quarantine + age fix. 5. Materialize real cohort + all reports.
6. Role eligibility + peer groups + context v1.1 + versioned recompute. 7. Real vertical slice
through API/UI + docs + tests + `make verify-milestone-3`.

## 8. Historical data-availability decision

Two hard dependencies are **not satisfiable autonomously** and are the user's call:

1. **Transfermarkt snapshot** — originally not present locally. Downloading the
   dcaribou dataset is a large external fetch with data-terms implications → needs explicit
   approval + choice of version/season, or the user places a snapshot at `data/raw/transfermarkt`.
2. **Real performance metrics** — the RoleFit engine's inputs (xG, progressive carries,
   take-ons, pressures, …) are **not in Transfermarkt** and are **not freely available for the
   full 8-league U23 cohort**. Without an authorized performance CSV, the ≥100-player /
   70%-metric-coverage gate **cannot be met**, and per the mission we must produce a blocker
   report rather than fabricate or claim completion.

**Resolution:** both snapshots were acquired, pinned, ingested, and verified. Raw data stays
gitignored; committed manifests make the local inputs auditable.

---

## 9. Execution findings (pilot scope confirmed)

**Approved pilot scope (per data-source decision):** *"Pilot dataset: U23 Bundesliga attackers
and midfielders, 2023/24."* Intersection of StatsBomb Open Data (real event metrics) × Transfermarkt
(identity, DOB→age, valuations, contracts). Age on **2024-06-30**; valuation as-of that date.
Architecture must remain able to add competitions later. Not to be presented as multi-league.

**StatsBomb — DONE (downloaded + pinned):**
- Confirmed `competition_id=9 "1. Bundesliga", season_id=281 "2023/2024", male`.
- Open Data ships a **34-match subset** (not the full 306) → coverage skews to the heavily-covered
  side + opponents; minutes are lopsided. This is why it is a *pilot* and coverage must be reported.
- Snapshot at `data/raw/statsbomb/` (gitignored, 115 MB, 34 events + 34 lineups), pinned by
  `data/manifests/statsbomb_bundesliga_2023_24.json` (committed: provider, repo commit, license,
  per-file sha256, counts). No runtime fetching.
- StatsBomb lineups/events provide player names, positions, per-position minutes, and all event
  metrics — but **no birth date / market value** (⇒ Transfermarkt needed for the U23 age gate + market).

**Transfermarkt — DONE (acquisition history):**
- dcaribou's clean CSVs are **not** retrievable over plain HTTP or `dvc get` (repo uses DVC; the
  prepared outputs aren't individually addressable; `data/prep` exposes only metadata).
- Its **official documented distribution** is the Kaggle dataset `davidcariboo/player-scores`
  (confirmed via dcaribou `dataset-metadata.json`). Kaggle download needs API credentials
  (`~/.kaggle/kaggle.json`) which are not present.
- The official Kaggle distribution was acquired and placed at `data/raw/transfermarkt/`.
- The adapter now processes its real per-match schema; unresolved identities remain quarantined.

## 10. Completion result

`make seed-pilot && make verify-milestone-3` verifies:

- 494 Transfermarkt Bundesliga identities and 507 player-club season aggregates.
- 323 conservatively matched StatsBomb identities; unresolved/ambiguous rows are reported.
- 18 matched players with at least 450 covered event-data minutes.
- Three eligible U23 attackers/midfielders: Florian Wirtz, Victor Boniface, and Adam Hlozek.
- Source-backed DOB, season minutes, as-of public values, event metrics, RoleFit ratings,
  playstyles, market ranges, audits, role leaderboards, compare output, and source provenance.
- First-class snapshot records and observation links from migration `0003_real_pilot`.
- Role-specific eligible peer populations, covered-minute confidence, explicit role eligibility,
  season-derived team tiers, unknown-age exclusion, and deterministic reports.

The generated report is `data/reports/milestone3_cohort_report.json`. Expansion to a balanced
Bundesliga or five-league cohort requires a performance source with materially broader match
coverage; no code-path redesign is required.

## Appendix: Pre-build feasibility estimate

Both real snapshots are downloaded and provenance-pinned (raw gitignored; manifests committed):
- `data/manifests/statsbomb_bundesliga_2023_24.json` (StatsBomb, 34 matches).
- `data/manifests/transfermarkt_player_scores.json` (Transfermarkt dcaribou, **CC0-1.0**, 12 tables).

Feasibility (verified):
- TM Bundesliga 2023 (`competition_id=L1`, `season=2023`): 306 games.
- StatsBomb event-derived player rows: 373; 323 conservatively linked after reviewed aliases.
- **U23 attacker/midfielder intersection (lower bound, pre-minute-gate): ~72 real players**
  (e.g. Xavi Simons, Hugo Ekitiké, Brajan Gruda, Hugo Larsson, Jan Thielmann, Eric Martel).
- The ≥450 StatsBomb-covered-minutes gate will trim this materially (Open Data ships only 34
  matches, so minutes concentrate on well-covered teams). Final rated cohort size + full coverage
  will be reported by the cohort/coverage reports — labelled a **pilot**, not full-league.

The estimate correctly predicted severe trimming, but exact-name feasibility was not used as the
completion claim. The executable report is authoritative and currently verifies three eligible
players after identity, position, age, full-season-minute, and covered-minute gates.
