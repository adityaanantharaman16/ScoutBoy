/**
 * Representative values for the dark-mode pilot.
 *
 * Every number, name, role, score, confidence level, market label, range and
 * audit group below was read from ScoutBoy's own deterministic sample cohort
 * (`db/scoutboy.db`, season 2023/24, rating version as seeded) via the live API
 * on 2026-07-31 — the same responses production renders. Nothing here is
 * invented, rounded differently, or recomputed: the pilot needs realistic
 * information density to be judged, and made-up numbers would make it
 * unjudgeable.
 *
 * These are FROZEN COPIES for a static design artifact. The pilot does not call
 * the API, so it cannot drift a live surface, and it is explicitly labelled on
 * the page as a design pilot rather than live data.
 */

export type Band = "red" | "rust" | "amber" | "green" | "emerald" | "elite" | "unknown";

/** Mirrors the production `scoreBand` thresholds exactly. */
export function band(score: number | null): Band {
  if (score == null || Number.isNaN(score)) return "unknown";
  if (score < 40) return "red";
  if (score < 55) return "rust";
  if (score < 70) return "amber";
  if (score < 80) return "green";
  if (score < 90) return "emerald";
  return "elite";
}

/** Mirrors the production `formatEur` sentinel behaviour: missing is "—", never €0. */
export function eur(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `€${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `€${Math.round(value / 1_000)}K`;
  return `€${Math.round(value)}`;
}

/** Mirrors `marketRangeText`: a partial range keeps whichever endpoint exists. */
export function eurRange(low: number | null, high: number | null): string {
  if (low == null && high == null) return "Unknown";
  if (high == null) return `From ${eur(low)}`;
  if (low == null) return `Up to ${eur(high)}`;
  return `${eur(low)} – ${eur(high)}`;
}

export type MarketLabel = "inflated" | "high-risk" | "fair" | "unknown";
export type Confidence = "high" | "medium" | "low" | "unknown";

export interface LedgerPlayer {
  id: number;
  name: string;
  age: number;
  position: string;
  club: string;
  league: string;
  season: string;
  minutes: number;
  role: string;
  score: number;
  confidence: Confidence;
  coverage: string;
  market: MarketLabel;
  askLow: number | null;
  askHigh: number | null;
  playstyles: string[];
  favorited: boolean;
  queuedForCompare: boolean;
}

/**
 * Four rows chosen to exercise the states a dark theme has to survive: the
 * top and bottom of the score scale, all three market states the brief calls
 * for (inflated / high-risk / neutral), and a confidence level that disagrees
 * with its coverage level.
 */
export const LEDGER_ROWS: LedgerPlayer[] = [
  {
    id: 6,
    name: "Anton Keller",
    age: 21,
    position: "CF",
    club: "Stuttgart",
    league: "Bundesliga",
    season: "2023/24",
    minutes: 1550,
    role: "Shadow Striker",
    score: 90.0, // elite band
    confidence: "high",
    coverage: "High Data Coverage",
    market: "inflated",
    askLow: 58_520_110,
    askHigh: 87_780_165,
    playstyles: ["Box Crasher", "Finesse Finisher", "Inverted Threat"],
    favorited: true,
    queuedForCompare: false,
  },
  {
    id: 4,
    name: "Marcus Vale",
    age: 22,
    position: "RW",
    club: "Arsenal",
    league: "Premier League",
    season: "2023/24",
    minutes: 1750,
    role: "Inside Forward",
    score: 83.7, // emerald band
    confidence: "high",
    coverage: "High Data Coverage",
    market: "high-risk",
    askLow: 64_534_726,
    askHigh: 96_802_090,
    playstyles: ["Inverted Threat", "Box Crasher", "Volume Shooter"],
    favorited: false,
    queuedForCompare: true,
  },
  {
    id: 23,
    name: "Sekou Diallo",
    age: 21,
    position: "CF",
    club: "Saint-Étienne",
    league: "Ligue 2",
    season: "2023/24",
    minutes: 1300,
    role: "Shadow Striker",
    score: 68.2, // amber band
    // High coverage but only medium confidence: the two channels are sourced
    // independently and this row exists to prove the mismatch stays readable.
    confidence: "medium",
    coverage: "High Data Coverage",
    market: "inflated",
    askLow: 15_683_251,
    askHigh: 23_524_876,
    playstyles: ["Volume Shooter", "Box Crasher", "Duel Winner"],
    favorited: false,
    queuedForCompare: false,
  },
  {
    id: 21,
    name: "Owen Clarke",
    age: 21,
    position: "CM",
    club: "Leeds United",
    league: "Championship",
    season: "2023/24",
    minutes: 2300,
    role: "Ball-Winning Midfielder", // the longest role name in the registry
    score: 58.1, // amber band
    confidence: "high",
    coverage: "High Data Coverage",
    market: "fair", // the neutral market state
    askLow: 9_876_264,
    askHigh: 14_814_395,
    playstyles: ["Interceptor"],
    favorited: false,
    queuedForCompare: false,
  },
];

// ---------------------------------------------------------------------------
// Recruitment Desk excerpt — Sekou Diallo, Shadow Striker
//
// A genuinely uncertain record: Ligue 2, 1300 minutes, medium confidence, and a
// context multiplier that pulls a raw 81.2 down to 68.1. Its stored audit is
// reproduced below exactly as `GET /players/23/ratings` returns it.
// ---------------------------------------------------------------------------

export interface AuditGroup {
  key: string;
  label: string;
  /** Abstract illustrative zone, or null when the concept is not spatial. */
  territory: "att_box" | "att_third" | "mid_third" | "def_third" | null;
  shortLabel: string;
  weight: number;
  score: number | null;
  metrics: string[];
}

export const DESK = {
  player: "Sekou Diallo",
  age: 21,
  position: "CF",
  club: "Saint-Étienne",
  league: "Ligue 2",
  season: "2023/24",
  minutes: 1300,
  role: "Shadow Striker",
  /** The player's four stored ratings, best-first, exactly as the API orders them. */
  roles: ["Shadow Striker", "Pressing Forward", "Inside Forward", "Complete Forward"],
  score: 68.2,
  confidence: "medium" as Confidence,
  confidenceScore: 0.727,
  coverage: "High Data Coverage",
  rank: 2,
  explanation:
    "Rates 68.2 in this role. Strongest areas: shot volume (94), arrival carrying (94). " +
    "Context net multiplier ×0.84 (raw 81.2 → adjusted 68.1). Recent-form bonus +0.1. " +
    "Confidence: medium confidence.",
  groups: [
    {
      key: "box_presence",
      label: "Box Presence",
      territory: "att_box",
      shortLabel: "Box presence",
      weight: 0.25,
      score: 81.25,
      metrics: ["Touches in box"],
    },
    {
      key: "shot_threat",
      label: "Shot Threat",
      territory: "att_third",
      shortLabel: "Shot threat",
      weight: 0.2,
      score: 81.25,
      metrics: ["Non-penalty xG"],
    },
    {
      key: "shot_volume",
      label: "Shot Volume",
      territory: null,
      shortLabel: "Shot volume",
      weight: 0.15,
      score: 93.75,
      metrics: ["Shots"],
    },
    {
      key: "arrival_carrying",
      label: "Arrival Carrying",
      territory: "att_box",
      shortLabel: "Box arrivals",
      weight: 0.15,
      score: 93.75,
      metrics: ["Carries into final third", "Carries into penalty area"],
    },
    {
      key: "shot_creation",
      label: "Shot Creation",
      territory: null,
      shortLabel: "Shot creation",
      weight: 0.1,
      score: 81.25,
      metrics: ["Shot-creating actions"],
    },
    {
      key: "finishing_confidence",
      label: "Finishing Confidence",
      territory: null,
      shortLabel: "Finishing",
      weight: 0.1,
      score: 81.25,
      metrics: ["Finishing vs xG"],
    },
    {
      key: "possession_security",
      label: "Possession Security",
      territory: null,
      shortLabel: "Retention",
      weight: 0.05,
      score: 6.25,
      metrics: ["Dispossessed"],
    },
  ] as AuditGroup[],
  market: {
    label: "inflated" as MarketLabel,
    askLow: 15_683_251,
    askHigh: 23_524_876,
  },
};

// ---------------------------------------------------------------------------
// Comparison excerpt — Anton Keller vs Karim Nasser
//
// A real "No Shared Rated Role" result from the cohort: an ATT and a MID with no
// role in common. `GET /api/compare?player_a=6&player_b=17` returns HTTP 200
// with role_key null, an empty role_comparison, and this exact explanation.
// ---------------------------------------------------------------------------

export const COMPARE = {
  explanation:
    "No shared rated role is available for these players. " +
    "Select a role to inspect the available analysis.",
  a: {
    name: "Anton Keller",
    age: 21,
    position: "CF",
    club: "Stuttgart",
    league: "Bundesliga",
    bestRole: "Shadow Striker",
    bestScore: 90.0,
    confidence: "high" as Confidence,
    market: "inflated" as MarketLabel,
    askLow: 58_520_110,
    askHigh: 87_780_165,
    playstyles: ["Box Crasher", "Finesse Finisher"],
    context: [
      ["Minutes", "1,550"],
      ["Appearances / starts", "20 / 18"],
      ["Sample confidence", "Medium"],
      ["Translation risk", "League ‘ger_bundesliga’ strength ×1.02 (low translation risk)"],
    ],
  },
  b: {
    name: "Karim Nasser",
    age: 22,
    position: "DM",
    club: "RC Lens",
    league: "Ligue 1",
    bestRole: "Ball-Winning Midfielder",
    bestScore: 74.7,
    confidence: "high" as Confidence,
    market: "inflated" as MarketLabel,
    askLow: 28_814_441,
    askHigh: 43_221_662,
    playstyles: ["Interceptor"],
    context: [
      ["Minutes", "2,150"],
      ["Appearances / starts", "28 / 24"],
      ["Sample confidence", "High"],
      ["Translation risk", "League ‘fra_ligue_1’ strength ×1.00 (low translation risk)"],
    ],
  },
  /** Stored normalized metrics, presented as an aligned ledger. */
  stats: [
    { label: "Aerial duels won %", a: 50.0, b: 50.0 },
    { label: "Assists", a: 65.4, b: 22.7 },
    { label: "Availability", a: 19.2, b: 86.4 },
    { label: "Carries into final third", a: 73.1, b: 22.7 },
  ],
};

// ---------------------------------------------------------------------------
// Token swatches
// ---------------------------------------------------------------------------

export interface Swatch {
  name: string;
  hex: string;
  role: string;
  /** Non-surface swatches render the value as a text specimen, not a fill. */
  kind?: "surface" | "text";
}

/**
 * The proposed token table.
 *
 * These hex values MUST equal the `--pilot-*` declarations in pilot.css.
 * `dark-mode-pilot.test.tsx` parses both files and fails if they diverge, so
 * the swatch sheet can never quietly drift away from what actually renders.
 */
export const SWATCH_GROUPS: { title: string; swatches: Swatch[] }[] = [
  {
    title: "Surfaces",
    swatches: [
      { name: "--pilot-canvas", hex: "#1a2019", role: "Page background — warm charcoal" },
      { name: "--pilot-panel", hex: "#222a21", role: "Primary panel / ledger surface" },
      { name: "--pilot-panel-muted", hex: "#2b342a", role: "Subordinate fill, hover, table head" },
      { name: "--pilot-track", hex: "#3a4438", role: "Neutral bar track" },
    ],
  },
  {
    title: "Hairlines",
    swatches: [
      { name: "--pilot-line", hex: "#414c40", role: "Decorative separator" },
      { name: "--pilot-line-strong", hex: "#6e7a64", role: "Control boundary — held to 3:1" },
    ],
  },
  {
    title: "Text",
    swatches: [
      { name: "--pilot-text", hex: "#eef0e6", role: "Primary — off-white, warmed", kind: "text" },
      { name: "--pilot-text-muted", hex: "#bcc2b4", role: "Secondary", kind: "text" },
      { name: "--pilot-text-soft", hex: "#98a08f", role: "Tertiary / captions", kind: "text" },
    ],
  },
  {
    title: "Football & action",
    swatches: [
      { name: "--pilot-green", hex: "#4eb083", role: "Fills, bars, selection markers" },
      { name: "--pilot-green-text", hex: "#82d4a8", role: "Green text and links", kind: "text" },
      { name: "--pilot-green-fill", hex: "#2c7454", role: "Primary action fill" },
      { name: "--pilot-green-selected", hex: "#223a2b", role: "Selected control background" },
      { name: "--pilot-focus", hex: "#86d6ab", role: "Focus ring" },
    ],
  },
  {
    title: "Score bands",
    swatches: [
      { name: "--pilot-band-red", hex: "#f08a7d", role: "Below 40", kind: "text" },
      { name: "--pilot-band-rust", hex: "#dd8f63", role: "40 – 54.9", kind: "text" },
      { name: "--pilot-band-amber", hex: "#e2a951", role: "55 – 69.9", kind: "text" },
      { name: "--pilot-band-green", hex: "#86c9a2", role: "70 – 79.9", kind: "text" },
      { name: "--pilot-band-emerald", hex: "#3fca8f", role: "80 – 89.9", kind: "text" },
      { name: "--pilot-band-elite", hex: "#7cabf5", role: "90 and above", kind: "text" },
      { name: "--pilot-band-unknown", hex: "#98a08f", role: "Unknown — never zero", kind: "text" },
    ],
  },
  {
    title: "Status",
    swatches: [
      { name: "--pilot-amber", hex: "#e2a951", role: "Inflated market, caution", kind: "text" },
      { name: "--pilot-amber-bg", hex: "#3a2f1e", role: "Inflated / caution fill" },
      { name: "--pilot-rust", hex: "#dd8f63", role: "Lower-reliability caption", kind: "text" },
      { name: "--pilot-red", hex: "#f08a7d", role: "High-risk market, error", kind: "text" },
      { name: "--pilot-red-bg", hex: "#3a2622", role: "High-risk / critical fill" },
      { name: "--pilot-elite", hex: "#7cabf5", role: "Elite score accent", kind: "text" },
      { name: "--pilot-tag-bg", hex: "#39432f", role: "Playstyle label fill" },
    ],
  },
  {
    title: "Role Territory (the one elevated surface)",
    swatches: [
      { name: "--pilot-territory-surface", hex: "#2b342a", role: "Signature card surface" },
      { name: "--pilot-pitch-field", hex: "#27704f", role: "Pitch field — 6.0× the panel's luminance" },
      { name: "--pilot-pitch-field-alt", hex: "#29734f", role: "Solid mowing band" },
      { name: "--pilot-pitch-line", hex: "#e2eae0", role: "Pitch markings" },
      { name: "--pilot-pitch-tab", hex: "#16281d", role: "Solid plate behind a zone label" },
    ],
  },
];
