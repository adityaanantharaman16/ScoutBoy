# Milestone 6 — RoleFit Calibration & Model Evaluation

## What "calibration" means in ScoutBoy

Calibration in ScoutBoy is **not** tuning the model until it produces a preferred answer, and it
is **not** a claim that ScoutBoy computes objective scouting truth. It is a versioned,
reproducible way to ask whether the *existing* RoleFit engine behaves credibly:

- Does a benchmarked profile rank highest in its expected role?
- Do expected playstyles and concerns appear **only** when the evidence supports them?
- Are context, sample-size, and missing-data effects directionally sane and **bounded**?
- Are configuration changes intentional, explainable, and regression-tested?
- Is insufficient evidence reported as `inconclusive`, rather than a pass or a failure?

The evaluation package **reuses the production scoring engine verbatim** (`rolefit`), through the
same path the recompute job uses: `normalize_metrics` → `percentile_ranks` → `build_context` →
`compute_role_rating` → `compute_playstyles` → `build_audit`. It never re-implements the formula
and never introduces a second scoring engine, machine learning, or auto-tuning.

## The four honest outcomes

| Status | Meaning |
| --- | --- |
| `pass` | The expectation is satisfied. |
| `warn` | The result is borderline or only partially supported (e.g. an exact tie, or a playstyle applied below its expected tier). |
| `fail` | **Sufficient evidence contradicts** the benchmark expectation. |
| `inconclusive` | Evidence is unavailable or insufficient to decide (the default for pilot benchmarks with no local data). |

`inconclusive` is never silently treated as a pass or a fail. Each result carries an operational
**gate**: an `inconclusive` outcome that is *not* `inconclusive_allowed` (and any scenario
`inconclusive`) sets `gate_passed: false` and appears in `blocking` — so an **unexpected**
inconclusive can never produce a green calibration gate, yet it is never mislabeled as an
evidentiary `fail`. Pilot benchmarks set `inconclusive_allowed: true` so a missing real-data pilot
stays non-blocking and can never fail CI. `make calibration-evaluate-fixtures --fail-on-fail`
(and the CLI) key their exit code off `gate_passed`, not off `fail` alone.

## Strict, versioned contract (what the loader rejects)

The contract is parsed through an explicit strict schema (`contract.py`). It rejects, with a
single `ContractError` (never an incidental `KeyError`/`TypeError`): unknown fields at any level;
missing required suite/benchmark/scenario/expectation/parameter fields; invalid enums (kind,
evidence level, confidence level, translation risk, playstyle tier, scenario dimension); duplicate
benchmark/scenario ids; empty or self-referential role-ordering; invalid kind/evidence
combinations; fixture benchmarks without a committed fixture; pilot benchmarks without stable
`source_ids`, `season_label`, or `inconclusive_allowed: true`; unknown scenario types; and missing
or wrong-typed scenario parameters. A contract `rating_version` that does not equal the production
`RATING_VERSION` is rejected, so contract and engine cannot silently diverge. This full
cross-validation (including role/playstyle/concern/fixture references) runs **automatically**
inside both `evaluate_fixtures()` and `evaluate_pilot()` — it does not depend on a test calling a
validation method.

## Milestone 6 audit corrections

Three behaviors were corrected so runtime matches the documented claims:

1. **Audit reuse.** Fixture evaluation now calls the production `rolefit.build_audit()` for every
   `RoleRatingResult` and carries its deterministic output through each `role_scores` entry — the
   evaluation package recreates no metric/context/confidence/penalty/explanation audit logic.
2. **Numerically bounded context scenarios.** `context_ordering` scenarios declare a `dimension`
   and an explicit, reviewable `max_ratio`. Each scenario **fails** if the ordering is reversed,
   if production is erased (`lo.final ≤ 0`), if either combined multiplier falls outside the
   config-derived band, or if the combined-multiplier ratio exceeds `max_ratio`. Boundedness is
   asserted numerically, not by searching explanatory text.
3. **Form-bonus gating.** The recent-form bonus now honors the production context config's
   `form_bonus.requires_confidence` floor (default `medium`) inside `form_bonus_points`: **zero**
   below the floor (e.g. a 200-minute → *low*-confidence sample), positive and capped at
   `max_points` at/above it. *Before:* a low-confidence sample received a halved (non-zero) bonus,
   contradicting the config and the calibration report. *After:* below-floor samples receive
   exactly zero. No role weights changed.

## Rating version: rolefit-v1 → rolefit-v2

The form-gating fix (correction 3) changes **observable** RoleFit output for any player whose
recent-form bonus previously came from a below-floor sample, so it ships under a new production
identifier `RATING_VERSION = "rolefit-v2"` — v1 and v2 scoring semantics can never be reported
under the same version. What changed and what did not:

