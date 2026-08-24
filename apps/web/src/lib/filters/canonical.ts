// The canonical Discovery view: what a filter/sort state MEANS, in one place.
//
// Six things need to agree about that, and before this module they each derived
// it themselves:
//
//   * the live filter rail,
//   * the Discovery URL it writes,
//   * a saved view's identity (is this the same cohort I already saved?),
//   * reopening a saved view,
//   * device storage,
//   * what the API will accept.
//
// Any two of those disagreeing is a bug a user can see: a "duplicate" saved view
// that is really the same cohort, a saved view that reopens to a different
// ledger, or a stored filter the API rejects. So the rules live here once, as
// pure functions, and every one of those six consumers calls them.
//
// Everything here is pure and has no React, no `window` and no network.

import {
  ANY_PLAYSTYLE_LABEL,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  POSITION_GROUPS,
  ROLES,
  SORT_OPTION_KEYS,
} from "@/lib/constants";

import {
  ageBounds,
  ageSelectionFromBounds,
  coherentBounds,
  legacyAgeBandSelection,
  parseAgeBound,
  parseAskingEur,
  parseMinutesThreshold,
  parsePageSize,
  parseRoleFitThreshold,
  parseTextFilter,
} from "./index";

/**
 * The representable Discovery state, canonicalized.
 *
 * A field is present only when it is genuinely part of the view, so "no age
 * bound" and "age bound absent" are the same thing rather than two states that
 * would hash differently. That is what makes two views comparable at all.
 *
 * Deliberately absent:
 *
 *   * `scope` / `universe` — Analysis Scope was retired from Discovery in Phase
 *     8.1A. A legacy URL still loads and still means what it said, but persisting
 *     it would put the retired control back by the side door.
 *   * `page` — opening a saved view always starts on page 1, so the page number
 *     is not part of what a view means.
 *   * `age_band` — the retired legacy parameter, normalized into `age_min` /
 *     `age_max` on the way in and never stored in its own right.
 */
export interface DiscoveryView {
  q?: string;
  position_group?: string;
  role?: string;
  league?: string;
  club?: string;
  nationality?: string;
  playstyle?: string;
  age_min?: number;
  age_max?: number;
  min_minutes?: number;
  rolefit_min?: number;
  rolefit_max?: number;
  value_min?: number;
  value_max?: number;
  sort?: string;
  page_size?: number;
}

/**
 * Every field a canonical view may carry, in the order the URL writes them.
 *
 * One list, used by the serializer, the identity string and the storage
 * validator, so a field cannot be added to the view and silently omitted from
 * one of the three.
 */
export const DISCOVERY_VIEW_FIELDS = [
  "q",
  "position_group",
  "role",
  "league",
  "club",
  "nationality",
  "playstyle",
  "age_min",
  "age_max",
  "min_minutes",
  "rolefit_min",
  "rolefit_max",
  "value_min",
  "value_max",
  "sort",
  "page_size",
] as const;

export type DiscoveryViewField = (typeof DISCOVERY_VIEW_FIELDS)[number];

/** Which fields are free text, and therefore identity-bearing Unicode. */
const TEXT_FIELDS = ["q", "league", "club", "nationality"] as const;

/**
 * Outer whitespace off, then NFC.
 *
 * NFC matters because these values carry the view's identity. "Köln" typed on
 * macOS arrives decomposed and pasted from elsewhere arrives composed; the two
 * look identical, compare unequal, and would otherwise produce two saved views a
 * scout cannot tell apart. The API applies the same normalization, so the browser
 * and the server agree on what one club name is.
 */
function normalizeText(raw: string | null | undefined): string | undefined {
  const trimmed = parseTextFilter(raw);
  return trimmed === undefined ? undefined : trimmed.normalize("NFC");
}

/**
 * The longest free-text predicate a view may carry, mirroring `TEXT_FILTER_MAX`
 * in the API schema. A longer value is not truncated — truncating would silently
 * change which players match — it makes the view unrepresentable, and the
 * stale-recovery path drops that one criterion and says so.
 */
export const TEXT_FILTER_MAX = 120;

/** The label max the API enforces, mirrored so the dialog can say so up front. */
export const SAVED_LABEL_MAX = 80;

const POSITION_GROUP_KEYS = POSITION_GROUPS.map((g) => g.key).filter(Boolean);
const ROLE_KEYS = ROLES.map((r) => r.key);

/**
 * A playstyle key, checked by SHAPE rather than against a list.
 *
 * The options come from the Methodology contract at runtime, so the browser has
 * no static allowlist to check against and any it invented would be a second copy
 * free to drift from the one the backend filters by. The API validates membership
 * against the live YAML; this only rejects values that could not be a key at all.
 */
const SLUG = /^[a-z0-9_]+$/;

