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
  if (age == null) return "—";
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
      return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
    case "medium":
      return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    case "low":
      return "bg-orange-500/20 text-orange-300 border-orange-500/40";
    default:
      return "bg-slate-500/20 text-slate-300 border-slate-500/40";
  }
}

export function scoreColor(score: number | null | undefined): string {
  if (score == null) return "text-slate-400";
  if (score >= 85) return "text-emerald-300";
  if (score >= 70) return "text-accent-soft";
  if (score >= 55) return "text-amber-300";
  return "text-slate-300";
}

export function marketLabelColor(label: MarketLabel | string | null | undefined): string {
  switch (label) {
    case "undervalued":
      return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
    case "fair":
      return "bg-sky-500/20 text-sky-300 border-sky-500/40";
    case "inflated":
      return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    case "high-risk":
      return "bg-rose-500/20 text-rose-300 border-rose-500/40";
    default:
      return "bg-slate-500/20 text-slate-300 border-slate-500/40";
  }
}

export function tierBadge(tier: string | null | undefined): string {
  switch (tier) {
    case "elite":
      return "bg-fuchsia-500/25 text-fuchsia-200 border-fuchsia-500/50";
    case "plus":
      return "bg-accent/20 text-accent-soft border-accent/40";
    default:
      return "bg-slate-600/30 text-slate-200 border-slate-500/40";
  }
}

export function titleCase(s: string): string {
  return s.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
