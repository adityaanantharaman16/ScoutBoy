export const SCOPE_BANNER = "Prototype scope: U23 attackers and midfielders in Europe";

export const POSITION_GROUPS = [
  { key: "", label: "All positions" },
  { key: "ATT", label: "Attackers" },
  { key: "MID", label: "Midfielders" },
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
