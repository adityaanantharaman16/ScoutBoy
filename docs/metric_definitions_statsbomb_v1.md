# StatsBomb → canonical metric definitions (v1)

How ScoutBoy derives its canonical player-season metrics from StatsBomb Open Data events,
for the pilot **U23 Bundesliga 2023/24**. Every definition is deterministic and documented so
ratings are reproducible. **Missing ⇒ null, never zero.** We never import a third-party overall
rating — only primitive events → our own metrics.

## Pitch frame & constants
- StatsBomb pitch is **120 (length, x) × 80 (width, y)**; events are oriented so the acting team
  attacks toward **x = 120** (goal at `(120, 40)`).
- **Final third:** `x ≥ 80`.
- **Penalty area:** `x ≥ 102` and `18 ≤ y ≤ 62`.
- `dist_to_goal(p) = hypot(120 − x, 40 − y)`.
- Thresholds (documented, conservative): **progressive pass** = completed pass with
  `dist_to_goal(start) − dist_to_goal(end) ≥ 10` yards and end in the opponent half (`x ≥ 60`);
  **progressive carry** = carry with the same distance gain `≥ 5` yards and end `x ≥ 60`.

## Minutes (the per-90 denominator)
StatsBomb `lineup.positions` is frequently empty in Open Data, so minutes are computed from
events, per match:
- **Full-time minute (FT)** = the `minute` of the final `Half End` event (period 2, or latest
  period played).
- **Starters** (from the two `Starting XI` events' `tactics.lineup`) are on from minute 0.
- **Substitutions** (`type = Substitution`): the `player` leaves at that event's `minute`; the
  `substitution.replacement` enters at that minute.
- **Red cards** (`Foul Committed.card` or `Bad Behaviour.card` = Red/Second Yellow): player off
  at the card minute.
- A player's match minutes = Σ (off − on) across on-pitch intervals, clamped to `[0, FT]`.
- These StatsBomb minutes are the denominator for StatsBomb metrics (they match the covered
  matches). They are compared to Transfermarkt league minutes and material gaps are reported
  (minutes-reconciliation report), not silently reconciled.

## Attacking
| Canonical metric | Definition |
| --- | --- |
| `non_penalty_goals_per90` | `Shot.outcome = Goal` and `Shot.type ≠ Penalty`. |
| `non_penalty_xg_per90` | Σ `Shot.statsbomb_xg` where `Shot.type ≠ Penalty`. |
| `shots_per90` | Non-penalty `Shot` events. |
| `shots_on_target_pct` | on-target `Shot` (`outcome ∈ {Goal, Saved, Saved To Post}`) / non-penalty shots (minutes-independent ratio; aggregated as Σon-target/Σshots). |
| `touches_in_box_per90` | Events of type `{Pass, Ball Receipt*, Carry, Shot, Dribble}` with `location` in the penalty area. |
| `goals_minus_xg_per90` | `non_penalty_goals − non_penalty_xg` (may be negative — legitimately). |

## Creation
| Canonical metric | Definition |
| --- | --- |
| `assists_per90` | `Pass.goal_assist = true`. |
| `xa_per90` | Σ `statsbomb_xg` of the shot each of the player's key passes created (`Shot.key_pass_id` → assisting pass's player). |
| `key_passes_per90` | `Pass.shot_assist = true` or `Pass.goal_assist = true`. |
| `shot_creating_actions_per90` | For each `Shot`, credit the players of up to the **2** preceding offensive actions (`Pass`/`Carry`/`Dribble`) in the same `possession`. |
| `passes_into_final_third_per90` | Completed pass, `start.x < 80` and `end.x ≥ 80`. |
| `passes_into_penalty_area_per90` | Completed pass ending in the penalty area, starting outside it. |
| `through_balls_per90` | `Pass.technique = Through Ball`. |
| `crosses_per90` | `Pass.cross = true`. |

## Progression
| Canonical metric | Definition |
| --- | --- |
| `progressive_passes_per90` | Completed pass meeting the progressive-pass threshold above. |
| `progressive_carries_per90` | `Carry` meeting the progressive-carry threshold above. |
| `carries_into_final_third_per90` | `Carry` `start.x < 80`, `end.x ≥ 80`. |
| `carries_into_penalty_area_per90` | `Carry` ending in the penalty area, starting outside it. |
| `successful_take_ons_per90` | `Dribble.outcome = Complete`. |
| `take_on_success_pct` | complete dribbles / all dribbles (Σ/Σ). |

## Possession / security
| Canonical metric | Definition |
| --- | --- |
| `passes_per90` | All `Pass` events attempted. |
| `pass_completion_pct` | completed passes / attempted (Σ/Σ; a pass is completed when it has no `pass.outcome`). |
| `passes_under_pressure_per90` | `Pass.under_pressure = true`. |
| `miscontrols_per90` | `Miscontrol` events. |
| `dispossessed_per90` | `Dispossessed` events. |
| `turnovers_per90` | `miscontrols + dispossessed`. |

## Defending / pressing
| Canonical metric | Definition |
| --- | --- |
| `pressures_per90` | `Pressure` events. |
| `counterpressures_per90` | events with `counterpress = true`. |
| `tackles_per90` | `Duel.type = Tackle`. |
| `interceptions_per90` | `Interception` events (`outcome ≠ Lost*`). |
| `blocks_per90` | `Block` events. |
| `ball_recoveries_per90` | `Ball Recovery` (excluding `recovery_failure = true`). |
| `defensive_actions_per90` | `tackles + interceptions + blocks + ball_recoveries + Clearance`. |
| `ground_duels_won_pct` | won ground duels / ground duels (`Duel` type Tackle/50-50; won when `outcome ∈ {Won, Success, Success In Play, Success Out}`). |
| `aerial_duels_won_pct` | `aerial_won = true` events / (`aerial_won` + `Duel.type = Aerial Lost`). |
| `fouls_per90` | `Foul Committed` events. |

## Aggregation rules (season)
- Sum event **counts** across a player's covered matches first; store counts, then convert to
  per-90 using **Σ minutes** (`count × 90 / minutes`).
- Percentages are **event-weighted** (Σnumerator / Σdenominator across matches), never a mean of
  per-match percentages.
- Each immutable event file is processed once; event IDs remain available in the pinned source
  snapshot for audit and duplicate investigation.
- Any metric with zero denominator (e.g. no dribbles) ⇒ **null**, not zero.

## Provenance & scope
- Every derived metric row carries `metric_provider = statsbomb`, `scope = covered_matches`
  (the 34-match Open Data subset — **not** full-league), the season, and the snapshot id.
- Attribution: “Data provided by StatsBomb Open Data.” See the snapshot manifest for license.
