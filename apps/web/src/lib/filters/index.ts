// Discovery filter semantics: the age-threshold control and the bounded numeric
// thresholds. Everything here is pure, so the rail, the URL hydration in
// SearchExperience and the results summary all derive the same state from the
// same rules instead of each re-deriving them.

// ---------------------------------------------------------------------------
// Age threshold
// ---------------------------------------------------------------------------

/**
 * The five career-stage stops, roughly three-year steps from U19 upward. They are
 * exactly the values a `min=19 max=31 step=3` range input produces, so the native
 * control cannot land between them.
 */
export const AGE_STOPS = [19, 22, 25, 28, 31] as const;
export const AGE_STOP_MIN = AGE_STOPS[0];
export const AGE_STOP_MAX = AGE_STOPS[AGE_STOPS.length - 1];
export const AGE_STOP_STEP = 3;
/** Neutral resting position: also where the control returns on "All Ages". */
export const DEFAULT_AGE_STOP = 25;

/** `younger` = the stop and every age below it; `older` = the stop and above. */
export type AgeDirection = "younger" | "older";

export interface AgeSelection {
  /** `null` means no age bound is active at all ("All Ages"). */
  direction: AgeDirection | null;
  /** Always one of {@link AGE_STOPS}, even when no direction is active. */
  threshold: number;
}

export const ALL_AGES: AgeSelection = { direction: null, threshold: DEFAULT_AGE_STOP };

/** Nearest stop, ties resolving to the lower stop. Never returns an off-stop value. */
export function snapToAgeStop(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AGE_STOP;
  if (value <= AGE_STOP_MIN) return AGE_STOP_MIN;
  if (value >= AGE_STOP_MAX) return AGE_STOP_MAX;
  return AGE_STOPS.reduce((best, stop) =>
    Math.abs(stop - value) < Math.abs(best - value) ? stop : best,
  );
}

/**
 * The two API bounds a selection produces. Exactly one bound is ever set:
 * younger emits `age_max` only, older emits `age_min` only, and All Ages emits
 * neither — the `undefined` sides are what clear the opposite bound from both the
 * request and the URL.
 */
export function ageBounds(selection: AgeSelection): {
  age_min: number | undefined;
  age_max: number | undefined;
} {
  if (selection.direction === "younger") {
    return { age_min: undefined, age_max: selection.threshold };
  }
  if (selection.direction === "older") {
    return { age_min: selection.threshold, age_max: undefined };
  }
  return { age_min: undefined, age_max: undefined };
}

/**
 * Rebuild the control's state from whatever bounds a URL supplied, so direct
 * hydration and browser back/forward restore it accurately.
 *
 * `age_max` takes precedence when a hand-crafted URL carries both, matching the
 * default direction; off-stop values snap to the nearest stop so the displayed
 * threshold and the applied filter can never disagree.
 */
export function ageSelectionFromBounds(
  ageMin: number | undefined,
  ageMax: number | undefined,
): AgeSelection {
  if (ageMax != null) return { direction: "younger", threshold: snapToAgeStop(ageMax) };
  if (ageMin != null) return { direction: "older", threshold: snapToAgeStop(ageMin) };
  return ALL_AGES;
}

/**
 * Deterministic normalization of the retired `age_band` parameter, so a legacy
 * URL still loads and still narrows by age.
 *
 * One rule: a band with a lower bound becomes "older" at the smallest stop at or
 * above that bound; a band bounded only from above becomes "younger" at the
 * largest stop at or below it. `31_plus` therefore keeps its exact old semantics
 * (age >= 31); the closed bands become the nearest one-sided threshold, because
 * the new control expresses a single direction by design.
 */
export function legacyAgeBandSelection(band: string | null | undefined): AgeSelection | null {
  switch (band) {
    case "u23":
      return { direction: "younger", threshold: 22 };
    case "24_26":
      return { direction: "older", threshold: 25 };
    case "27_30":
      return { direction: "older", threshold: 28 };
    case "31_plus":
      return { direction: "older", threshold: 31 };
    default:
      // "all", an unknown value, or nothing at all: no age bound.
      return null;
  }
}

/** The prominent value readout inside the control, e.g. "25 Years". */
export function ageThresholdText(threshold: number): string {
  return `${threshold} Years`;
}

/**
 * The one phrase used by the control's accessible names and by the results
 * summary, so the two can never describe different filters.
 */
export function ageSummaryText(selection: AgeSelection): string {
  if (selection.direction === "younger") return `${selection.threshold} Years And Younger`;
  if (selection.direction === "older") return `${selection.threshold} Years And Older`;
  return "All Ages";
}

// ---------------------------------------------------------------------------
// Bounded numeric thresholds (Min Minutes, Min RoleFit)
// ---------------------------------------------------------------------------

/** Inclusive bounds shared by both Discovery numeric thresholds. */
export const THRESHOLD_MIN = 0;
export const THRESHOLD_MAX = 99;

/**
 * Deterministic threshold parsing for typed, pasted and URL-supplied values.
 *
 * Empty stays empty (`undefined` = no threshold), and zero stays zero — the two
 * are never conflated. Anything non-numeric or non-finite is rejected as "no
 * threshold" rather than reaching the API, and every finite value is rounded to a
 * whole number and clamped into 0-99, so a negative or over-99 value cannot leak
 * into a request.
 */
export function parseThreshold(raw: string | number | null | undefined): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string" && raw.trim() === "") return undefined;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, Math.round(parsed)));
}

/** Same rules for an age bound read out of a URL: whole years, never negative. */
export function parseAgeBound(raw: string | null | undefined): number | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.round(parsed));
}
