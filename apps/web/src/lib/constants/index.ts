export const SCOPE_BANNER =
  "Explore available player profiles with RoleFit analysis where evidence supports it.";

/**
 * Analysis scope is no longer a Discovery control: the rail exposes no scope
 * selector and the results summary no longer reports one. `scope` remains a
 * supported API capability, so these keys stay here for exactly one job —
 * validating a scope-bearing URL before it is forwarded to `/players`, so an old
 * link keeps working instead of silently sending an unknown value.
 *
 * `analyzed` is the default and the only value the app itself ever requests.
 */
export const SEARCH_SCOPE_KEYS = ["analyzed", "all_records", "high_coverage_u23"] as const;
export const DEFAULT_SEARCH_SCOPE = "analyzed";

// Every visible option label in the Discovery rail is Title Case, including the
// "all"/"any" defaults. Only the labels changed: `key` is the query-parameter
// value and is deliberately untouched.
export const POSITION_GROUPS = [
  { key: "", label: "All Positions" },
  { key: "ATT", label: "Attackers" },
  { key: "MID", label: "Midfielders" },
  { key: "DEF", label: "Defenders" },
  { key: "GK", label: "Goalkeepers" },
];

/** The Role select's "no specific role" option. Title Case, same empty key. */
export const ANY_ROLE_LABEL = "Any Role (Best)";

// Role keys + display names mirror configs/roles/*.yaml (also exposed via /methodology).
export const ROLES = [
  { key: "touchline_winger", label: "Touchline Winger", group: "ATT" },
  { key: "inside_forward", label: "Inside Forward", group: "ATT" },
  { key: "shadow_striker", label: "Shadow Striker", group: "ATT" },
  { key: "pressing_forward", label: "Pressing Forward", group: "ATT" },
  { key: "complete_forward", label: "Complete Forward", group: "ATT" },
  { key: "deep_lying_playmaker", label: "Deep-Lying Playmaker", group: "MID" },
  { key: "advanced_8", label: "Advanced 8", group: "MID" },
  { key: "ball_winning_midfielder", label: "Ball-Winning Midfielder", group: "MID" },
  { key: "tempo_controller", label: "Tempo Controller", group: "MID" },
];

// Labels are Title Case; the `key` values ARE the `sort` query parameter and the
// service's sort keys, so they stay exactly as they were.
//
// This list is what the Sort control can represent, which is deliberately a SUBSET
// of the sort modes the API accepts: `age_desc` is a supported API-only mode with no
// option here. A URL carrying anything not in this list is therefore unrepresentable
// and is not forwarded (see `parseSortOption`), so the visible control always agrees
// with the request actually sent.
//
// The asking-price modes order by the lowest plausible expected ask
// (`expected_asking_low_eur`); players whose lower bound is unknown come after every
// known value in BOTH directions, never as if they were priced at zero.
export const SORT_OPTIONS = [
  { key: "rolefit_desc", label: "RoleFit (High → Low)" },
  { key: "rolefit_asc", label: "RoleFit (Low → High)" },
  { key: "age_asc", label: "Age (Young → Old)" },
  { key: "value_desc", label: "Asking Price (High → Low)" },
  { key: "value_asc", label: "Asking Price (Low → High)" },
  { key: "name_asc", label: "Name (A → Z)" },
];

export const SORT_OPTION_KEYS = SORT_OPTIONS.map((s) => s.key);
export const DEFAULT_SORT = "rolefit_desc";
