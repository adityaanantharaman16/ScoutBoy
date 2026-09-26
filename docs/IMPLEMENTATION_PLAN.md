# Historical Wyscout 2017/18 migration plan

Status: **PLANNED, NOT EXECUTED — provisional pending the gates below.**
Planning card: `t_77b90bc8`. Baseline: `bafa77d42ec3025a8c917484ab5fafa972b70d0d`.
Research/repository inspection: 2026-09-26. This document is the combined design,
roadmap, and implementation handoff; no parallel architecture document is needed.
Approval of this plan is not authorization to acquire data, implement, or deploy.

## 1. Product decision and boundaries

The owner selected a historical, non-live portfolio product: discover and compare
footballers using the public Wyscout **2017/18 Big Five domestic-league snapshot**.
Visitors and portfolio reviewers should see the season, evidence, and limitations
before interpreting a score. Broad discovery remains available; U23 analysis is a
segment, not the entire directory. The objective is broader, balanced historical
coverage, not current recruitment advice or a universal player overall.

Confirmed requirements:

- Preserve the layered architecture, backend-authoritative scores, versioned YAML
  policy, reproducibility, explanations, deterministic ordering, and missing/null
  semantics. No scraping, commercial API access, fabricated metrics, or credentials
  for Wyscout. The public release is not the commercial Wyscout service.
- Retain the existing **34-match Bayer Leverkusen-centered Bundesliga 2023/24
  StatsBomb pilot** as history, with its own provenance and attribution. Do not
  call it full Bundesliga or European coverage. Synthetic fixtures remain separate.
- Keep milestones 1–8.5 shipped; this is a data-direction change, not Milestone 9.
  The comprehensive security audit remains unscoped/unstarted. Accounts remain
  optional for visitors and deployments; no live Clerk tenant has been exercised.
- No broad README/UI/source-document rewrite on this planning card. A separately
  authorized documentation slice can describe the direction as planned, not live.

Non-goals: live updates, new defender/GK RoleFit models, new account features,
commercial-provider integration, a UI redesign, speculative distributed ingestion,
ML market valuation, automatic identity matching by similarity, or deployment.
There is no approved hosting budget, deadline, traffic target, uptime SLA, or
operational owner beyond the project owner. Do not infer these from a data count.

Recommended first release: Wyscout-backed identities, appearances, observed and
validated geometric metrics; only defensible roles/badges. No xG/xA estimation or
market estimates by default. Those are separate gated extensions, not numbers to
invent to satisfy coverage. This recommendation **does not waive** the original
scale gate or authorize a reduced-role release without owner approval.

## 2. Evidence and source register

### 2.1 External sources actually inspected

Only publication text and repository/Figshare metadata were inspected. No Wyscout
or Transfermarkt dataset payload was downloaded or ingested on this card. The
paper PDF was read from its author-uploaded Figshare paper record after the
configured page-extraction tool reported that its backend cannot extract URLs.

| Reference | Evidence and limit |
| --- | --- |
| S1: Pappalardo et al., *A public data set of spatio-temporal match events in soccer competitions*, Scientific Data 6, 236 (2019), DOI `10.1038/s41597-019-0247-7`; author paper record `10.6084/m9.figshare.11473374.v1` | Data Records and Tables 1–2 describe 2017/18 English, Spanish, Italian, German and French first divisions, plus separate 2018 World Cup and 2016 European Championship data; release under CC BY 4.0. This is publication evidence, not a local completeness audit. |
| S2: Pappalardo and Massucco, *Soccer match event dataset*, collection DOI `10.6084/m9.figshare.c.4415000` | Collection inventory inspected through the public Figshare API with `page_size=100`; article versions differ. Do not pin only a moving collection URL. |
| S3: Events `10.6084/m9.figshare.7770599.v1`; Matches `10.6084/m9.figshare.7770422.v1` | Metadata confirms CC BY 4.0, event positions/tags/period clocks, and match formations/substitutions. Events archive metadata lists 77,323,413 compressed bytes; this says nothing about in-memory Python/ORM footprint. |
| S4: Players `10.6084/m9.figshare.7765196.v3`; Teams `10.6084/m9.figshare.7765310.v3`; Competitions `10.6084/m9.figshare.7765316.v4` | Current article metadata inspected; all declare CC BY 4.0. Players include `birthDate`, role and `currentTeamId`. A current-team field is not evidence of a club at a historical match. Cross-version compatibility remains to be validated. |
| S5: Event dictionary `10.6084/m9.figshare.11743836.v1`; tag dictionary `10.6084/m9.figshare.11743818.v1` | Metadata inspected, not dictionary file contents. Pin the dictionaries with the selected release; unknown IDs must not be silently mapped. |
| S6: Creative Commons, Attribution 4.0 deed (which links the legal code): `https://creativecommons.org/licenses/by/4.0/` | Requires credit, source/license links, change indication and no implied endorsement/additional restrictions. Other rights may still apply; this plan is not a legal clearance. |
| S7: `https://github.com/dcaribou/transfermarkt-datasets` and its README | Distribution documentation is not proof of rights to publicly display underlying Transfermarkt-derived data or proof of 2017/18 valuation completeness. Existing ScoutBoy manifest and milestone descriptions conflict on rights; resolve separately. |

Retrievable metadata endpoints use `https://api.figshare.com/v2/articles/<id>`
and `https://api.figshare.com/v2/collections/4415000/articles?page_size=100`.
Record retrieval date, exact article version, file IDs, SHA-256 after authorized
acquisition, original license notices and any corrections in the new manifest.
Do not follow mutable `latest` references at runtime.

S1's expected domestic match counts (not yet locally verified):

| League | Matches | Events reported by S1 |
| --- | ---: | ---: |
| English first division | 380 | 643,150 |
| Spanish first division | 380 | 628,659 |
| Italian first division | 380 | 647,372 |
| German first division | 306 | 519,407 |
| French first division | 380 | 632,807 |

Validate each league individually, not just a grand total. Exclude the World Cup,
European Championship and any other competition from domestic denominators. A
count discrepancy must produce a version/correction report, never silent trimming
to fit Table 1. Player totals across leagues are not unique-person totals.
The domestic rows sum to **1,826 matches and 3,071,395 events** (calculated from
S1, not measured in a local snapshot).

### 2.2 Repository facts that constrain the design

