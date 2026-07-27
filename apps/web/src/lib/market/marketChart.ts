// Presentation-only helpers for the Market valuation chart.
//
// These derive axis bounds, tick marks, and a public/model/asking comparison
// purely for DISPLAY from values the market model already produced. They never
// compute or adjust a valuation — no market-model logic lives here.

import type { MarketPanel } from "@/lib/api/types";
import { formatEur } from "@/lib/formatters";

export function num(x: number | null | undefined): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

export type RangeKind = "both" | "from" | "upto" | "none";

export function rangeKind(low: number | null | undefined, high: number | null | undefined): RangeKind {
  const l = num(low);
  const h = num(high);
  if (l != null && h != null) return "both";
  if (l != null) return "from";
  if (h != null) return "upto";
  return "none";
}

/**
 * Partial-aware range text. Preserves whichever endpoint is genuinely present
 * and never renders a missing endpoint (no "€0"): both → "€X – €Y", low-only →
 * "From €X", high-only → "Up to €Y", neither → "Unknown".
 */
export function marketRangeText(low: number | null | undefined, high: number | null | undefined): string {
  const l = num(low);
  const h = num(high);
  switch (rangeKind(l, h)) {
    case "both":
      return `${formatEur(l)} – ${formatEur(h)}`;
    case "from":
      return `From ${formatEur(l)}`;
    case "upto":
      return `Up to ${formatEur(h)}`;
    default:
      return "Unknown";
  }
}

/** Every present numeric value, used only to size the shared axis. */
export function marketValues(market: MarketPanel): number[] {
  return [
    market.public_value_eur,
    market.model_value_low_eur,
    market.model_value_high_eur,
    market.expected_asking_low_eur,
    market.expected_asking_high_eur,
  ]
    .map(num)
    .filter((v): v is number => v != null);
}

export interface Axis {
  min: number;
  max: number;
  ticks: number[];
}

/**
 * A deterministic "nice" axis covering [min, max] with ~4 rounded ticks.
 * Never returns a zero-width span. Display-only.
 */
export function niceAxis(min: number, max: number): Axis {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const rawStep = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const axisMin = Math.floor(min / step) * step;
  const axisMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = axisMin; v <= axisMax + step * 1e-6; v += step) {
    ticks.push(Math.round(v));
  }
  return { min: axisMin, max: axisMax, ticks };
}

/** Fractional position (0..1) of a euro value on the axis. */
export function axisPos(value: number, axis: Axis): number {
  if (axis.max === axis.min) return 0.5;
  return (value - axis.min) / (axis.max - axis.min);
}

/** Compact euro axis label, e.g. 42_000_000 -> "€42M". */
export function axisEurLabel(v: number): string {
  if (Math.abs(v) >= 1_000_000) {
    const m = v / 1_000_000;
    return `€${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (Math.abs(v) >= 1_000) return `€${Math.round(v / 1_000)}K`;
  return `€${Math.round(v)}`;
}

/**
 * Comparison gap between the expected-ask FLOOR and the model CEILING.
 * Only defined when both inputs exist. Positive = ask opens above the model's
 * high end; negative = ask opens below it. This is a transparent comparison of
 * two existing values, not a new valuation.
 */
export function askingVsModelGap(market: MarketPanel): number | null {
  const askLow = num(market.expected_asking_low_eur);
  const modelHigh = num(market.model_value_high_eur);
  if (askLow == null || modelHigh == null) return null;
  return askLow - modelHigh;
}