// ---------------------------------------------------------------------------
// Building a canonical view
// ---------------------------------------------------------------------------

/**
 * Drops `undefined` entries so a view object has only the fields it really carries.
 *
 * Built through `Object.fromEntries` rather than by assigning into a typed
 * object: TypeScript cannot narrow `out[field] = value` when `field` ranges over
 * a union of keys with different value types, and the cast that would silence it
 * is exactly the kind that hides a genuine mismatch later.
 */
function compact(view: DiscoveryView): DiscoveryView {
  const present = DISCOVERY_VIEW_FIELDS.flatMap((field) => {
    const value = view[field];
    return value === undefined || value === null || value === ""
      ? []
      : [[field, value] as const];
  });
  return Object.fromEntries(present) as DiscoveryView;
}

/**
 * The canonical view a set of Discovery query parameters means.
 *
 * This is the ONE hydration path. It applies every normalization the rail
 * applies — legacy `age_band`, off-stop age snapping, single-sided age bounds,
 * coherent inclusive pairs, domain-correct numeric clamping, unknown sort falling
 * back to the default — so a hard-loaded URL, a back/forward restore and a
 * reopened saved view all produce the same state.
 */
export function discoveryViewFromParams(params: URLSearchParams): DiscoveryView {
  // Age hydration, in precedence order: explicit bounds, then a legacy band, then
  // no bound at all. Whichever wins is re-expressed through `ageBounds`, so the
  // result can only ever be a snapped, single-sided bound.
  const explicitAge = ageSelectionFromBounds(
    parseAgeBound(params.get("age_min")),
    parseAgeBound(params.get("age_max")),
  );
  const age = ageBounds(
    explicitAge.direction != null
      ? explicitAge
      : (legacyAgeBandSelection(params.get("age_band")) ?? explicitAge),
  );

  // A hand-crafted `?rolefit_min=80&rolefit_max=20` has no edited side, so the
  // documented rule treats the MINIMUM as authoritative.
  const roleFit = coherentBounds(
    parseRoleFitThreshold(params.get("rolefit_min")),
    parseRoleFitThreshold(params.get("rolefit_max")),
    "min",
  );
  const asking = coherentBounds(
    parseAskingEur(params.get("value_min")),
    parseAskingEur(params.get("value_max")),
    "min",
  );

  const positionGroup = params.get("position_group") || undefined;
  const role = params.get("role") || undefined;
  const playstyle = normalizeText(params.get("playstyle"));
  const sort = params.get("sort");
  const pageSize = parsePageSize(params.get("page_size"));

  return compact({
    q: normalizeText(params.get("q")),
    // Unknown enumerated values are dropped rather than forwarded: the API would
    // 422 them, and the rail would then show an error for something the user
    // never chose.
    position_group: POSITION_GROUP_KEYS.includes(positionGroup ?? "") ? positionGroup : undefined,
    role: ROLE_KEYS.includes(role ?? "") ? role : undefined,
    league: normalizeText(params.get("league")),
    club: normalizeText(params.get("club")),
    nationality: normalizeText(params.get("nationality")),
    playstyle: playstyle && SLUG.test(playstyle) ? playstyle : undefined,
    age_min: age.age_min,
    age_max: age.age_max,
    min_minutes: parseMinutesThreshold(params.get("min_minutes")),
    rolefit_min: roleFit.min,
    rolefit_max: roleFit.max,
    value_min: asking.min,
    value_max: asking.max,
    // The default is omitted, so the root URL and `?sort=rolefit_desc` are one
    // view rather than two.
    sort: sort && sort !== DEFAULT_SORT && (SORT_OPTION_KEYS as readonly string[]).includes(sort)
      ? sort
      : undefined,
    page_size: pageSize === DEFAULT_PAGE_SIZE ? undefined : pageSize,
  });
}

/**
 * The canonical view a live Discovery request means.
 *
 * `SearchFilters` carries the defaults the request needs (`scope`, `sort`,
 * `page`, `page_size`) and the view must not, so this is where they come off.
 * Going through the URL is deliberate rather than lazy: it guarantees the view
 * saved from the rail is byte-identical to the view a shared link produces,
 * because both are the output of the same parser.
 */
export function discoveryViewFromFilters(filters: Record<string, unknown>): DiscoveryView {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value == null || value === "") continue;
    params.set(key, String(value));
  }
  return discoveryViewFromParams(params);
}

// ---------------------------------------------------------------------------
// Serializing a canonical view
// ---------------------------------------------------------------------------

/**
 * The query parameters that reproduce this view.
 *
 * Defaults are already absent from a canonical view, so nothing is filtered here
 * — what the view carries is exactly what the URL carries. `page` is never
 * written: a saved view always opens on page 1, and page 1 is the default.
 */