| Existing contract / evidence | Consequence for migration |
| --- | --- |
| [M3 record](milestone_3_real_cohort.md), [cohort report](../data/reports/milestone3_cohort_report.json), [StatsBomb manifest](../data/manifests/statsbomb_bundesliga_2023_24.json) | Report records 323 players with event metrics, 18 at 450 covered minutes, 3 eligible U23 ATT/MID. Its identity section separately records 320 dual-source players; do not conflate these counts or claim a fresh run here. |
| [Transfermarkt manifest](../data/manifests/transfermarkt_player_scores.json) | Pinned to a 2026 acquisition and 2023/24 pilot, not a validated historical 2017/18 join. Its CC0 label is not a downstream-rights determination; M3 also describes personal/non-commercial restrictions. |
| [Adapter port](../packages/data_pipeline/adapters/base.py), [ADR 0002](adr/0002-provider-agnostic-data-provenance.md), [ADR 0004](adr/0004-snapshot-lifecycle-and-idempotency.md) | Reuse `SourceAdapter.fetch() -> IngestBundle`, provider capabilities, source snapshots, `RatingRun`, quarantine and no-write validation. Do not add another ingestion-run hierarchy. |
| [Ingest](../packages/data_pipeline/jobs/ingest.py) | Appearance natural key lacks provider; source metrics are replaced for affected player/seasons. Metric inventory keys omit competition. Separate league imports cannot safely accumulate transferred players' season aggregates by assumption. |
| [Recompute](../packages/data_pipeline/jobs/recompute.py) | Event coverage detection is specifically `metric_provider == "statsbomb"`. Raw metrics overwrite a dict without explicit source precedence. Recompute visits every season and `_clear_season` removes existing derived rows. Fix these boundaries before co-existence. |
| [Entities](../apps/api/app/models/orm/entities.py), [identity resolution](../packages/data_pipeline/normalize/identity_resolution.py) | `Player.primary_position` and `Team.strength_tier` are global, not seasonal; identity upsert can overwrite player fields. Historical roles/context cannot inherit modern values. |
| [Universe](../packages/data_pipeline/normalize/mvp_universe.py) | Membership checks age, position group, European competition, season minutes and covered minutes; it does not check role required-metric coverage. Keep membership and rating confidence distinct. |
| [Formula](../packages/rating_engine/rolefit/formula.py), [confidence](../packages/rating_engine/rolefit/confidence.py), nine [role configs](../configs/roles/) | YAML has `required_coverage: 0.6`, but formula does not pass that field into confidence; there is no hard 70% cap in that function. The historical documentary gate is not currently enforced simply by adding an adapter. |
| [Normalizer](../packages/data_pipeline/normalize/metrics_normalizer.py), recompute | Role-eligible pools exist, but no minimum-peer-size/fallback policy is enforced on this path. M3's planned fallback is not proof it is implemented. |
| [Market model](../packages/market_model/value_model.py) | A fixed EUR anchor can produce model values without a public valuation; suppressing only public values would not make historical output honest. |
| [README](../README.md), [Discovery record](milestone_8_discovery_contract.md) | Discovery has DB-side filters and four-statement nonempty query shape; rankings/compare/similarity still have in-process paths. `analyzed` means a stored rating exists, not that the strict U23 gate passed. |

## 3. Stop/go gates and owner decisions

All gates below are **pending**, not failures already observed in downloaded data.
A gate is satisfied by an attached, reproducible report and reviewer acceptance,
not by a promising data-source description. The owner authorizes acquisition and
any product-scope relaxation; architect owns semantics; reviewer verifies evidence.

| Gate | Go criterion | Stop / fallback |
| --- | --- | --- |
| G0 — rights and acquisition | Owner approves a specific Figshare release and intended public display; notices/attribution reviewed per file. Separate approval for any Transfermarkt-derived data. | No acquisition/publication of an unapproved source. A Wyscout-only path need not wait for optional market rights, but must be explicitly selected. |
| G1 — schema, identity, positions, minutes | Stratified sample validates IDs, encoding, clocks, tag dictionaries, roster joins, minutes and granular role eligibility. Full scan accounts for every excluded row. No unresolved conflict is admitted to rated data. | Profile-only for unresolved role/DOB/minutes; quarantine ambiguous identity. If granular positions cannot be sourced defensibly, stop RoleFit expansion; do not translate every forward to CF or every midfielder to CM. |
| G2 — whole-season and analytical coverage | Reconcile S1 match counts and expected team fixtures; report usable events/lineups separately. At least 100 unique eligible U23 ATT/MID across all five leagues; each counted player has an eligible approved role with >=70% required-metric coverage, >=450 season AND covered minutes, known age/position. | Coverage/blocker report; owner must approve narrower coverage/role scope or an authorized alternative. Never lower thresholds merely to get green. |
| G3 — model meaning | Validated metric mappings, per-role weighted support, meaningful peer sizes, calibrated confidence and badge suppression; no pressure stand-ins. Review all nine roles, including unsupported ones. | Initial release may expose only supported roles with owner approval. Pressing Forward remains unavailable. xG/carry-dependent roles require separate evidence or stay unavailable/low evidence as specified below. |
| G4 — market | Separate rights, exact identity joins, same-season dated valuations, and validation of any historically calibrated market model. | Default is market unavailable; public historical value may be enabled separately if approved, but model/asking remain null until calibrated. If market is mandatory to owner, migration stays blocked. |
| G5 — operational release | Deterministic replay, source-specific attribution, compatibility/rollback rehearsal, performance budget and full exact-head CI accepted; explicit cutover authorization. | Keep StatsBomb pilot active. No partial five-league activation, no deployment on this card. |

Age follows the existing product convention: **whole-year age <=23 at
2018-06-30**, not today's age and not an invented under-23 birthday rule. The
season label is `2017/2018`; the analysis reference date is `2018-06-30`.
DOB unknown means unknown age and exclusion only from age-constrained/U23 views,
not deletion from the general directory. Canonical season dates must preserve
this reference-date behavior instead of using the last match date as age cutoff.

G2 distinguishes four report populations: all source-backed player-seasons,
minutes/age/position-eligible universe, players with a published RoleFit, and
players passing an eligible role's analytical coverage gate. Count unique players
once globally; show league memberships separately for inter-league transfers.
Above-low confidence requires the role's own >=70% coverage, not coverage of a
*different* eligible role. Thresholds are necessary, never sufficient, for high
confidence. They do not require every player in the directory to qualify.

