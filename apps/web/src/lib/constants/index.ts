export const SCOPE_BANNER =
  "Explore available player profiles with RoleFit analysis where evidence supports it.";

export const SEARCH_SCOPES = [
  {
    key: "analyzed",
    label: "Analyzed",
    description: "Players with at least one RoleFit rating.",
  },
  {
    key: "all_records",
    label: "All records",
    description: "Every player with a usable season profile.",
  },
  {
    key: "high_coverage_u23",
    label: "High-coverage U23",
    description: "U23 attackers and midfielders meeting ScoutBoy coverage thresholds.",
  },
];

export const AGE_BANDS = [
  { key: "all", label: "All ages" },
  { key: "u23", label: "U23" },
  { key: "24_26", label: "24-26" },
  { key: "27_30", label: "27-30" },
  { key: "31_plus", label: "31+" },
];

export const POSITION_GROUPS = [
  { key: "", label: "All positions" },
  { key: "ATT", label: "Attackers" },
  { key: "MID", label: "Midfielders" },
  { key: "DEF", label: "Defenders" },
  { key: "GK", label: "Goalkeepers" },
];

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

export const SORT_OPTIONS = [
  { key: "rolefit_desc", label: "RoleFit (high → low)" },
  { key: "rolefit_asc", label: "RoleFit (low → high)" },
  { key: "age_asc", label: "Age (young → old)" },
  { key: "value_desc", label: "Asking price (high → low)" },
  { key: "value_asc", label: "Asking price (low → high)" },
  { key: "name_asc", label: "Name (A → Z)" },
];
