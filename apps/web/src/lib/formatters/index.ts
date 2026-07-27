import type { Confidence, MarketLabel, PlaystyleBadge, WhyApplied } from "@/lib/api/types";

/** Safely read the human explanation out of a badge's free-form why_applied JSON. */
export function whyText(badge: PlaystyleBadge): string {
  return String((badge.why_applied as WhyApplied)?.text ?? "");
}

export function formatEur(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `€${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `€${Math.round(value / 1_000)}K`;
  return `€${Math.round(value)}`;
}

export function formatEurRange(
  low: number | null | undefined,
  high: number | null | undefined,
): string {
  if (low == null && high == null) return "Unknown";
  return `${formatEur(low)} – ${formatEur(high)}`;
}

export function formatScore(score: number | null | undefined): string {
  if (score == null) return "—";
  return score.toFixed(1);
}

export function formatAge(age: number | null | undefined): string {
  if (age == null) return "unknown";
  return `${Math.floor(age)}`;
}

export function confidenceLabel(c: Confidence | string | null | undefined): string {
  switch (c) {
    case "high":
      return "High confidence";
    case "medium":
      return "Medium confidence";
    case "low":
      return "Low confidence";
    default:
      return "Unknown — insufficient data";
  }
}

export function confidenceColor(c: Confidence | string | null | undefined): string {
  switch (c) {
    case "high":
      return "bg-[#e9f0ea] text-pitch-dark border-pitch";
    case "medium":
      return "bg-[#f6ecd7] text-accent-amber border-accent-amber";
    case "low":
      return "bg-[#f2e3dc] text-accent-rust border-accent-rust";
    default:
      return "bg-paper-muted text-ink-muted border-line-strong";
  }
}

// Authoritative frontend score scale (0–100). One deterministic band function
// drives both text colour and bar fill so their semantics never diverge.
// The scale walks red → rust → amber → clear green → deep green → elite blue,
// with a neutral grey reserved for missing (unknown, not a low score).
//   < 40        red
//   40–54.99    rust / orange
//   55–69.99    amber / gold
//   70–79.99    clear green
//   80–89.99    richer chromatic green moving toward blue (emerald)
//   >= 90       elite blue (#2e74e6)
//   null        neutral ink-soft grey (unknown)
export type ScoreBand = "unknown" | "red" | "rust" | "amber" | "green" | "deep" | "elite";

export function scoreBand(score: number | null | undefined): ScoreBand {
  if (score == null || Number.isNaN(score)) return "unknown";
  if (score < 40) return "red";
  if (score < 55) return "rust";
  if (score < 70) return "amber";
  if (score < 80) return "green";
  if (score < 90) return "deep";
  return "elite";
}

// Text colour classes. 80–89 uses a chromatic emerald (`pitch.mid`) rather than
// the near-black `pitch.dark`, so strong scores read clearly green; 90+ keeps
// the canonical elite blue. All are AA-legible on warm paper.
const BAND_TEXT: Record<ScoreBand, string> = {
  unknown: "text-ink-soft",
  red: "text-accent-red",
  rust: "text-accent-rust",
  amber: "text-accent-amber",
  green: "text-pitch",
  deep: "text-pitch-mid",
  elite: "text-elite",
};

const BAND_BAR: Record<ScoreBand, string> = {
  unknown: "bg-line-strong",
  red: "bg-accent-red",
  rust: "bg-accent-rust",
  amber: "bg-accent-amber",
  green: "bg-pitch",
  deep: "bg-pitch-mid",
  elite: "bg-elite",
};

export function scoreColor(score: number | null | undefined): string {
  return BAND_TEXT[scoreBand(score)];
}

/** Bar/fill colour class matching {@link scoreColor} for the same value. */
export function scoreBarClass(score: number | null | undefined): string {
  return BAND_BAR[scoreBand(score)];
}

export function marketLabelColor(label: MarketLabel | string | null | undefined): string {
  switch (label) {
    case "undervalued":
      return "bg-[#e9f0ea] text-pitch-dark border-pitch";
    case "fair":
      return "bg-paper-muted text-ink-muted border-line-strong";
    case "inflated":
      return "bg-[#f6ecd7] text-accent-amber border-accent-amber";
    case "high-risk":
      return "bg-[#f4e8e3] text-accent-red border-accent-red";
    default:
      return "bg-paper-muted text-ink-muted border-line-strong";
  }
}

export function tierBadge(tier: string | null | undefined): string {
  switch (tier) {
    case "elite":
      return "bg-[#e9f0ea] text-pitch-dark border-pitch";
    case "plus":
      return "bg-paper-panel text-pitch-dark border-pitch";
    default:
      return "bg-paper-muted text-ink-muted border-line-strong";
  }
}

export function titleCase(s: string): string {
  return s.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---- centralized enum → display labels (never mutate backend enums) ----

/** Short confidence word for badges/labels: High / Medium / Low / Unknown. */
export function confidenceText(c: Confidence | string | null | undefined): string {
  switch (c) {
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    default:
      return "Unknown";
  }
}

/** Market label for chips: Undervalued / Fair / Inflated / High-Risk / Unknown. */
export function marketLabelText(label: MarketLabel | string | null | undefined): string {
  switch (label) {
    case "undervalued":
      return "Undervalued";
    case "fair":
      return "Fair";
    case "inflated":
      return "Inflated";
    case "high-risk":
      return "High-Risk";
    default:
      return "Unknown";
  }
}

/** Evidence-status label: coverage availability, distinct from RoleFit confidence. */
export function evidenceStatusText(status: string | null | undefined): string {
  switch (status) {
    case "high_coverage":
      return "High Coverage";
    case "analyzed_limited":
      return "Analyzed, Limited Coverage";
    case "profile_only":
      return "Profile Only";
    default:
      return status ? titleCase(status) : "Unknown";
  }
}

/** Playstyle tier suffix, capitalized (Elite / Plus / …); empty for base/none. */
export function tierText(tier: string | null | undefined): string {
  if (!tier || tier === "base") return "";
  return titleCase(tier);
}