Pending owner choices: approve acquisition; accept a Wyscout-only/no-market
release if necessary; accept fewer supported roles if G3 excludes existing ones;
approve operational resource ceilings after the sample benchmark. These prevent
unconditional implementation/cutover readiness, not completion of this plan.

## 4. Canonical metric and role feasibility

### 4.1 Classification contract

S1/S3 describe seven top-level event types, positions and tags, not tracking,
pressure observations, or a supplied xG model. A Wyscout event count is not
semantically identical to a StatsBomb count just because a label sounds similar.
Use four mapping states in the proposed versioned mapping policy:

- `observed`: direct event/tag classification, still requiring validated inclusion
  rules and denominator (per-90 and percentages are calculated, not raw fields).
- `derived_validated`: deterministic geometric/sequence calculation accepted by
  reviewed fixtures and sample reconciliation; name and method/version displayed.
- `experimental`: feasible hypothesis, **excluded** from ratings and coverage.
- `unavailable`: null with a reason; never numeric zero.

Store per-metric provenance in existing `CanonicalMetric.raw_payload` and persisted
JSON: method ID/version, evidence state, numerator/denominator, covered minutes,
input file/match identifiers or compact hashes, coordinate convention, limitations.
A numeric zero is permitted only when the relevant events were actually observable
and fully processed with a valid denominator. Zero attempts => percentage unknown,
not 0%; absent/invalid coverage => all affected per-90 values unknown.

Proposed full-registry disposition (a starting hypothesis, not measured coverage):

| Canonical metrics | Candidate mapping and acceptance condition |
| --- | --- |
| `goals_per90`, `non_penalty_goals_per90`, `shots_per90`, `shots_on_target_pct` | Observed goal/shot/outcome tags, excluding own goals from player scoring and shootouts. Include direct free-kick shots/penalties consistently; separate non-penalty goals. Reconcile goals to match scores, own goals and lineup stats; tag combinations must not double-count. |
| `passes_per90`, `pass_completion_pct`, `crosses_per90`, `through_balls_per90`, `key_passes_per90`, `assists_per90` | Observed subtype/tag candidates; distinguish attempted/completed, open play/restarts and provider-tagged key pass/assist. Through-ball tag existence/meaning is a sample gate, not assumed from commercial docs. No invented assist from any preceding pass. |
| `progressive_passes_per90`, `progressive_pass_completion_pct`, `passes_into_final_third_per90`, `passes_into_penalty_area_per90`, `long_passes_completed_per90` | Derived geometry over validated start/end coordinates and completion tags; thresholds, pitch dimensions and restart policy in versioned YAML. Preserve existing StatsBomb definitions if truly compatible, otherwise document a different method and isolate peer pools. No new numeric threshold is silently selected in an adapter. |
| `successful_take_ons_per90`, `take_on_success_pct`, `ground_duels_won_pct`, `aerial_duels_won_pct` | Observed duel subtype/outcome candidates. Prove attacking dribble vs defensive duel, win/loss/neutral treatment, and paired-event handling; one contest may produce opposing observations, not duplicate actions by the same player. Do not use the misleading legacy attempted-take-on/aerial-count aliases as equivalent units. |
| `tackles_per90`, `interceptions_per90`, `blocks_per90`, `fouls_per90` | Observed candidate definitions using public dictionaries and reviewed examples. All defensive duels are not tackles; a clearance is not an interception; a blocked shot is not necessarily credited to the defender. Unresolvable attribution => missing. |
| `touches_in_box_per90` | Candidate derived **on-ball event proxy**, not a count of every physical touch. Define eligible event classes and deduplicate paired observations. Do not count every event endpoint as a touch or treat shot destinations as player touches. Only map to canonical key if reviewed as compatible and visibly described; otherwise keep unavailable/new explicitly named metric outside old-role coverage. |
| `miscontrols_per90`, `dispossessed_per90`, `turnovers_per90`, `ball_recoveries_per90`, `defensive_actions_per90` | Tag/sequence candidates with explicit boundaries and double-count rules. Lost duel != every dispossession; possession change != measured recovery. `defensive_actions` must list disjoint or deduplicated components. Stay experimental until checked. |
| `progressive_carries_per90`, `carries_into_final_third_per90`, `carries_into_penalty_area_per90`, `progressive_receptions_per90` | Initially unavailable. Accelerations/dribbles alone do not cover continuous carrying; receiving player is not supplied by the stated event schema. Optional reconstruction needs same-player/team/period continuity, possession/restart/gap guards, endpoint rules, uncertainty and independent validation. Never populate by taking distance between arbitrary consecutive events. |
| `non_penalty_xg_per90`, `xg_per_shot`, `goals_minus_xg_per90`, `xa_per90` | Initially unavailable; no direct xG in inspected release schema. See optional experiment below. Goals or key passes are not substitutes. |
| `shot_creating_actions_per90` | Initially unavailable pending an independently specified possession/shot-chain definition; no assumption of equivalence to another provider's SCA. |
| `pressures_per90`, `successful_pressures_per90`, `counterpressures_per90`, `passes_under_pressure_per90` | Unavailable. Do not infer from tackles, duels, distance to opponents, or quick turnovers. Event data lacks the required pressure observations. |
| `availability_index`, `recent_form_index` | Initially unavailable unless a versioned appearance-based definition is approved. Playing minutes do not establish injury availability; a match sample does not establish form. No current injury/caps/form enrichment. |
| Context: `minutes`, `appearances`, `starts`, `performance_covered_minutes`, `performance_covered_appearances`, `age` | Roster/interval aggregation and DOB/reference-date calculation; source-backed, with uncertainty reasons. No blanket 90 minutes for anyone who touched the ball. |
| Context: `league_strength`, `team_strength`, `competition_stakes`, `sample_reliability` | Versioned historical configuration or defensible 2017/18 results-derived context; not event observations. Unknown historical strength is neutral with explicit low-confidence limitation, never modern club tiers. |

Coordinate mapping must follow S3's attacking-team-relative 0–100 axes, not rotate
again by home/away. Keep original coordinates and the transformation version.
Metric pitch dimensions are a modeling convention if real dimensions are absent;
validate orientation using shots and known field boundaries before using distance.
Sort events by explicit period order, `eventSec`, stable event ID; retain original
fractional seconds and period in provenance rather than losing them in integer
canonical minute/second fields. Unknown event types/tags are counted/reported;
fail the affected metric if they change its denominator or meaning.

