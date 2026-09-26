# Wyscout 2017/18 Big Five — P0 Feasibility Report

Card `t_44597dd8` · P0 of [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) (§§2–4, 8.1) ·
measured 2026-09-26 · branch `research/wyscout-p0-feasibility` (based on `main` @
`0b9d188f34c1a9dbfc11bd342aadf84837516d05`).

> **Status: research evidence only. Pending independent review.** Nothing was imported into a
> ScoutBoy database, no rating was recalculated, no API/UI/product code changed, nothing was
> deployed and nothing is merged. The Wyscout data was downloaded **privately and read-only**
> to measure feasibility. This report is **not** legal clearance for public display or
> redistribution, and it does not approve market data or any reduction in role scope.

---

## 1. Executive verdict (plain language)

**Verdict: NO-GO for the full-scope plan as written. CONDITIONAL on an owner decision for a
narrower alternative.**

Think of the dataset as a very complete **match diary** that is missing each player's
**job title**:

- **The diary is complete and consistent.** Every match and every event the source paper
  promises is there: 1,826 league matches and 3,071,395 events, matching the paper
  league by league. Complete fixture lists, clean IDs, a birth date for every player who
  played, and minutes that add up to exactly 11 × 90 (less dismissals) for every team-match
  except those in 3 Italian matches with broken substitution records.
- **Job titles are missing, so role eligibility fails.** ScoutBoy's nine roles need granular
  positions such as CM, DM, ST or LW. The public release only gives one coarse **current**
  label per player: Goalkeeper, Defender, Midfielder or Forward. Match lineups carry no
  positions. The plan's rule (G1) says not to turn every "Midfielder" into a CM. On that
  rule, **zero** players pass the strict G2 test. The target is 100.
- **Most roles also lack their metrics.** Only 2 of the 9 roles, Deep-Lying Playmaker and
  Tempo Controller, have all three required metrics computable from this data. Even those
  are unvalidated candidates. Six roles need xG, carries or pressures, which the source
  does not contain. Ball-Winning Midfielder is at 2 of 3, and 2/3 (66.7%) is below the 70%
  gate.
- **Best case, if you relaxed the rules.** Suppose you (a) accepted the coarse
  "Midfielder" label for those two passing roles and (b) the three passing metrics later
  passed validation. Then **183** unique under-23 midfielders would clear the minutes gate
  across the five leagues. That is a **ceiling, not a pass**: it needs your sign-off to
  change the plan's position rule, plus P1 validation work.

**What this means for you:** the data is good enough to be worth something, but not for
the product as planned. You need to choose one option from §9. Do not start P1 as written.

---

## 2. Gate-by-gate status

| Gate | Status | Evidence (details in the sections below) |
| --- | --- | --- |
| **G0 — rights & acquisition** | **Private feasibility: met. Public display: OPEN.** | All 7 pinned Figshare articles are labelled **CC BY 4.0**. Every file ID, size, MD5 and SHA-256 was verified. Attribution text was captured. Public display still needs the owner's decision and a personal-data review (§3). |
| **G1 — schema, identity, positions, minutes** | **FAIL on granular positions.** Schema, IDs, DOB and minutes are sound. | IDs are unique, DOB is 100% present for appearing players, and minutes reconcile. Positions: there is only a coarse, current `role` field (GK/DF/MD/FW) and no per-match position (§5). The plan's G1 fallback applies: **stop RoleFit expansion**. |
| **G2 — season & analytical coverage** | **Match coverage met. Analytical gate NOT MET (strict count 0 of 100). UNPROVEN.** | Measured 1,826/1,826 matches and 3,071,395/3,071,395 events against S1. Strict qualifying U23 count is 0. Diagnostic upper bound is 183 (§6). |
| **G3 — model meaning** | **Not established.** | 2/9 roles are candidates, 1/9 is at 2 of 3, and 6/9 are blocked. No metric has been validated yet. Pressing Forward stays unavailable (§7). |
| **G4 — market** | **Unavailable (default).** | The source has no market data. Transfermarkt was not acquired or used. |
| **G5 — operational release** | **Not started (out of scope).** | This card was measurement only. The StatsBomb pilot stays active. |

