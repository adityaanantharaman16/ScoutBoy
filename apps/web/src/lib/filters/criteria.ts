// The active-criteria model: which narrowing parameters a Discovery request is
// actually carrying, how each one reads in English, and which query parameters
// removing it clears.
//
// One derivation, four consumers — the collapsed rail summary, the expanded
// removable list, the per-category counts inside Advanced Filters, and the
// results ledger header — so a criterion cannot be counted in one place and
// missing from another.
//
// What is NOT a criterion, deliberately:
//   * `sort`. A non-default ranking reorders the ledger; it never removes a
//     player from it, and it is permanently visible in the always-present Sort
//     control. Counting it would inflate "3 active criteria" for a user who has
//     narrowed nothing.
//   * `page` / `page_size`. Pagination, not narrowing.
//   * `scope` / `universe`. Analysis Scope is retired from the surface (Phase
//     8.1A). Listing it as a removable criterion would put the control back by
//     the side door. A legacy scope-bearing URL is still honoured, and Clear All
//     still drops it from the canonical URL.
//   * confidence / evidence state / concern. The backend search contract does
//     not filter by them, so there is nothing to report.

import { POSITION_GROUPS, ROLES } from "@/lib/constants";
import { formatEur, titleCase } from "@/lib/formatters";

import { ageSelectionFromBounds, ageSummaryText } from "./index";

/** The three compact groups the Advanced Filters disclosure is divided into. */
export type AdvancedCategoryKey = "context" | "evidence" | "market";

/** `core` criteria belong to the always-visible controls, not to a disclosure. */
export type CriterionGroup = AdvancedCategoryKey | "core";

export interface AdvancedCategory {
  key: AdvancedCategoryKey;
  label: string;
  /** Stable dom id fragment, also used for the fields region a header controls. */
  id: string;
}

export const ADVANCED_CATEGORIES: readonly AdvancedCategory[] = [
  { key: "context", label: "Context", id: "advanced-context" },
  { key: "evidence", label: "Evidence & Fit", id: "advanced-evidence" },
  { key: "market", label: "Market", id: "advanced-market" },
] as const;

export interface ActiveCriterion {
  /** Stable identity for keys, test ids and focus restoration. */
  key: string;
  /** Which disclosure (if any) holds the control that owns this criterion. */
  group: CriterionGroup;
  /** Field name, as the rail labels it. */
  field: string;
  /** The value, already readable and already unit-correct. */
  value: string;
  /**
   * Every query parameter removing this one criterion clears — and nothing
   * else. The age control writes one of two bounds and may have arrived through
   * a legacy band, so removing it clears all three.
   */
  params: readonly string[];
}

/** The one phrasing for a criterion, shared by the summary line and each row. */
export function criterionSummary(criterion: ActiveCriterion): string {
  return `${criterion.field}: ${criterion.value}`;
}

/** The accessible name of a criterion's own remove action. */
export function criterionRemoveLabel(criterion: ActiveCriterion): string {
  return `Remove ${criterionSummary(criterion)}.`;
}

/** The subset of a Discovery request this module reads. */
export interface CriteriaSource {
  q?: string;
  age_min?: number;
  age_max?: number;
  position_group?: string;
  role?: string;
  league?: string;
  club?: string;
  nationality?: string;
  min_minutes?: number;
  rolefit_min?: number;
  rolefit_max?: number;
  playstyle?: string;
  value_min?: number;
  value_max?: number;
}

function labelFor(
  options: ReadonlyArray<{ key: string; label: string }>,
  key: string,
): string {
  return options.find((o) => o.key === key)?.label ?? titleCase(key);
}

/**
 * Every active narrowing criterion, in the rail's own top-to-bottom order:
 * the core controls first, then Context, Evidence & Fit and Market. The
 * collapsed summary shows the first two of this list, so the order decides which
 * two a scout sees — core criteria are the ones they set most often.
 *
 * `playstyleLabels` comes from the Methodology contract (the single source of
 * truth for playstyle keys and display names). Until it has loaded, an active
 * playstyle still reads as a title-cased key rather than disappearing from the
 * count.
 */