### 4.2 Nine-role dependency review

Every current role has three required metrics. The report must compute exact
fractions from configuration, not round two present metrics up to 70%. No role is
certified by this static table.
For the unchanged required sets, two of three is about 66.67%, so **all three
required metrics must be present** to clear the 70% gate.

| Role key | Required metrics (exact canonical keys) | Initial feasibility / decision |
| --- | --- | --- |
| `touchline_winger` | `successful_take_ons_per90`, `progressive_carries_per90`, `carries_into_final_third_per90` | Carry reconstruction blocks current required set; do not relabel a duel-only role as this role. |
| `inside_forward` | `non_penalty_xg_per90`, `shots_per90`, `touches_in_box_per90` | xG absent and box-touch semantics unresolved; cannot clear required set on initial path. |
| `pressing_forward` | `pressures_per90`, `non_penalty_xg_per90`, `touches_in_box_per90` | Unsupported as a pressing role even if xG later exists. Suppress rating/leaderboard availability for Wyscout. |
| `shadow_striker` | `touches_in_box_per90`, `non_penalty_xg_per90`, `shots_per90` | xG and box-touch gate; current role not validated. |
| `advanced_8` | `progressive_carries_per90`, `passes_into_final_third_per90`, `xa_per90` | Carries and xA absent; no claim of counterpressing ability either. |
| `deep_lying_playmaker` | `progressive_passes_per90`, `passes_into_final_third_per90`, `pass_completion_pct` | Promising required set after geometry/position validation. Missing pressure/security/availability groups still constrain meaning and confidence. |
| `ball_winning_midfielder` | `tackles_per90`, `interceptions_per90`, `ground_duels_won_pct` | Conditional on defensive event semantics and granular positions. Missing pressing group cannot be silently described as measured pressing. |
| `tempo_controller` | `passes_per90`, `pass_completion_pct`, `progressive_passes_per90` | Promising required set; absent press-resistance/availability still needs a capability-aware explanation. |
| `complete_forward` | `non_penalty_xg_per90`, `touches_in_box_per90`, `progressive_passes_per90` | xG and box-touch gate; no initial guarantee. |

Report both required-metric coverage and supported original scoring weight per
role/group. Dropping an entire defining group while renormalizing the rest can
change the tactical meaning even with all required metrics present. Before
publishing, architect/reviewer must explicitly approve each role's supported
metric profile, explanations and confidence ceiling in a versioned capability
policy. Preserve original required lists for comparison; any revised role is a
new reviewed configuration/version with a before/after report, not a quiet waiver.

For the initial Wyscout path, roles whose required set cannot meet G2 are withheld
from published ratings (not emitted as zero-score rows); report why in analysis
availability. Low-minute but otherwise supported roles may remain low-confidence
consistent with current broad discovery. With no published role, the player is
profile-only and discoverable in `all_records`, not `analyzed`.

Playstyles: explicitly suppress `press_resistant` and `relentless_presser`;
carry-dependent `technical_carrier`/`transition_outlet`, xG-dependent
`inverted_threat`/`finesse_finisher`, and box-touch-dependent `box_crasher` wait for
validation. Review all remaining YAML requirements, not just names. Absence of
pressing evidence must not emit `low_defensive_output`; absence of model value
must not emit an inflated-market concern. Missing evidence is not bad performance.

### 4.3 Optional experiments, not first-release dependencies by stealth

If the owner requires existing attacking-role coverage, first authorize a separate
xG feasibility experiment. Prefer a transparent, versioned shot model with legal
training inputs, documented distance/angle/body-part/set-piece features, frozen
coefficients and reproducible training record. No StatsBomb model values may be
rebranded as Wyscout observations. Split by match (and test cross-league behavior),
not random duplicate shot rows; prevent outcome-derived tags from becoming input
features. Report calibration curves, Brier/log loss against a simple base-rate
baseline, sample size and subgroup uncertainty. Fix acceptance criteria before
examining model results. In-sample xG must not be used to claim out-of-sample
finishing skill. Prefer held-out/cross-fitted estimates for displayed-season
analysis if training uses that season, with fold provenance.

xA additionally needs reviewed pass-to-shot linkage, same possession/period,
no intervening opposition/restart, handling of rebounds and ambiguous receivers;
then aggregate linked shot xG, not every key pass. Failed validation => null for
xG, xA and dependent outputs. Carry/receive/SCA reconstruction has a separate
sample-labeling experiment and can fail independently. No automatic training or
new ML service is justified for this fixed snapshot.

## 5. Data architecture and contracts to implement later

### 5.1 Components and ownership

Keep `apps/web -> HTTP -> routes -> services -> repositories -> DB` and the existing
domain packages. Proposed source key: `wyscout_public_2017_18`; provider slug uses
that same key to avoid confusing the public snapshot with a future commercial
provider. `source_player_id` is the string form of Wyscout `wyId`, never reused as
a ScoutBoy primary key. Canonical competition slugs reuse the existing registry.

Proposed new files (not created by this card):

- `packages/data_pipeline/adapters/wyscout_public.py`: local snapshot parser and
  provider declaration; no network. Source schema stays here, mapping into canonical
  matches/events/lineups/appearances/metrics/evidence.
- `configs/providers/wyscout_public_2017_18_v1.yaml`: explicit competition/season
  allowlist, dictionaries and metric definitions, thresholds and exclusions.
- `configs/identity/wyscout_public_overrides_v1.yaml`: reviewed ID/position mappings
  with evidence, reviewer, reason and historical applicability; no name-only merges.
- `data/manifests/wyscout_2017_18.json`: exact release/file versions, notices,
  SHA-256, counts, scope, transformation versions and compatibility acceptance.
- `docs/metric_definitions_wyscout_v1.md` and a generated feasibility report under
  `data/reports/`: every metric/role outcome, including unavailable ones.

Capabilities: event provider, local snapshot, no credentials, not fixture data,
explicit supported entities/metrics, no valuations/tracking/360, fixed historical
freshness semantics. Declare only accepted metrics as supported; experimental
metrics do not count. `last_match_date` is evidence date; acquisition and build
timestamps are separate. An old complete historical season is not a broken live
feed, but it is never current data.

### 5.2 Snapshot and aggregate design