---

## 3. Rights register (technical, not legal advice)

| Item | Finding |
| --- | --- |
| Licence metadata | Figshare API `license` = **CC BY 4.0** (`https://creativecommons.org/licenses/by/4.0/`) on all 7 pinned article versions. |
| Depositors | Luca Pappalardo, Emanuele Massucco (dictionaries: Luca Pappalardo). Funding: SoBigData Research Infrastructure. |
| Required attribution | Cite S1: Pappalardo, L., Cintia, P., Rossi, A. et al. *A public data set of spatio-temporal match events in soccer competitions.* Sci Data 6, 236 (2019), doi:10.1038/s41597-019-0247-7. Also cite the Figshare collection doi:10.6084/m9.figshare.c.4415000. The dictionary articles additionally ask for the PlayeRank paper (doi:10.1145/3343172). |
| Proposed private, read-only feasibility use | Consistent with the licence metadata. This is the only use exercised. |
| Public display in ScoutBoy | **Unresolved; owner decision.** Open questions: (1) whether the upstream provider (Wyscout) has published any terms beyond the depositors' CC BY label (not reviewed); (2) the data contains named players' birth dates and nationalities, i.e. personal data, so public display needs a data-protection review; (3) provider trademarks and attribution placement. |
| Historical market data | None in the source. Any Transfermarkt or other valuation data needs separate rights (G4). |
| Scraping / mirrors / credentials | None used. Only the pinned Figshare public API download URLs were fetched. |

No legal certainty is claimed.

---

## 4. Acquisition, checksums and reproducibility

**Inputs** (the file IDs below are the ones the Figshare API returned for the pinned
versions). All seven files were verified by size, MD5 and SHA-256, and re-verified at the
end of the run (`fetch_sources.py --verify-only`, exit 0):

| File | DOI (pinned version) | Figshare file ID | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| events.zip | 10.6084/m9.figshare.7770599.v1 | 14464685 | 77,323,413 | `877e015b716ffdeea18f04418e3f24fed307ed03c37ff305cabe1f47c4822a45` |
| matches.zip | 10.6084/m9.figshare.7770422.v1 | 14464622 | 645,097 | `c8f92bb7533e5c127e043cee764c991b5c25b4f5e70a65be931baae0b1765ce9` |
| players.json | 10.6084/m9.figshare.7765196.v3 | 15073721 | 1,737,347 | `877a111cb1005b73df5645e9338bd74fb4b496bace2fbc545a72abb3b73efa2e` |
| teams.json | 10.6084/m9.figshare.7765310.v3 | 15073697 | 27,404 | `9f7a4a3b3d92c0be33f40613ad6e6eb4316c3b9771ec74c61a22c9b8ece23a4d` |
| competitions.json | 10.6084/m9.figshare.7765316.v4 | 15073685 | 1,209 | `39a738d2bc97638502e1ead01d661b54c623d6d6b37f77de3846f9a94db7a3a1` |
| eventid2name.csv | 10.6084/m9.figshare.11743836.v1 | 21385245 | 1,001 | `ce7bafb341b36ab4c6093bf1c09c967e9cea10d4223724a1fc679086e5d16842` |
| tags2name.csv | 10.6084/m9.figshare.11743818.v1 | 21385239 | 1,754 | `e0bc1bd8ff6ea5339586fdfc3e8e9b285a4a18f1ae2f5868ccc9ec9cecc8a922` |

**Version compatibility:**

- All 5 domestic match and event files use a single season ID and competition ID each,
  and those IDs match `competitions.json`.
- Every team appears in `teams.json`.
- 15 roster player IDs are absent from `players.json`. **None of them ever played a
  minute.**
- The dictionaries cover every event/sub-event pair and tag, with one exception: eventId
  6 (Offside) with an empty sub-event, 7,821 events. It is unused by any metric.

**Reconstruct from nothing** (repo root, Python ≥3.9 with PyYAML, e.g. the project venv):

