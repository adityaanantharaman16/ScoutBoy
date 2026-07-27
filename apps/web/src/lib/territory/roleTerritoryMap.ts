// PRESENTATION-ONLY illustration placement — NOT rating configuration.
//
// This module decides *where on an illustrative pitch* an already-computed
// RoleFit audit group score is drawn. It has ZERO effect on any RoleFit score,
// group weight, normalization, ranking, or confidence. It never reads
// configs/roles/*.yaml and must never be mistaken for it. Renaming a territory
// here changes only illustration placement, never analysis.
//
// Groups whose meaning is not defensibly spatial (e.g. possession security,
// finishing confidence, shot volume, aerial ability, generic duels, chance
// creation) map to `null`. Null / unmapped groups are shown ONLY in the
// supporting-evidence list and are never forced onto a pitch territory.

import { titleCase } from "@/lib/formatters";

/** Abstract, illustrative pitch zones. Not tracking coordinates. */
export type TerritoryId = "att_box" | "att_third" | "mid_third" | "def_third";

export interface TerritoryMeta {
  id: TerritoryId;
  label: string;
  /**
   * Vertical band on the drawn illustrative pitch as a fraction of pitch height,
   * where 0 is the top (opponent goal / attacking end) and 1 is the bottom
   * (own goal / defensive end). Used only to place the illustration; it is not
   * a measured position.
   */
  band: [number, number];
}

/** Ordered opponent-goal-first (top of the drawn pitch) → own-goal-last. */
export const TERRITORIES: readonly TerritoryMeta[] = [
  { id: "att_box", label: "Attacking penalty box", band: [0.0, 0.16] },
  { id: "att_third", label: "Attacking third", band: [0.16, 0.42] },
  { id: "mid_third", label: "Middle third", band: [0.42, 0.72] },
  { id: "def_third", label: "Defensive third", band: [0.72, 1.0] },
];

const TERRITORY_BY_ID: Record<TerritoryId, TerritoryMeta> = Object.fromEntries(
  TERRITORIES.map((t) => [t.id, t]),
) as Record<TerritoryId, TerritoryMeta>;

export function territoryMeta(id: TerritoryId): TerritoryMeta {
  return TERRITORY_BY_ID[id];
}

// Audit group key -> abstract territory, or null when the concept is not
// defensibly spatial. A group may legitimately map to a single territory; where
// a concept spans a region we pick the most representative band and document it.
const GROUP_TERRITORY: Readonly<Record<string, TerritoryId | null>> = {
  // --- clearly spatial: near the opponent goal / penalty box ---
  box_presence: "att_box", // occupying dangerous central areas in the box
  box_threat: "att_box",
  arrival_carrying: "att_box", // carrying to arrive late in the box
  // --- clearly spatial: attacking third ---
  shot_threat: "att_third", // shot locations are in/around the final third
  central_entries: "att_third", // entering the final third centrally
  pressing: "att_third", // forwards press high, in the attacking third
  pressing_volume: "att_third",
  // --- clearly spatial: middle third ---
  progression: "mid_third", // moving the ball upfield through midfield
  transition_carrying: "mid_third",
  // --- clearly spatial: defensive third / own half ---
  defensive_work: "def_third",
  defensive_contribution: "def_third",

  // --- explicitly NON-spatial or spatially ambiguous → supporting list only ---
  possession_security: null, // ball retention is not a location
  finishing_confidence: null, // a finishing-quality signal, not a place
  shot_volume: null, // a count, not a location
  creation: null, // chance creation via passing has no single location
  shot_creation: null,
  duels: null, // duels occur across the whole pitch
  aerial_hold_up: null, // aerial ability / hold-up is not a location
};

/**
 * Presentation-only lookup. Returns the abstract territory for a group key, or
 * null when the group is non-spatial / ambiguous / unmapped. Unmapped keys
 * (e.g. a future role's new group) safely return null so they fall through to
 * the supporting-evidence list rather than being silently dropped or guessed
 * onto the pitch.
 */
export function territoryForGroup(groupKey: string): TerritoryId | null {
  return Object.prototype.hasOwnProperty.call(GROUP_TERRITORY, groupKey)
    ? GROUP_TERRITORY[groupKey]
    : null;
}

// Short, human labels for pitch markers so a marker reads as an idea, not a bare
// number. Presentation only; unmapped keys fall back to a title-cased key.
const SHORT_LABELS: Readonly<Record<string, string>> = {
  box_presence: "Box presence",
  box_threat: "Box threat",
  arrival_carrying: "Box arrivals",
  shot_threat: "Shot threat",
  central_entries: "Central entries",
  pressing: "High press",
  pressing_volume: "Press volume",
  progression: "Progression",
  transition_carrying: "Transition",
  defensive_work: "Defensive work",
  defensive_contribution: "Defending",
};

export function groupShortLabel(groupKey: string): string {
  return SHORT_LABELS[groupKey] ?? titleCase(groupKey);
}