- **Bumped:** `rolefit.RATING_VERSION`, the calibration contract's target `rating_version`, the
  committed calibration baseline + benchmark snapshot metadata, and every doc/test/UI reference to
  the *current* production version. The calibration **suite** version (`suite.version: v1`,
  `CALIBRATION_VERSION`) is deliberately **left at v1** — it versions the calibration schema, not
  the rating engine.
- **Unchanged:** role weights, `PLAYSTYLE_VERSION`, `MARKET_VERSION`, and the synthetic
  fixture/benchmark *scores* — every committed fixture and snapshot player has ≥ medium sample
  confidence, so the gating change moved no committed score. The baseline/snapshot diffs are the
  version string plus the calibration contract hash (from the added scenario bound params); no
  role score changed.
- **Stored v1 ratings are no longer current evidence.** Recompute persists ratings under the
  current `RATING_VERSION`, and pilot evaluation only reads current-version ratings. Until
  `make recompute-ratings` produces v2 ratings + audits, real-pilot benchmarks return
  `inconclusive` — which is correct and evidence-honest, not a failure. No migration rewrites
  historical rows; the established recomputation path produces v2 cleanly.

## Read-only pilot completeness

Before a pilot `pass`/`fail`, the read-only evaluator resolves the player (by stable
`PlayerSourceId` provenance, never fuzzy names) and season deterministically, derives the player's
eligible roles from the production role configs + primary position, and requires **complete
current-version `RoleRating` coverage of those eligible roles plus their `RatingAudit` evidence**.
Any missing identity, season, eligible-role coverage, current-version rating, or audit returns
`inconclusive` with a bounded, non-sensitive reason. Missing ratings are never inferred as zero and
nothing is ever written. Tests inject isolated fixture-backed databases (never the developer's
local DB) to exercise the absent / partial-coverage / missing-audit / complete pass+fail paths.

## Where things live

```
configs/calibration/rolefit_calibration_v1.yaml   # the versioned contract (expectations)
configs/calibration/fixtures_v1.yaml              # committed synthetic fixtures (raw metrics)
packages/rating_engine/evaluation/                # the evaluation package
  contract.py            # load + strictly validate the contract
  fixtures.py            # load fixtures, build percentiles, score via the production engine
  evaluator.py           # per-benchmark + guardrail-scenario verdicts, suite totals
  database_evaluator.py  # read-only pilot evaluation (inconclusive when data absent)
  reporting.py           # deterministic JSON + Markdown reports
  __main__.py            # CLI: python -m evaluation {fixtures|pilot|all}
packages/rating_engine/tests/test_calibration.py       # tests
packages/rating_engine/tests/calibration_baseline.json # regression baseline snapshot
```

## Benchmark evidence levels

Every benchmark declares an `evidence_level`:

- `fixture` — a committed, deterministic synthetic profile. Validates engine behavior and
  internal consistency, **not** real-world scouting accuracy.
- `reviewed` — a fixture whose expectations were reviewed against domain judgement.
- `illustrative` — a documentation example, not a hard gate.
- `pilot` — a real player from the Bayer Leverkusen-centered StatsBomb Open Data slice, resolved
  read-only through stable source-id provenance.

## Running the evaluations

```bash
make calibration-evaluate-fixtures   # deterministic; NO DB writes, NO network
make calibration-evaluate-pilot      # read-only real-pilot evaluation
make calibration-evaluate            # both; writes data/reports/calibration_report.md
```

Or directly:

```bash
python -m evaluation fixtures --format json
python -m evaluation pilot --format markdown
python -m evaluation all --fail-on-fail        # exit non-zero only on a real FAIL
```

Fixture evaluation is **byte-stable**: two runs produce identical JSON (no timestamps, hostnames,
or run ids). That is what lets calibration act as a regression gate.

## The fixtures (controlled synthetic profiles — not real footballers)

Percentiles are earned the same way production earns them: each fixture player is percentiled
against a committed **reference cohort** (role-eligible population per role, position-group
population for playstyles). The suite covers:

| Benchmark | Expected primary role |
| --- | --- |
| `wide_carrier_touchline_winger` | Touchline Winger |
| `goal_first_inside_forward` | Inside Forward |
| `progressive_deep_lying_playmaker` | Deep-Lying Playmaker |
| `two_way_advanced_8` | Advanced 8 |
| `ball_winner_bwm` | Ball-Winning Midfielder |
| `low_minute_high_output` | stays low confidence + small-sample concern |
| `lower_league_high_production` | visible production + medium translation risk |
| `stronger_league_lower_volume` | stronger reliability, low translation risk |
| `missing_required_metric` | Inside Forward confidence collapses to low/unknown |