Use a single accepted Big Five release scope for final player-season metrics.
Parse/validate one league/match at a time into a bounded local working store if
necessary, then aggregate once over the allowlisted domestic union. Do not publish
five independent same-source metric bundles: current deletion/deduplication keys
can overwrite cross-league players. Match/event IDs remain namespaced by provider.
Preserve player/team/competition/match contributions so transfer aggregation can
be audited. Sum counts and denominator minutes before dividing; never average
per-90s or percentages, never sum duplicate sources of appearances.

Retain existing canonical port for first implementation if the sample/full-size
memory feasibility gate passes. `IngestBundle` is list-based and fingerprinting
also materializes inventories; existing 5,000-player batching is not proof it can
hold millions of events. If measured budgets fail, architect must extend the port
with deterministic staged/batched event publication under the same logical
snapshot and transaction semantics, keeping current adapters working. This is a
bounded risk-reduction decision before full ingestion, not an excuse for adding
queues, Spark or a data lake. Raw-event retention must not be silently dropped to
make a benchmark pass; an aggregate-only alternative requires explicit approval
and reproducible raw-file evidence outside the serving DB.

Raw archives stay gitignored under `data/raw/wyscout/`. Keep immutable approved
inputs and manifests for rebuild while the portfolio uses that release. Persist
safe quarantine reason codes, source IDs and hashes, not full personal payloads.
No runtime fetch, vendor token, or provider payload is sent to the browser.
Dataset retention/revocation is distinct from account retention; the owner must
approve storage location/access and deletion obligations before publication.

### 5.3 Identity, historical profile and minutes

Wyscout supplies DOB (unlike the old StatsBomb pilot), so Transfermarkt is **not
mandatory** for identity/age on the proposed path. Match roster membership, not
`currentTeamId`, establishes historical club. Match competition establishes league.
Provider role may be only coarse: mapping F/M/D/GK to ATT/MID/DEF/GK is acceptable
for directory filtering, but is insufficient for ST/CF/LW/RW/CM/DM/CAM eligibility.
Use reliable historical positions from an approved source or reviewed per-player
mapping; event-location averages are not automatically ground truth for roles.

Identity priority: existing exact provider ID, then unique canonical name+DOB,
then explicitly reviewed override; conflicting existing IDs/DOBs block that player.
No fuzzy or contained-name autolink. Unknown ID 0/unattributed events stay anonymous
and do not create a footballer named "0". Report their impact on metric denominators.
A missing Transfermarkt crosswalk leaves market missing, not the Wyscout player
missing. Save mapping version and conflict dispositions; never log auth identities.

Proposed minimal additive schema changes, requiring Alembic SQLite/PG tests:

- `PlayerSeasonProfile`, unique `(player_id, season_id)`: historical primary
  position, position source/snapshot, mapping version, evidence status. New Wyscout
  season uses it for eligibility and API position; unknown granular position stays
  unknown. Legacy seasons fall back to existing global position only under an
  explicit legacy policy. Do not globally overwrite historical/current positions.
- `TeamSeasonContext`, unique `(team_id, competition_id, season_id)`: strength tier
  or neutral/unknown, source/method/version. Do not overwrite `Team.strength_tier`
  when deriving 2017/18 context. Preserve old outputs and tests.

Use existing provenance JSON for metric method details and existing registration,
lineup and coverage models; avoid extra tables until a query requires them. Season
`is_current` means the selected dataset default internally, not a claim of current
football coverage; API/UI label it historical and expose reference date separately.
No broad season-selector feature is required to complete this migration.

Minutes algorithm must be explicitly reviewed against the sample: reconstruct
intervals from starting lineups, substitutions and dismissals; distinguish unused
bench players from appearances; reconcile simultaneous substitutions, second-yellow
reds, halftime changes, stoppage time and missing formations. Select a consistent
regulation-clock policy for domestic season minutes (stoppage clipped at period
boundaries, interval arithmetic before final rounding); preserve raw timestamps
and report differences from published appearance minutes rather than forcing
agreement. Coverage minutes count only validated intervals in matches whose event
file is accepted. Never estimate exposure from first/last player event or infer
full minutes from a match-level file count. Uncertain intervals exclude that
player-match from rated denominators, with missingness reason and lost minutes.

Per match: validate 11 starting players per side or an explicit correction, legal
substitution transitions, no overlapping intervals, positive/finite durations,
team totals adjusted for dismissals, and goals including own-goal reconciliation.
Per season: reconcile full-season vs event-covered minutes per player/team/league;
full match inventory does not mean every player's denominator is known.

### 5.4 Source selection, historical context and ratings

Add explicit dataset/season selection to recompute; default legacy behavior stays
compatible until an approved cutover. Select accepted source snapshot(s) and
method versions deterministically per metric family, not last DB row wins. In
this release Wyscout owns performance and minutes; a permitted market import owns
only market inputs and cannot replace Wyscout appearances/positions. Fail on two
active same-priority conflicting metric records. Run provenance lists only inputs
actually consumed, not every snapshot in the DB.

Replace StatsBomb string checks with provider-capability/evidence detection;
missing covered minutes in *any* event-backed player-season means no covered
sample, not fallback to total season minutes. Add the >=70% hard confidence cap
in reviewed configuration/engine behavior, plus capability-based role suppression.
Do not pretend the currently unused YAML `required_coverage` enforces this. Test
both sides of thresholds. Version the observable change (proposed `rolefit-v3`)
and regenerate calibration baselines only with explained diffs. Archive v2 pilot
reports; do not claim they validate Wyscout or mutate them into Wyscout reports.

Peer pool: same accepted dataset, season, metric definition and eligible position;
all ages can supply peers, independent of the U23 browsing segment. Report cohort
and per-metric usable peer counts. Proposed minimum is 8 **usable peers per metric**,
a reviewable policy choice inherited from M3's example, not a statistical guarantee.
Below that floor, withhold the affected percentile/rating rather than silently
fallback to all positions; show insufficient peers. Run sensitivity by league,
role and minute threshold to assess pooled Big Five percentiles before claiming
cross-league credibility. One role's confidence cannot borrow another's evidence.

Primary club/league context for a transferred player: greatest validated domestic
minutes, ties resolved by canonical team slug then competition slug, never input
order. Aggregate eligible same-season domestic performance across stints, retain
stint distribution, and explain that the displayed primary league/club filter is
not "played only here". Unknown/ambiguous minutes prevent primary-context certainty.
Use 2017/18 results for team tiers if validated; unvalidated league/opposition
strength is neutral and disclosed, not current coefficients smuggled backwards.
No role-usage positional split, recent form or injury claim without evidence.