export function activeCriteria(
  filters: CriteriaSource,
  playstyleLabels: Readonly<Record<string, string>> = {},
): ActiveCriterion[] {
  const out: ActiveCriterion[] = [];

  if (filters.q) {
    out.push({ key: "q", group: "core", field: "Search", value: filters.q, params: ["q"] });
  }

  const age = ageSelectionFromBounds(filters.age_min, filters.age_max);
  if (age.direction != null) {
    out.push({
      key: "age",
      group: "core",
      field: "Age",
      value: ageSummaryText(age),
      // The retired legacy parameter goes with them: a criterion that arrived
      // through `age_band` must not survive its own removal.
      params: ["age_min", "age_max", "age_band"],
    });
  }

  if (filters.position_group) {
    out.push({
      key: "position_group",
      group: "core",
      field: "Position Group",
      value: labelFor(POSITION_GROUPS, filters.position_group),
      params: ["position_group"],
    });
  }

  if (filters.role) {
    out.push({
      key: "role",
      group: "core",
      field: "Role",
      value: labelFor(ROLES, filters.role),
      params: ["role"],
    });
  }

  if (filters.league) {
    out.push({
      key: "league",
      group: "context",
      field: "League",
      value: filters.league,
      params: ["league"],
    });
  }

  if (filters.club) {
    out.push({
      key: "club",
      group: "context",
      field: "Club",
      value: filters.club,
      params: ["club"],
    });
  }

  if (filters.nationality) {
    out.push({
      key: "nationality",
      group: "context",
      field: "Nationality",
      value: filters.nationality,
      params: ["nationality"],
    });
  }

  // Numeric thresholds are compared against null, never truthiness: a typed 0 is
  // a real, active bound the user must be able to see and remove.
  if (filters.min_minutes != null) {
    out.push({
      key: "min_minutes",
      group: "evidence",
      field: "Minimum Minutes",
      value: filters.min_minutes.toLocaleString("en-US"),
      params: ["min_minutes"],
    });
  }

  if (filters.rolefit_min != null) {
    out.push({
      key: "rolefit_min",
      group: "evidence",
      field: "Minimum RoleFit",
      value: String(filters.rolefit_min),
      params: ["rolefit_min"],
    });
  }

  if (filters.rolefit_max != null) {
    out.push({
      key: "rolefit_max",
      group: "evidence",
      field: "Maximum RoleFit",
      value: String(filters.rolefit_max),
      params: ["rolefit_max"],
    });
  }

  if (filters.playstyle) {
    out.push({
      key: "playstyle",
      group: "evidence",
      field: "Playstyle",
      value: playstyleLabels[filters.playstyle] ?? titleCase(filters.playstyle),
      params: ["playstyle"],
    });
  }

  // The shared currency formatter, so a bound reads exactly as every other euro
  // figure in the product does: absolute EUR in, its own compact euro string out.
  // The millions the input is typed in never leak into the sentence, and no
  // midpoint of the two bounds is ever computed or shown.
  if (filters.value_min != null) {
    out.push({
      key: "value_min",
      group: "market",
      field: "Minimum Expected Asking",
      value: formatEur(filters.value_min),
      params: ["value_min"],
    });
  }

  if (filters.value_max != null) {
    out.push({
      key: "value_max",
      group: "market",
      field: "Maximum Expected Asking",
      value: formatEur(filters.value_max),
      params: ["value_max"],
    });
  }

  return out;
}

/** How many of the given criteria live inside a particular advanced category. */
export function countInGroup(criteria: ActiveCriterion[], group: CriterionGroup): number {
  return criteria.filter((c) => c.group === group).length;
}

/** How many live inside Advanced Filters at all, for the disclosure's own count. */
export function countAdvanced(criteria: ActiveCriterion[]): number {
  return criteria.filter((c) => c.group !== "core").length;
}

/**
 * The first advanced category that has an active criterion, so a hard-loaded
 * compound URL can open straight onto the controls it is actually using.
 */
export function firstActiveCategory(criteria: ActiveCriterion[]): AdvancedCategoryKey | null {
  for (const category of ADVANCED_CATEGORIES) {
    if (countInGroup(criteria, category.key) > 0) return category.key;
  }
  return null;
}

/**
 * The patch that removes one criterion: every parameter it owns set to
 * `undefined`, and nothing else. The caller's `set` helper supplies the page
 * reset, so unrelated criteria are carried through untouched.
 */
export function removalPatch(criterion: ActiveCriterion): Record<string, undefined> {
  return Object.fromEntries(criterion.params.map((param) => [param, undefined]));
}