Guardrail **scenarios** cover: league / team / stakes ordering (bounded, non-erasing),
minutes→confidence monotonicity, recent-form confidence gating, confidence bounds `[0,1]`,
playstyle tier thresholds (base/plus/elite), concern trigger boundaries, and deterministic
ordering.

## Adding a benchmark or scenario

**Fixture benchmark:**
1. Add the player's raw per-90 metrics + context to `configs/calibration/fixtures_v1.yaml`
   (under `benchmarks:`), or extend a `reference_cohorts` group.
2. Add the expectation to `configs/calibration/rolefit_calibration_v1.yaml` under `benchmarks:`
   with `kind: fixture`. Prefer role **order**, **confidence**, and **playstyle/concern
   presence** — do not encode magical absolute scores.
3. Run `make calibration-evaluate-fixtures` and confirm the new benchmark passes.
4. Regenerate the baseline (below) and run `make test-py`.

**Pilot benchmark:** add an entry with `kind: pilot`, `source_ids` (stable source name +
external id — never a fuzzy name), a `season_label`, and `inconclusive_allowed: true`. It will
resolve read-only when the pilot data is present and return `inconclusive` otherwise.

**Scenario:** add an entry under `scenarios:` with a `type` handled in `evaluator.py`
(`_SCENARIO_HANDLERS`). A contract test asserts every scenario type has a handler.

## How score / config changes are reviewed

`packages/rating_engine/tests/calibration_baseline.json` pins, for each benchmark, the primary
role, per-role final scores, and status — plus every config hash. The test
`test_matches_committed_baseline` fails if:

- any config hash changes (role weights, context, playstyles, fixtures, or contract), **or**
- a benchmark's primary role / status changes, or a role score moves more than `0.2`.

So **any** intentional change to weights or fixtures forces a deliberate baseline regeneration
and a documented rationale — silent tuning is impossible. To regenerate after an intentional
change:

```bash
python - <<'PY'
import json
from evaluation.evaluator import evaluate_fixtures
r = evaluate_fixtures()
baseline = {
    "note": "Baseline RoleFit calibration snapshot. Regenerate ONLY for an intentional, "
            "documented config/formula change.",
    "calibration_version": r["calibration_version"], "contract_version": r["contract_version"],
    "rating_version": r["rating_version"], "config_hashes": r["config_hashes"],
    "benchmarks": {b["benchmark_id"]: {"status": b["status"], "primary_role": b["actual_primary_role"],
        "role_scores": {rs["role_key"]: rs["final_score"] for rs in b["role_scores"]}}
        for b in r["benchmarks"]},
    "scenarios": {s["scenario_id"]: s["status"] for s in r["scenarios"]},
}
open("packages/rating_engine/tests/calibration_baseline.json","w").write(json.dumps(baseline, indent=2, sort_keys=True)+"\n")
PY
```

## Baseline result (this milestone)

Calibration established a **baseline against the current, unchanged RoleFit configuration**. No
role weights were changed: every fixture benchmark and every guardrail scenario passes as shipped
(9/9 benchmarks, 9/9 scenarios), so there was no defensible, evidence-backed reason to tune
weights. This is a baseline, not a claim of an optimal final model.

**Baseline impact of the Milestone 6 audit repairs.** The committed baseline
(`calibration_baseline.json`) was regenerated for exactly two deliberate reasons: (1) the target
`rating_version` moved `rolefit-v1` → `rolefit-v2` with the form-gating correction, and (2) the
contract config-hash changed when the `context_ordering` scenarios gained explicit
`dimension` / `max_ratio` bound parameters (and the form scenario's description was corrected).
Every other config hash (roles, context, playstyles, fixtures), every benchmark primary role and
score, and every scenario status are **identical** to the previous baseline. The form-gating
correction changed no committed fixture/pilot score (all such players have ≥ medium sample
confidence), and no role weight was touched.

## Why the current real-data pilot cannot validate the whole ecosystem

The pilot is a **Bayer Leverkusen-centered StatsBomb Open Data slice** (34 matches, 2023/24). It
can spot-check that a handful of real players rate sanely, but it cannot validate full Bundesliga,
European, or global coverage. Every pilot report says so. Pilot benchmarks are read-only and
resolve players only through reviewed stable source ids
(`configs/identity/statsbomb_transfermarkt_overrides_v1.yaml`).

## Remaining limitations & recommended next milestone

- Fixtures validate engine *behavior and internal consistency*, not real-world accuracy.
- The pilot is a narrow slice; broad accuracy remains unproven.
- Recommended next milestone: **broader licensed/open performance coverage** so calibration can
  move from fixture-and-slice evidence toward genuine multi-league validation — still without a
  universal overall rating, black-box ML, or auto-tuning.