### 5.5 Market decision and temporal integrity

Public event license does not cover a separate market dataset. Obtain and record
owner acceptance of underlying display/redistribution rights before using
Transfermarkt-derived identity/value rows. MIT code and an aggregator's CC0
metadata are not sufficient evidence to resolve the historical contradictory
notes. No new live scrape. Missing rights => exclude those fields from public
outputs and from runtime build inputs, not merely hide attribution.

If approved, use a frozen snapshot with a proven 2017/18 subset. Exact provider
crosswalks only. Choose latest valuation on/before **2018-06-30** and within the
approved season window beginning **2017-07-01**; report exact valuation date,
source and currency. Earlier-only value remains unavailable for this release
rather than silently becoming same-season. No forward fill from 2018/19 or current
`market_value_in_eur`, current contract, current club, current caps or present-day
hype. Contemporary contract history, if absent, is null. Document reporting lag;
valuation publication dates are not proof of a transaction price.

Default output: historical public value null until this gate passes; model value,
expected asking and value labels null/unknown even if a public value exists,
until the fixed-anchor market model is reviewed/calibrated for the historical
season. Merely widening today's model range is not validation. Preserve API null
ordering and active-bound exclusion; unavailable market filters explain why they
return no known values. A cheaper/similarity comparison must not derive bargains
from unknown amounts. Synthetic market tests and archived pilot remain intact.

## 6. Compatibility, API/UI and release operations

Preserve routes and Discovery filter/sort/URL contracts. Extend typed evidence
schemas additively for dataset label, analysis reference date, provider attribution,
metric method/evidence state, unavailable-role reasons and market evidence date.
These are proposed contract fields to name/freeze in the first schema slice; no
provider-specific tag vocabulary crosses the API. Regenerate OpenAPI + TypeScript
and test all consumers. No frontend scoring. Preserve `best_role` vs `result_role`,
unknown-last sorting, four-statement Discovery budget and selected-role consistency.

A role unsupported for this dataset remains a recognized role key; a selected-role
query returns the normal empty result with availability explanation, not a fake
score or a new unknown-role 422. Unknown role keys still 422. Use the Methodology
capability payload for disabled/unavailable controls, leaderboards and comparisons.
Unrated records keep null scores and remain accessible in `all_records`; do not
seed zero RoleRatings simply to populate default `analyzed`.

Required copy at eventual implementation: "Historical 2017/18 analysis — not live
or current scouting data"; age "at 30 June 2018"; historical club/league; observed
versus estimated metrics; covered vs season minutes; unavailable pressure/xG/etc;
unsupported roles/badges; historical market date or unavailable state. Apply to
Discovery, cards/audits, Compare, rankings, similarity, Methodology, saved work and
empty/error states. Do not say "five complete leagues" until G2 proves match and
usable coverage; completeness of a source release is not analytical completeness.

Wyscout attribution should credit Wyscout and Pappalardo/Massucco's collection,
cite S1 and exact dataset DOI/version, link CC BY 4.0, and indicate ScoutBoy's
normalization/aggregation/model changes without implying endorsement. Source
notices travel with derived exports if exports are later added. StatsBomb-derived
archived pages retain StatsBomb attribution; do not globally replace it with
Wyscout. No club logos, player photos or trademark license is implied by event
rights. Data permissions and code licensing remain separate.

Co-existence strategy: preserve pilot raw manifests, committed report, adapters,
tests and milestone records. Build a candidate database from a controlled backup
of the existing DB so canonical player IDs are not reassigned. Add Wyscout as a new
season and recompute **only** that season. Seasonal profile/context prevent global
identity contamination. Do not call the existing all-season recompute unchanged.
Keep candidate and serving database separate until acceptance; no half-imported
league is publicly served. Source reports are versioned, not overwritten.

Saved data: guest favorites/comparisons contain numeric player IDs; these must
never silently point to different players after rebuild. Preserve canonical IDs
and exact provider links in candidate builds. Existing 2023/24 records lacking
2017/18 evidence must show explicit unavailable/stale state, never resolve by name.
Saved views reopen against active historical data and must disclose changed dataset
context; saved comparisons must not imply their previous analysis is still valid.
Do not introduce a new season-aware saved-work schema without its own reviewed
compatibility slice. Never clear browser or account data as a migration shortcut.

Operational activation (future, requires explicit owner authorization):

1. Backup serving DB/schema version and input/config manifests; record restore
   command and checksums. Build/validate/recompute candidate, then run all gates.
2. If accounts are enabled or any private data changed since the backup, stop
   cutover until a tested reconciliation exists. Recommended bounded procedure:
   freeze private writes briefly, copy latest account/saved tables transactionally
   preserving IDs/FKs, verify row counts/ownership, then switch; otherwise abort
   and resume old service. No live Clerk claim follows from offline tests.
3. Under maintenance, select the historical default in the candidate and switch
   the configured DB/path atomically with service restart/health verification.
   Retain old DB read-only, do not expose a second public service by default.
4. Smoke-test discovery/card/compare/role absence/market null/attribution and saved
   IDs. On any failure, revert configuration/DB to backup, preserving any private
   writes made since activation through the same reconciliation procedure. Keep
   writes frozen until smoke passes to avoid an untested reverse-copy problem.
5. Retain rollback artifacts until owner accepts the release and retention policy;
   failure does not trigger raw-data deletion or an automatic destructive downgrade.

Additive migration rollback is preferably application/config rollback to the
untouched prior DB. Test both upgrade from a populated pilot and fresh install;
never rely on `create_all` as proof Alembic migrations work. No deployment provider
or zero-downtime guarantee is selected by this plan.

## 7. Failure, security and capacity boundaries

- Treat local provider archives/JSON as untrusted input: path confinement, no
  absolute/parent paths or symlink escape on extraction; size/row/depth limits,
  finite numeric values, schema validation and no code/deserialization execution.
  Pinned expected checksums mismatch => stop, not warning. Escape names in UI;
  never render source HTML or arbitrary source URLs as trusted markup.
- Authorized acquisition is an operator step with bounded retry/backoff for
  transient network errors. Imports and requests are offline; no retry loops on
  schema/license failures. Idempotent replay is explicit and snapshot-scoped.
- One ingestion/recompute writer per candidate DB. Use an operator lock first;
  acquire a DB lock/unique constraint if concurrent jobs become possible. Do not
  assume a preflight idempotency read is race-safe. Recompute/ingest cannot overlap.