```bash
python scripts/wyscout_p0/fetch_sources.py            # downloads to gitignored data/raw/wyscout/, verifies pins
python scripts/wyscout_p0/p0_analysis.py --raw data/raw/wyscout \
    --output data/reports/wyscout_p0_feasibility.json \
    --local-detail data/raw/wyscout/p0_local_detail.json
python scripts/wyscout_p0/verify_counts.py --raw data/raw/wyscout \
    --report data/reports/wyscout_p0_feasibility.json   # independent re-count, exit 0 only if all match
```

- Every threshold and ID the analysis uses lives in
  [`scripts/wyscout_p0/p0_policy.yaml`](../scripts/wyscout_p0/p0_policy.yaml)
  (`wyscout_p0_policy_v1`, SHA-256 `23684833…0997`). The unchanged `configs/roles/*.yaml`
  files are also inputs. The policy is research-only and **not** product config.
- The report records a deterministic fingerprint:
  `c0faaa46a9d8a9fcb99ebd013a23a792a9b43d2dcfb6c734513042cdcae379df`. Two independent full
  runs produced the same fingerprint. The fingerprint excludes only the timing/RSS block.
- The committed report `data/reports/wyscout_p0_feasibility.json` (47 KB) contains only
  aggregate counts plus match and team identifiers. It has **no player IDs or names**.
- The per-player detail file stays in gitignored `data/raw/wyscout/` for reviewer
  spot-checks.
- Raw archives are never committed.

---

## 5. Schema, identity, positions and minutes (G1)

### Identity and DOB
- `players.json` has 3,603 records and 0 duplicate `wyId`s. There are 0 name+DOB
  collisions between distinct IDs.
- **All 2,570 unique players who appeared in a domestic match have a parseable DOB.**
- 1,152 names contain literal `\uXXXX` escape text, e.g. `M\u00fcnchen`. Any display would
  need a decoding step. This is an encoding defect in the source, not an identity
  conflict.
- Transfers: 124 players appear for more than one domestic club and 50 in more than one
  league. Each is counted once globally, with league membership shown separately.

### Positions — the blocking finding
- The only position field anywhere in the release is `players.json` → `role`, with 4
  values: GK 426, DF 1,200, MD 1,257, FW 720.
- The source describes it as *"the main role of the player"*, recorded alongside
  `currentTeamId`. It is therefore a **coarse, current** label, not a dated 2017/18
  position.
- Match `lineup` and `bench` rows carry only `playerId`, goals, own goals and cards. They
  have **no position and no shirt/formation slot**, even though every team-match has
  `hasFormation = 1`.
- ScoutBoy roles need `eligible_positions` such as CM/DM/AM/CAM/CF/ST/LW/RW. Under the
  plan these cannot be defensibly derived. The only paths would be (a) mapping every
  MD→CM or FW→ST, which the plan forbids, or (b) inventing a new position-inference model
  from event locations. Option (b) is a **material design change**. It needs planner and
  owner authorization and was not done here.

### Match, roster and event integrity
| League | Matches (S1) | Events (S1) | Unique fixture pairs | Matches accepted for covered minutes | Excluded, and why |
| --- | --- | --- | --- | --- | --- |
| England | 380 (380) | 643,150 (643,150) | 380/380 | 379 | 1: `2499781` Chelsea–Man City 0–1 has no goal-tagged event (event goals 0 vs score 1) |
| Spain | 380 (380) | 628,659 (628,659) | 380/380 | 380 | — |
| Italy | 380 (380) | 647,372 (647,372) | 380/380 | 380 | Match kept. 8 substitutions reference player ID 0 in `2575959`, `2575965`, `2576016`, so 34 affected appearances are excluded from covered minutes rather than guessed |
| Germany | 306 (306) | 519,407 (519,407) | 306/306 | 306 | — |
| France | 380 (380) | 632,807 (632,807) | 380/380 | 380 | — |
| **Total** | **1,826** | **3,071,395** | complete | **1,825** | |

Further integrity findings:

- There are 0 duplicate match IDs and 0 duplicate event IDs across the whole domestic
  union (the event ID ranges of different leagues interleave, so this was checked
  globally).