export function discoveryViewToParams(view: DiscoveryView): URLSearchParams {
  const params = new URLSearchParams();
  for (const field of DISCOVERY_VIEW_FIELDS) {
    const value = view[field];
    if (value !== undefined && value !== null && value !== "") {
      params.set(field, String(value));
    }
  }
  return params;
}

/** The href a saved view opens. Always page 1, by construction. */
export function discoveryViewHref(view: DiscoveryView, pathname = "/"): string {
  const query = discoveryViewToParams(view).toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * A view's canonical IDENTITY, as a stable string.
 *
 * Two views that canonicalize to the same representable state produce the same
 * identity, which is what makes "saving this again must not create a duplicate"
 * decidable in the browser without a round trip.
 *
 * Deliberately a sorted-key string rather than a hash: the browser needs no
 * cryptography for this, `crypto.subtle` is async and would infect every call
 * site, and a plain string is inspectable when something goes wrong. The API
 * computes its own SHA-256 for its unique index; the two never have to agree,
 * because the browser recomputes this from the filters the API returns rather
 * than comparing digests with it.
 */
export function discoveryViewIdentity(view: DiscoveryView): string {
  const parts: string[] = [];
  for (const field of [...DISCOVERY_VIEW_FIELDS].sort()) {
    const value = view[field as DiscoveryViewField];
    if (value !== undefined && value !== null && value !== "") {
      parts.push(`${field}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join("&");
}

/** Whether two views describe the same cohort. */
export function sameDiscoveryView(a: DiscoveryView, b: DiscoveryView): boolean {
  return discoveryViewIdentity(a) === discoveryViewIdentity(b);
}

/** True when a view narrows nothing — the bare Discovery ledger. */
export function isEmptyDiscoveryView(view: DiscoveryView): boolean {
  return discoveryViewIdentity(view) === "";
}

// ---------------------------------------------------------------------------
// Reading a view back from storage or from the API
// ---------------------------------------------------------------------------

/** What survived validation, and what did not. */
export interface DiscoveryViewRecovery {
  view: DiscoveryView;
  /**
   * Field names that were present but are no longer representable. Never
   * forwarded to the API; surfaced to the user so they can update or delete the
   * saved view rather than silently getting a different cohort.
   */
  dropped: DiscoveryViewField[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A finite integer within an inclusive range, or undefined. */
function boundedInteger(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  // Named `whole` rather than the obvious `rounded`: the sharp-corner source scan
  // greps production source for Tailwind radius tokens, and a bare `rounded`
  // identifier reads as one.
  const whole = Math.round(value);
  return whole < min || whole > max ? undefined : whole;
}

/**
 * Validates a view parsed from browser storage or received from the API.
 *
 * Every field is checked independently and a bad one is DROPPED rather than
 * failing the whole view: a saved view whose playstyle was retired should reopen
 * every other criterion the scout set, with a notice about the one that could
 * not be restored. Failing the lot would throw away work over a single stale
 * value.
 *
 * Field-by-field rather than "re-parse the URL", because the caller needs to know
 * WHICH criterion was lost in order to say so.
 */
export function recoverDiscoveryView(raw: unknown): DiscoveryViewRecovery {
  const dropped: DiscoveryViewField[] = [];
  if (!isPlainObject(raw)) return { view: {}, dropped };

  const out: DiscoveryView = {};

  const keep = <K extends DiscoveryViewField>(field: K, value: DiscoveryView[K]) => {
    if (value !== undefined) out[field] = value;
    else if (raw[field] !== undefined && raw[field] !== null) dropped.push(field);
  };

  for (const field of TEXT_FIELDS) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      dropped.push(field);
      continue;
    }
    const normalized = normalizeText(value);
    keep(field, normalized !== undefined && normalized.length <= TEXT_FILTER_MAX ? normalized : undefined);
  }

  if (raw.position_group != null) {
    keep(
      "position_group",
      typeof raw.position_group === "string" && POSITION_GROUP_KEYS.includes(raw.position_group)
        ? raw.position_group
        : undefined,
    );
  }
  if (raw.role != null) {
    keep(
      "role",
      typeof raw.role === "string" && ROLE_KEYS.includes(raw.role) ? raw.role : undefined,
    );
  }
  if (raw.playstyle != null) {
    keep(
      "playstyle",
      typeof raw.playstyle === "string" &&
        raw.playstyle.length <= 64 &&
        SLUG.test(raw.playstyle)
        ? raw.playstyle
        : undefined,
    );
  }
  if (raw.sort != null) {
    keep(
      "sort",
      typeof raw.sort === "string" &&
        raw.sort !== DEFAULT_SORT &&
        (SORT_OPTION_KEYS as readonly string[]).includes(raw.sort)
        ? raw.sort
        : undefined,
    );
  }

  // Age: at most one side, and only on a stop. Both sides present is not a
  // partially-recoverable view — it is a state the control cannot display — so
  // the age criterion as a whole is dropped and reported once.
  const ageMin = raw.age_min;
  const ageMax = raw.age_max;
  if (ageMin != null || ageMax != null) {
    if (ageMin != null && ageMax != null) {
      dropped.push("age_min");
    } else {
      const selection = ageSelectionFromBounds(
        typeof ageMax === "number" ? undefined : boundedInteger(ageMin, 0, 120),
        typeof ageMax === "number" ? boundedInteger(ageMax, 0, 120) : undefined,
      );
      const bounds = ageBounds(selection);
      if (bounds.age_min === undefined && bounds.age_max === undefined) {
        dropped.push(ageMax != null ? "age_max" : "age_min");
      } else {
        if (bounds.age_min !== undefined) out.age_min = bounds.age_min;
        if (bounds.age_max !== undefined) out.age_max = bounds.age_max;
      }
    }
  }

  if (raw.min_minutes != null) keep("min_minutes", boundedInteger(raw.min_minutes, 0, 10_000));
  if (raw.page_size != null) {
    const size = boundedInteger(raw.page_size, 1, 100);
    keep("page_size", size === DEFAULT_PAGE_SIZE ? undefined : size);
    // A stored page size equal to the default is not a loss — it is the default.
    if (size === DEFAULT_PAGE_SIZE) dropped.pop();
  }

  // Inclusive pairs are validated together: a stored `min > max` is a cohort that
  // can never match, so the pair is made coherent by the documented rule rather
  // than either side being dropped.
  const roleFitMin = raw.rolefit_min != null ? boundedInteger(raw.rolefit_min, 0, 99) : undefined;
  const roleFitMax = raw.rolefit_max != null ? boundedInteger(raw.rolefit_max, 0, 99) : undefined;
  if (raw.rolefit_min != null && roleFitMin === undefined) dropped.push("rolefit_min");
  if (raw.rolefit_max != null && roleFitMax === undefined) dropped.push("rolefit_max");
  const roleFit = coherentBounds(roleFitMin, roleFitMax, "min");
  if (roleFit.min !== undefined) out.rolefit_min = roleFit.min;
  if (roleFit.max !== undefined) out.rolefit_max = roleFit.max;

  const valueMin =
    raw.value_min != null ? boundedInteger(raw.value_min, 0, 1_000_000_000_000) : undefined;
  const valueMax =
    raw.value_max != null ? boundedInteger(raw.value_max, 0, 1_000_000_000_000) : undefined;
  if (raw.value_min != null && valueMin === undefined) dropped.push("value_min");
  if (raw.value_max != null && valueMax === undefined) dropped.push("value_max");
  const asking = coherentBounds(valueMin, valueMax, "min");
  if (asking.min !== undefined) out.value_min = asking.min;
  if (asking.max !== undefined) out.value_max = asking.max;

  return { view: compact(out), dropped };
}

// ---------------------------------------------------------------------------
// Describing a view
// ---------------------------------------------------------------------------

/** How each field reads in the "part of this view is unavailable" notice. */
const FIELD_LABELS: Record<DiscoveryViewField, string> = {
  q: "Search",
  position_group: "Position Group",
  role: "Role",
  league: "League",
  club: "Club",
  nationality: "Nationality",
  playstyle: "Playstyle",
  age_min: "Age",
  age_max: "Age",
  min_minutes: "Minimum Minutes",
  rolefit_min: "Minimum RoleFit",
  rolefit_max: "Maximum RoleFit",
  value_min: "Minimum Expected Asking",
  value_max: "Maximum Expected Asking",
  sort: "Sort",
  page_size: "Results per page",
};

/** The readable field names for a set of dropped criteria, de-duplicated. */
export function droppedFieldLabels(dropped: DiscoveryViewField[]): string[] {
  return [...new Set(dropped.map((field) => FIELD_LABELS[field]))];
}

/**
 * How many narrowing criteria a view carries.
 *
 * Sort and page size are excluded for the same reason `activeCriteria` excludes
 * them: they change how the ledger is ordered or paged, never which players are
 * in it, so counting them would tell a scout they had narrowed something they
 * had not. The age pair counts once.
 */
export function discoveryViewCriteriaCount(view: DiscoveryView): number {
  let count = 0;
  for (const field of DISCOVERY_VIEW_FIELDS) {
    if (field === "sort" || field === "page_size" || field === "age_max") continue;
    if (view[field] !== undefined) count += 1;
  }
  if (view.age_max !== undefined && view.age_min === undefined) count += 1;
  return count;
}

/** The Playstyle select's empty-option label, re-exported for the summary line. */
export { ANY_PLAYSTYLE_LABEL };
