// Discovery filter semantics: the age-threshold control, the bounded numeric
// thresholds, and the pagination/sort values a URL may supply. Everything here is
// pure, so the rail, the URL hydration in SearchExperience and the results summary
// all derive the same state from the same rules instead of each re-deriving them.

import { DEFAULT_SORT, SORT_OPTION_KEYS } from "@/lib/constants";

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
//
// TWO DOMAINS, TWO SETS OF BOUNDS. Minutes are minutes; RoleFit is the
// authoritative 0-99 score. They briefly shared one `THRESHOLD_MAX = 99`, which
// silently clamped a realistic 1,500-minute threshold down to 99 minutes and made
// the rail's helper copy wrong. Nothing generic is exported any more: each domain
// has its own named bounds and its own named parser, so reaching for the minutes
// ceiling while meaning RoleFit (or the reverse) cannot type-check by accident.
// ---------------------------------------------------------------------------

/** Inclusive bounds for a season-MINUTES threshold. See scoutboy_shared. */
export const MIN_MINUTES_FLOOR = 0;
export const MIN_MINUTES_CEILING = 10_000;

/** Inclusive bounds of the authoritative RoleFit scale. Never a minutes bound. */
export const ROLEFIT_SCALE_MIN = 0;
export const ROLEFIT_SCALE_MAX = 99;

/** The API's own page-size ceiling, mirrored so an invalid URL never reaches it. */
export const PAGE_SIZE_CEILING = 100;

/**
 * Deterministic whole-number parsing for typed, pasted and URL-supplied values.
 *
 * Empty stays empty (`undefined` = no threshold) and zero stays zero — the two are
 * never conflated. Anything non-numeric or non-finite is rejected as "no threshold"
 * rather than reaching the API, and every finite value is rounded and clamped into
 * the caller's own inclusive range.
 */
function parseBoundedWholeNumber(
  raw: string | number | null | undefined,
  floor: number,
  ceiling: number,
): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string" && raw.trim() === "") return undefined;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(ceiling, Math.max(floor, Math.round(parsed)));
}

/** A `min_minutes` threshold: whole minutes, 0-10,000 inclusive. */
export function parseMinutesThreshold(
  raw: string | number | null | undefined,
): number | undefined {
  return parseBoundedWholeNumber(raw, MIN_MINUTES_FLOOR, MIN_MINUTES_CEILING);
}

/** A RoleFit bound: whole points on the 0-99 scale. Never accepts minutes. */
export function parseRoleFitThreshold(
  raw: string | number | null | undefined,
): number | undefined {
  return parseBoundedWholeNumber(raw, ROLEFIT_SCALE_MIN, ROLEFIT_SCALE_MAX);
}

/** Same rules for an age bound read out of a URL: whole years, never negative. */
export function parseAgeBound(raw: string | null | undefined): number | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.round(parsed));
}

// ---------------------------------------------------------------------------
// Pagination and sort, parsed from the URL
// ---------------------------------------------------------------------------

/**
 * A `page` from a URL: an integer of at least 1, or `undefined` so the caller's
 * default applies. A fractional, zero, negative or non-numeric value is not
 * forwarded — the API would reject it, and the rail would then show an error for
 * something the user never chose.
 */
export function parsePage(raw: string | null | undefined): number | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return undefined;
  return parsed;
}

/** A `page_size` from a URL: an integer within the API's accepted 1-100 range. */
export function parsePageSize(raw: string | null | undefined): number | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > PAGE_SIZE_CEILING) return undefined;
  return parsed;
}

/**
 * A `sort` from a URL, resolved to a value the visible Sort control can actually
 * display. Anything else — an unknown key, or an API-only mode the select has no
 * option for, such as `age_desc` — falls back to the default, so the control and
 * the request the app sends can never disagree.
 */
export function parseSortOption(raw: string | null | undefined): string {
  if (raw != null && (SORT_OPTION_KEYS as readonly string[]).includes(raw)) return raw;
  return DEFAULT_SORT;
}