- Every event's `matchId` exists in the matches file, confirmed by the independent
  verifier.
- 226,038 events (7.4%) have `playerId = 0`. Most are "ball out of field" interruptions
  (129,154), but there are also 83,200 duels. These count toward nobody.
- Goal reconciliation: goal-tagged non-save events plus own goals equal the published
  score in 1,825/1,826 matches.
- The roster `goals` field disagrees with the score in 146 matches, and the roster
  `ownGoals` field holds values such as "2" in 7,053 rows. **Neither roster field is
  trustworthy. Event tags are used instead.**

### Minutes reconstruction
- Rule used, as a P0 hypothesis: starters come on at 0'; substitution and red-card
  minutes come from the roster; intervals are clipped to 0–90.
- Result: team exposure equals 11 × 90 minus the minutes lost to dismissals **in every
  valid team-match**, i.e. all but the 3 Italian matches above.
- Covered minutes exclude two things: (a) unaccepted matches, and (b) player-matches whose
  attributed events fall more than 2 minutes outside the reconstructed interval. Case (b)
  covers 28 appearances and 1,891 minutes across the five leagues.
- Stoppage time: the roster clock stops at 90. Crediting 2nd-half stoppage literally would
  add 146,584 minutes, **+4.1%**. This is a P1 policy choice; P0 uses the conservative
  regulation clock.
- Per-league minute funnels are in the JSON report (`player_match_funnel`).

### Coordinates and tags
- Positions use a 0–100 scale in the acting team's attacking direction. Orientation is
  confirmed by the mean shot start x of 84.8.
- `(0,0)` and `(100,100)` are **placeholders for unrecorded locations**. **Every** shot
  (40,461) has a placeholder end point, and every goal kick in the Germany probe (4,847)
  has a placeholder start.
- The analysis therefore excludes placeholder points from all geometry. Only 317 completed
  passes lost geometry this way.
- Consequence: **shot end location is not available**, which removes one input a future
  xG model might want.
- Duels are often recorded once per team at the same timestamp: 105,361 of 720,760 duel
  timestamps have both teams. P1 must validate paired-duel handling before counting duel
  percentages as equivalent to StatsBomb.

---

## 6. G2 funnel — unique players across the five leagues

The funnel applies the plan's population rules. Each number is the count still in after
that step. Age means whole-year age ≤23 on 2018-06-30.

| Step | Unique players |
| --- | --- |
| Rostered in a domestic match | 3,011 |
| Appeared (started or came on) | 2,570 |
| Identity resolved | 2,570 |
| DOB known | 2,570 |
| Age ≤ 23 at 2018-06-30 | 780 |
| Coarse ATT (FW) or MID (MD) | 514 |
| ≥ 450 season minutes | 288 |
| **≥ 450 season AND event-covered minutes** | **288** (ATT 105, MID 183) |
| Granular historical position known | **0** |
| Eligible role with ≥ 70% *validated* required metrics | **0** |
| **Strict G2 count (target ≥ 100)** | **0 — NOT MET** |

Per-league membership at the ≥450-covered step: England 46, France 76, Germany 64,
Italy 54, Spain 56. These sum to 296 because of transfers; unique is 288.

**Diagnostic upper bound (not a G2 pass): 183.** This counts players who meet all four
conditions below.

- Coarse group matches the role's group.
- All required metrics are in a *candidate* state and non-null.
- Minutes and age pass.
- The requirement for a granular position is ignored.

Only Deep-Lying Playmaker and Tempo Controller have any such players: 183 each, the same
183 coarse midfielders. Forward roles contribute 0 because each needs xG, pressures, box
touches or carries.

Peer-pool sizes are healthy. Every candidate metric has ≥ 400 players per coarse group at
≥450 covered minutes, all ages (ATT 401, MID 705, DEF 703). The exception is take-on
percentage for goalkeepers.

**Boundary behaviour is tested.** A synthetic end-to-end golden test checks each of these
cases:

- 450 minutes → included; 449 minutes → excluded.
- A birthday of 1994-06-30 → age 24 on the reference date, excluded.
- A birthday of 1994-07-01 → age 23, included.
- A coarse FW is counted as ATT for the funnel but never as granular ST.

---

## 7. Metric states and the nine-role matrix (G3 input)

**Metric states** follow the plan's contract. No metric is validated yet, because that
promotion is P1 review work.

- **Observed candidate:** passes, pass completion %, key passes, through balls, crosses,
  shots, successful take-ons, take-on %, interceptions, ground-duel %, aerial-duel %,
  fouls.
- **Derived candidate:** progressive passes, passes into the final third, and long passes
  completed. These reuse the StatsBomb v1 geometry after rescaling 0–100 to 120×80. The
  long-pass threshold of 35 is a hypothesis.
- **Experimental (excluded):** tackles (defensive duels ≠ tackles), defensive actions,
  dispossessed, miscontrols, touches in box (an on-ball event proxy).
- **Unavailable (null, never zero):** xG, xA, goals−xG, progressive carries, carries into
  the final third/box, shot-creating actions, **pressures**, counterpressures, passes under
  pressure, availability.

| Role | Required metrics | Required present (upper bound) | ≥70%? | Weighted support (upper bound) | Missing required | Granular position available |
| --- | --- | --- | --- | --- | --- | --- |
| deep_lying_playmaker | progressive passes, passes into final third, pass completion % | 3/3 = 100% | yes (candidate) | 0.64 | — | no (needs DM/CM) |
| tempo_controller | passes, pass completion %, progressive passes | 3/3 = 100% | yes (candidate) | 0.60 | — | no (needs CM/DM) |
| ball_winning_midfielder | tackles, interceptions, ground-duel % | 2/3 = 66.7% | **no** | 0.375 | tackles (experimental) | no |
| touchline_winger | take-ons, progressive carries, carries into final third | 1/3 | no | 0.50 | carries ×2 (unavailable) | no |
| advanced_8 | progressive carries, passes into final third, xA | 1/3 | no | 0.31 | carries, xA | no |
| complete_forward | npxG, touches in box, progressive passes | 1/3 | no | 0.225 | npxG, box touches | no |
| inside_forward | npxG, shots, touches in box | 1/3 | no | 0.10 | npxG, box touches | no |
| shadow_striker | touches in box, npxG, shots | 1/3 | no | 0.15 | npxG, box touches | no |
| pressing_forward | pressures, npxG, touches in box | 0/3 | no | 0.25 | all three | no — **stays unavailable** |

Under *strict* rules, i.e. validated metrics only, every role has 0% required and 0.0
weighted support.

Even the two candidate roles lose defining groups: press resistance, availability, and
for Tempo Controller also possession security and defensive coverage. Their meaning would
need a capability-aware explanation. Before/after numbers are in `roles` in the JSON
report.

**Compared with current RoleFit expectations:** today's roles assume StatsBomb-style
pressure, carry and xG evidence. On a no-market, core-metric Wyscout path, at most the two
passing-midfield roles could keep their required set. All forward and wide roles would be
withheld, as the plan already anticipates. Five of the nine roles also need xG or carries,
which only the optional PX experiments could supply.

---

## 8. Sample, spot-checks and resources

**Pinned sample.** Rule: the earliest, middle and latest *played* match by `dateutc` in
each league, with ties broken by provider match ID.

| League | Earliest | Middle | Latest |
| --- | --- | --- | --- |
| England | 2499719 | 2499903 | 2500098 |
| France | 2500691 | 2500875 | 2501065 |
| Germany | 2516739 | 2516884 | 2517044 |
| Italy | 2575964 | 2576153 | 2576336 |
| Spain | 2565557 | 2565739 | 2565922 |

**Edge-category representatives.** The first match by date then ID in each category.
Counts in brackets are matches with that feature.

