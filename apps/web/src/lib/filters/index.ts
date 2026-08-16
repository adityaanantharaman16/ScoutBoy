// Discovery filter semantics: the age-threshold control, the bounded numeric
// thresholds, and the pagination/sort values a URL may supply. Everything here is
// pure, so the rail, the URL hydration in SearchExperience and the results summary
// all derive the same state from the same rules instead of each re-deriving them.

import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SEARCH_SCOPE,
  DEFAULT_SORT,
  SORT_OPTION_KEYS,
} from "@/lib/constants";

/**
 * The established default Discovery request, in one place.
 *
 * It is what the root URL means, what every default-omission rule in the
 * serializer compares against, and what Clear All restores. Because the
 * serializer only writes the keys it is handed, passing exactly this object
 * produces the clean root URL and drops any legacy `scope` / `universe` /
 * `age_band` parameter a shared link happened to carry.
 */
export const DEFAULT_DISCOVERY_FILTERS = {
  scope: DEFAULT_SEARCH_SCOPE,
  sort: DEFAULT_SORT,
  page: DEFAULT_PAGE,
  page_size: DEFAULT_PAGE_SIZE,
} as const;

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
// Free-text predicates (Search, League, Club, Nationality)
// ---------------------------------------------------------------------------

/**
 * A text predicate read from a URL or typed into the rail.
 *
 * OUTER whitespace is removed; internal spacing is not touched, so multi-word names
 * such as "Paris Saint-Germain" and "Manchester City" are unaffected. An earlier
 * version skipped trimming on the theory that it would eat the space between two
 * words — it would not: trimming only ever removes leading and trailing runs, and a
 * user typing "Paris " has not yet typed a second word for that space to separate.
 *
 * Leaving the outer space in was not harmless. It reached the URL as `club=Paris+`,
 * the readable summary as "Club: Paris ", and the SQL predicate as a literal
 * substring with a trailing space — so a stray keystroke or a paste from a
 * spreadsheet silently returned nothing.
 *
 * Whitespace-only input is "no predicate", exactly as an empty string is, so the
 * parameter is omitted from the request and from the URL rather than being sent as
 * a needle no stored value can contain.
 */
export function parseTextFilter(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

// ---------------------------------------------------------------------------
// Expected-asking bounds
//
// TWO UNITS, ONE DIRECTION OF TRUTH. The API contract is absolute EUR, so that
// is what the request and the URL carry and what `SearchFilters` holds. The rail
// is 248px wide, where "12500000" is unreadable and easy to mistype by a factor
// of ten, so the INPUT is EUR millions and nothing else in the app is.
//
// The conversion lives here rather than in the component so the input, the URL,
// the readable active-criteria summary and the request cannot disagree about
// which unit they are holding.
// ---------------------------------------------------------------------------

/** Scale between the rail's millions input and the API's absolute EUR. */
export const EUR_PER_MILLION = 1_000_000;

/**
 * An absolute-EUR asking bound from a URL.
 *
 * Blank is no bound. A non-finite or negative value is REJECTED as no bound
 * rather than clamped: unlike a minutes or RoleFit threshold there is no
 * meaningful ceiling to clamp to, and silently rewriting `-5` as `0` would make
 * an active predicate out of a value the user cannot have meant. Zero itself is
 * a real, representable bound and survives.
 */
export function parseAskingEur(raw: string | number | null | undefined): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string" && raw.trim() === "") return undefined;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed);
}

/**
 * The rail's millions input, converted to the absolute EUR the API accepts.
 * `5` becomes `5000000`; `12.5` becomes `12500000`. Rounding to whole euros
 * removes binary floating-point dust (12.5 * 1e6 is exact, 1.234567 * 1e6 is
 * not) so a value can round-trip through the URL unchanged.
 */
export function parseAskingMillions(raw: string | number | null | undefined): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string" && raw.trim() === "") return undefined;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed * EUR_PER_MILLION);
}

/** What one raw asking-price keystroke means. See {@link classifyAskingDraft}. */
export type AskingDraft =
  /** Empty or whitespace-only: clear the bound. */
  | { kind: "blank" }
  /** A complete, non-negative number: this many absolute EUR. */
  | { kind: "value"; eur: number }
  /** Not a number the API could accept: hold the text, send nothing. */
  | { kind: "invalid" };

/**
 * Classify the raw text in an asking-price field.
 *
 * Three outcomes rather than two, because "clear the bound" and "do not send this"
 * are different intentions and a single `number | undefined` cannot tell them apart.
 * Blank clears; a negative, non-finite or unparseable value is withheld from the
 * request entirely rather than being clamped into something the user did not type.
 *
 * Note that a mid-typing `"12."` is a genuine `value` (JavaScript reads it as 12), so
 * the intermediate state of typing `12.5` is a harmless `12` rather than a rejection —
 * what preserves the visible `"12."` is the control's own text draft, not this
 * function.
 */
export function classifyAskingDraft(raw: string): AskingDraft {
  if (raw.trim() === "") return { kind: "blank" };
  const eur = parseAskingMillions(raw);
  return eur == null ? { kind: "invalid" } : { kind: "value", eur };
}

/**
 * The input value for an absolute-EUR bound, in millions.
 *
 * Full precision, not a fixed number of decimals: a hard-loaded `value_min=1234567`
 * must remain representable and round-trip back to the same euros rather than
 * being quietly rewritten as EUR 1.2M by its own control.
 */
export function askingMillionsInput(eur: number | null | undefined): string {
  if (eur == null || !Number.isFinite(eur)) return "";
  return String(eur / EUR_PER_MILLION);
}

// ---------------------------------------------------------------------------
// Range safety
// ---------------------------------------------------------------------------

/** Which side of an inclusive pair the user just changed. */
export type EditedBound = "min" | "max";

/**
 * Keep an inclusive `[min, max]` pair coherent, so `min > max` can never reach
 * the API. RoleFit would silently return nothing; `value_min > value_max` is a
 * documented 422.
 *
 * ONE deterministic rule, used by both pairs and by both entry points:
 *
 *   **the edited bound wins, and its companion follows it.**
 *
 * Raising a minimum past its maximum raises the maximum to match; lowering a
 * maximum past its minimum lowers the minimum to match. The edit a scout just
 * made is never discarded or held back, and the companion move is written to the
 * control, the URL, the active-criteria summary and the request in the same
 * update — so all four always agree.
 *
 * A hard-loaded URL has no edited side, so the caller passes `"min"` and the
 * **minimum is authoritative**: `?rolefit_min=80&rolefit_max=20` loads as
 * `80-80`. That is the same normalization the age control already applies to an
 * off-stop URL bound, and the next interaction writes the canonical pair back.
 *
 * Nothing outside the pair is touched.
 */
export function coherentBounds(
  min: number | undefined,
  max: number | undefined,
  edited: EditedBound = "min",
): { min: number | undefined; max: number | undefined } {
  if (min == null || max == null || min <= max) return { min, max };
  return edited === "min" ? { min, max: min } : { min: max, max };
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
