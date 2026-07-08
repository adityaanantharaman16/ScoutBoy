import { describe, expect, it } from "vitest";

import {
  confidenceLabel,
  formatAge,
  formatEur,
  formatEurRange,
  formatScore,
  marketLabelColor,
  tierBadge,
  titleCase,
} from "@/lib/formatters";

describe("formatters", () => {
  it("formats euros with magnitude suffixes", () => {
    expect(formatEur(55_000_000)).toBe("€55.0M");
    expect(formatEur(750_000)).toBe("€750K");
    expect(formatEur(null)).toBe("—");
  });

  it("formats a euro range and shows Unknown when both missing", () => {
    expect(formatEurRange(1_000_000, 2_000_000)).toBe("€1.0M – €2.0M");
    expect(formatEurRange(null, null)).toBe("Unknown");
  });

  it("does not turn missing scores into zero", () => {
    expect(formatScore(null)).toBe("—");
    expect(formatScore(85.4)).toBe("85.4");
    expect(formatAge(null)).toBe("—");
  });

  it("labels confidence honestly, including unknown", () => {
    expect(confidenceLabel("high")).toMatch(/high/i);
    expect(confidenceLabel(null)).toMatch(/unknown/i);
    expect(confidenceLabel("unknown")).toMatch(/insufficient/i);
  });

  it("maps market labels and tiers to distinct classes", () => {
    expect(marketLabelColor("inflated")).not.toBe(marketLabelColor("fair"));
    expect(tierBadge("elite")).not.toBe(tierBadge("base"));
  });

  it("title-cases keys", () => {
    expect(titleCase("ball_winning_midfielder")).toBe("Ball Winning Midfielder");
  });
});