| Category | Match ID | Matches with feature |
| --- | --- | --- |
| Substitution / unused bench / player-0 events | 2500691 | 1,826 each |
| Dismissal | 2499721 | 297 |
| Halftime substitution | 2500693 | 546 |
| Stoppage-time substitution | 2516843 | 179 |
| Own goal | 2499722 | 146 |
| Event-clock conflict | 2516750 | 26 |
| Event goals ≠ score | 2499781 | 1 |
| Roster ID absent from players.json | 2500832 | 22 |
| Transfers | per-player, in the gitignored detail file | 124 players |

The categories were exercised on real data and also covered by synthetic golden tests.
Categories only in synthetic tests: missing formation (none exists in this release) and
zero-attempt denominators. Synthetic fixtures do not prove real-source completeness.

**Independent checks** (separate code paths from the analysis script):

1. `verify_counts.py` re-hashes all 7 files and re-counts events per league by regex over
   raw bytes, without a JSON parser. It checks the counts against S1 and against the
   report, and checks event match IDs against match IDs. **All checks match; exit 0.**
2. A scratch spot-check re-counted passes, completed passes and non-penalty shots for all
   30 team-rows of the 15 pinned matches.
   - **29/30 were identical.**
   - The one difference is Italy `2576336`, team 3158. It is fully explained by policy:
     player 3475 was substituted at 77' but has events until 79.2'. That is beyond the
     2-minute tolerance, so his whole appearance is excluded from covered data.
   - His 38 passes, 28 completed and 3 shots are exactly the delta. Covered minutes for
     that team are 913 = 990 − 77.

**Resources** (host Linux, 7.8 GiB RAM; project venv Python 3.13.5):

| Step | Wall time | Peak RSS | Disk |
| --- | --- | --- | --- |
| Download + verify all 7 files | ≈ 11 s | — | 79.7 MB (compressed archives; never extracted to disk) |
| Full five-league streaming scan | 34.4 s / 35.4 s (two runs) | 247.8 MB / 262.5 MB | reads zips in place |
| Per league | 5.7–7.4 s | 165–209 MB | — |
| Independent count verifier | not timed (single run, exit 0) | not measured | — |

**Recommended owner-approved ceilings for future P1–P4 read/scan work:**

- **1 GiB RSS**, about 4× the measured peak.
- **5 minutes** for a full-scan wall time, about 8× measured.
- **500 MB** raw-data disk.

Database import cost (P4) is not measured here.

---

## 9. Decision for Aditya

The plan's rule is to never lower thresholds just to get a pass. Therefore **P1 should not
start as written**. Choose one:

| Option | What it means | Effort / risk | Who acts next |
| --- | --- | --- | --- |
| **A. Stop (recommended if the full nine-role product is required)** | Keep the StatsBomb pilot as the real-data showcase. Archive this report as evidence. | None | Nobody |
| **B. Reduced-role portfolio** | Relax the plan's position rule for **two roles only** (Deep-Lying Playmaker, Tempo Controller), using the coarse "Midfielder" label with a visible limitation. Validate the three passing metrics in P1. No market. Ceiling of 183 U23 players, not yet validated. | Moderate. Changes the plan's G1/G2 design, so it needs your sign-off and a planner revision | Planner revises the plan; then P1 |
| **C. Research position inference first** | Commission a separately reviewed model to infer granular positions from event locations, plus the optional xG/carry experiments (PX), before deciding scope | Highest effort and uncertain. New model architecture | Planner designs a PX slice |
| **D. Different source** | Find a free historical source with per-match positions | Unknown; may conflict with the zero-purchase constraint | Owner/planner research |

Whatever you choose:

- Public display still needs the rights and personal-data decision in §3.
- Market data stays unavailable.

---

## 10. Exclusions and uncertainty

- **Not validated:** no metric has been checked against video or StatsBomb semantics.
  Candidate states are hypotheses.
- **The upper bound of 183 is optimistic.** It assumes coarse MD players are
  playmaker-eligible and that all three passing metrics survive validation.
- **Also excluded:** International competitions (World Cup 2018, Euro 2016) are in the
  archives but outside the domestic scope; they were not analysed.
- **Also not claimed:** no claim that any public display, market, deployment, P1 contract
  or StatsBomb-equivalent metric is approved.