- Blocking validation runs before publication. Row quarantine may allow a report
  with warnings, but losses affecting G1–G3 keep activation blocked. Transactional
  publication failure rolls back canonical rows; failure history remains diagnostic.
  Forced process termination, disk-full and duplicate execution are test cases.
- Existing admin token boundary stays server-side; no admin ingestion exposed to
  browser users. Production configuration must retain token/CORS safeguards.
  No new secret or private endpoint is needed. Public professional identity/DOB is
  personal data; minimize retained fields, omit unnecessary coaches/referees/weight
  or private enrichment, and route rights/takedown requests to the owner. No claim
  that this work completes rate limiting/CSP/security-audit gaps in [SECURITY](../SECURITY.md).
- Record run/snapshot IDs, source/version hashes, phase duration, processed/rejected
  counts, unresolved identities, covered-minute losses, role coverage, peer counts,
  skipped-idempotent status and structured error reason. No tokens or raw account
  identifiers in logs/reports. Historical freshness monitoring checks reproducible
  snapshot health, not daily football-data refresh.
- Expected bottlenecks: decompressed events plus Python objects, list-based bundles,
  inventory hashing, per-event ORM writes, DB indexes/storage, normalization over
  full peer pools, similarity/compare memory and candidate DB duplication. Measure
  peak RSS, wall time, DB bytes, row throughput, statement counts and cold/warm API
  timings on named hardware and both database backends. Record data sizes and
  concurrency used; no fabricated latency/SLA target.
- G1 benchmark must set owner-approved memory/storage/runtime ceilings before a
  full import. Preserve Discovery's existing four-query shape, bounded page load
  and deterministic 5,000-record regression fixture. Full Wyscout capacity is a
  new measurement, not inherited from that fixture. Scale first with bounded parse,
  bulk writes and measured indexes; no cache/queue/service split without evidence.

## 8. Reviewable implementation roadmap (not dispatched)

Dependencies are gates, not calendar estimates. Supervisor creates/authorizes
implementation cards after review; this planning card dispatches none. Shared
hotspots are ingest/recompute, canonical schemas, role/calibration configs and
Methodology contracts: serialize those changes, not simultaneous competing edits.

| Slice / suggested specialist | Outcome and acceptance | Dependencies / verification |
| --- | --- | --- |
| P0 — owner + architect, rights and sample feasibility | Approved acquisition/version matrix; sample/schema/positions/minutes report; per-role initial support; measured capacity budget; explicit no-market/reduced-role decision if needed. Stop if rights or historical identity cannot be resolved. | Plan review + G0 authorization. No DB publication. Follow sample protocol below. |
| P1 — architect, freeze contracts | Metric dictionary/method states; granular-position policy; deterministic source precedence and transfer aggregation; seasonal profile/context migration; selected-season recompute contract and historical market suppression. Record ADR for accepted deviations from this proposal. | P0 accepted. Fresh/populated SQLite+PG upgrade tests; old provider and API contract regression. |
| P2 — coder, provider vertical slice | Local adapter registration/capabilities; verified manifest; minimal legally permitted or synthetic Wyscout-shaped fixtures; identities/rosters/events/basic metrics into candidate DB with no-write validation, quarantine and replay. | P1 contract. Start one match/league, prove duplicate/order/missing-file cases before scale. No scoring/UI changes in this slice. |
| P3 — architect, evidence and model correctness | Generic event minutes, explicit metric precedence, selected-season recompute, >=70% cap, peer floor, role availability, seasonal context and market null policy; new rating version with audited deltas. | P2 plus accepted metric semantics. Full rating/calibration regression; historical output invariant tests. |
| P4 — coder, report/full-snapshot acceptance | Authorized full Big Five import in candidate DB; match/player/role/minute/identity distributions; deterministic fingerprints and replay; G2/G3 evidence, throughput/RSS/DB/query report. | P2/P3 and capacity budget. Failure yields blocker report, not an artificial successful cohort. |
| P5 — coder, API/UI and truthful docs | Typed additive evidence fields, historical copy, source notices, unavailable role/market states, saved-ID compatibility, no scoring in frontend. Broad README/data-source/methodology updates accurately separate plan/implemented/archive status. | Contract from P1/P3. UI scaffolding can proceed in parallel with P4 using synthetic fixtures; final assertions wait for actual reports. |
| PX — architect, optional derived metrics/market | Separately authorized xG/xA/carry/market experiments and review, with versioned validation artifacts or explicit rejection. | P0 + owner decision. Not required for core-only path; required if owner insists on the existing unsupported roles/market. Merge model/config work serially with P3. |
| P6 — reviewer + supervisor, release rehearsal | All CI/E2E/security gates, real-data read-only verification, migration/restore rehearsal, attribution and saved-data checks; exact-head evidence + explicit owner cutover decision. | P4/P5 and PX only if selected. No merge/deploy without owner authorization. |

### 8.1 Sample-based feasibility protocol (future execution)

After G0, inspect approved local inputs read-only before building the adapter.
Pin sample selection: earliest/middle/latest played match by date and provider ID
in each league, plus all discovered edge categories needed below. Save IDs and
selection rule; sample findings cannot prove full-season coverage. If archive
layout requires full download to inspect a sample, get that acquisition approved
explicitly; do not circumvent the planning-only restriction.

Label/reconcile representative normal pass/failed pass, cross, dribble/tackle,
paired duel, shot/free-kick/penalty, own goal, interception and missed-touch cases
against the public dictionaries and roster/result records. Include substitute,
unused bench, halftime change, dismissal, missing formation, unattributed player,
zero-attempt denominator and inter-club/inter-league transfer. Use human review
where meaning is ambiguous; do not claim video validation without authorized video.

Deliver: file/schema version matrix, identity/DOB/granular-position completeness,
match/roster/reference integrity, minute reconciliation, coordinate/tag test cases,
all canonical metrics and nine-role support matrix, estimated exclusions and
measured sample resource use. Mark unobserved edge cases as untested and create
synthetic fixtures for behavior, without claiming those fixtures establish real
source completeness. Then full inventory scan validates G2 and quantifies each
league's loss funnel and weighted role coverage. No sample-only scale claim.

### 8.2 Behavioral verification matrix

