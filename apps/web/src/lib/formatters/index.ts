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

export function scoreColor(score: number | null | undefined): string {
  if (score == null) return "text-ink-soft";
  if (score >= 85) return "text-pitch-dark";
  if (score >= 70) return "text-pitch-sage";
  if (score >= 55) return "text-accent-amber";
  return "text-accent-rust";
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