| Concern | Required tests / acceptance evidence |
| --- | --- |
| Parser/identity | Valid and malformed public-schema fixtures, UTF-8 names, exact source IDs, duplicate/conflicting IDs, DOB conflict, ambiguous name+DOB, reviewed override, unknown player 0. No unexpected merge or dependent observations published for a quarantined identity. |
| Minutes/metrics | Golden hand-audited count/percentage/per-90 cases; no endpoint-as-touch bug; no carry across restart; coordinate orientation; substitutions/red cards/stoppage; percentages missing at zero attempts; missing file != zero activity; associative weighted aggregation across stints. |
| Coverage | Expected per-league match IDs/counts and home/away fixture reconciliation; unknown denominator remains unknown; each of all nine roles reported with exact required/weighted support; unique U23 counting and exclusions; 449/450 covered-minute and age-date boundaries. |
| Models | Below/at 70% cap with explicit fractional cases, missing defining groups, no pressure/xG badges, no required metrics => no published zero rating, per-metric peer floor, same-source/method peers, repeatable ties, league sensitivity and explained calibration deltas. |
| Lifecycle | Validate/dry-run zero DB writes; identical snapshot skipped; changed content/new fingerprint; reordered inputs same semantic output; corrected snapshot removes stale rows without erasing another provider/season; crash/rollback/retry; concurrent invocation rejected. |
| Temporal/market | Same player in 2017/18 and pilot retains different position/context; as-of date rejects future valuation/current club/current contract; no market-model fallback when disabled; archived pilot ratings/audits unchanged after Wyscout recompute. |
| API/frontend | Existing filters, ranking explanation and selected-role consistency, unknown-last market ordering, unsupported role empty state, no broken compare/similarity, historical reference date/not-live labels, required provider links, nullable generated contract, saved numeric IDs never reassigned. |
| Deployment/recovery | Fresh and existing SQLite/PostgreSQL migrations, candidate switch/backout, preserved account ownership/IDs, optional-auth-off defaults, no live Clerk claims, resource ceilings, health and readiness. |

Existing runnable baseline commands (future implementation, from repo root with
approved Python 3.9/3.11, Node 20 and pinned pnpm; not a claim they ran on this card):

- `make lint`, `make test`, `pnpm --filter @scoutboy/web typecheck`,
  `pnpm --filter @scoutboy/web build`.
- `make check-api-contract`; repeat after an intentional generation diff and
  require tracked artifacts clean on final run.
- `make calibration-evaluate-fixtures`, `make calibration-evaluate-pilot`;
  the latter can be inconclusive if the archived local pilot is absent. Add a
  separate Wyscout evaluator that is **required** and non-inconclusive on the
  release runner; do not rewrite the StatsBomb-specific cohort verifier.
- `make e2e` (isolated DB, production build, Chromium), plus targeted historical
  fixture flow; cross-browser `pnpm run e2e:cross-browser` with required browser
  binaries installed when validating the changed surfaces.
- PostgreSQL 16 CI: `.venv/bin/alembic upgrade head`, deterministic sample ingest
  and recompute, then `SCOUTBOY_POSTGRES_SMOKE=1 .venv/bin/pytest
  apps/api/app/tests/test_postgres_smoke.py`; add Wyscout-shaped integration on the
  same real dialect. `make docker-smoke` on a Docker/network-capable runner.
- `git diff --check`, Gitleaks, `pnpm audit --prod --audit-level high` and the
  exact pip-audit command/exceptions in [.github/workflows/security.yml](../.github/workflows/security.yml).
  Do not weaken security gates to land this change.

[CI](../.github/workflows/ci.yml) requires Python 3.9/3.11 Ruff/Black/pytest with
90% coverage, frontend lint/typecheck/tests/build, API contract freshness,
PostgreSQL integration, production E2E and container smoke; Security is separate.
Synthetic CI must not download the full dataset or require vendor credentials.
A separately authorized, pinned-snapshot runner produces full-data acceptance;
missing raw data may be inconclusive in developer tests but **blocks release**.

## 9. Alternatives, residual risks and handoff

- Keep the StatsBomb pilot: lowest change cost and known semantics, but does not
  solve five-league scale. It remains the safe fallback while gates are unresolved.
- Wyscout core-only (recommended first candidate): simplifies permissions/identity
  by using source DOB and no market join. Trades away pressure, several roles and
  possibly granular positions; only owner-approved narrower claims may ship.
- Reconstruct every old metric: greater apparent feature parity, but adds validation
  and semantic risk. Reject pressure fabrication; gate xG/carries independently.
- Licensed performance/historical market source: a possible later alternative if
  gates fail; procurement/budget/rights not authorized. No commercial trial/API
  access is implied by the public release.
- Aggregate-only serving dataset: reduces DB footprint but changes event retention
  and debugging contracts; consider only after measurement and explicit review.

Highest risks: coarse source positions, uncertain minute reconstruction, role
meaning after lost groups, mixed vintage player metadata, source overwrite on
transfers, rights to separate market data, memory during event materialization,
and saved IDs across a rebuilt database. Full seasons solve an exposure problem,
not these semantic/rights/model problems. Neither model choice nor CI green is
proof of statistical validity, public-data rights or production security.

First executable slice after approval is **P0: rights + read-only sample
feasibility**, not the adapter or UI rewrite. The supervisor must resolve pending
owner choices and review the acceptance report before authorizing P1–P6. Plan
review does not certify a 100-player cohort, xG model, public market panel, completed
migration or deployment. Implementation will append measured results and decisions,
not edit this provisional plan into a claim that work already happened.

## 10. Planning-only verification record

On 2026-09-26, host Python 3.13.5 ran a disposable, read-only checker via
`python3 .planning-check.py` (exit 0). It checked both changed documents: 23 local
Markdown link targets existed, all 54 canonical registry metric keys were covered
in the plan, all nine role rows matched their YAML required lists exactly, and
fences/conflict-marker checks passed. It also calculated the S1 domestic totals
and the required-coverage fraction above. This is a bounded document check, not
a Markdown renderer or evidence that the future mappings work on real data.

`git diff --check` passed on the host (exit 0); the final staged/committed diff is
checked again before publication. Repository inspection of Makefile, manifests,
scripts and workflows found no dedicated Markdown/link verifier; the existing
`scripts/check_api_contract.py` checks generated API artifacts, not documentation.
No application suite, new data feasibility test or full-snapshot import was run
on this docs-only card. Those future commands and required runners are in section
8. Publication SHA, draft PR and independent review state belong to the card/PR
handoff so this document does not claim a self-referential final commit hash.
