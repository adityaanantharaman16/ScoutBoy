import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuditAccordion } from "@/components/player/AuditAccordion";
import { MarketValuePanel } from "@/components/player/MarketValuePanel";
import { RoleRatingsPanel } from "@/components/player/RoleRatingsPanel";
import type { AuditBreakdown, MarketPanel, RoleRatingSummary } from "@/lib/api/types";
import {
  confidenceText,
  evidenceStatusText,
  marketLabelText,
  scoreBand,
  scoreBarClass,
  scoreColor,
  tierText,
} from "@/lib/formatters";
import { askingVsModelGap, axisPos, marketRangeText, niceAxis } from "@/lib/market/marketChart";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";

describe("score scale boundaries", () => {
  it("assigns the documented band at every boundary", () => {
    expect(scoreBand(39.99)).toBe("red");
    expect(scoreBand(40)).toBe("rust");
    expect(scoreBand(54.99)).toBe("rust");
    expect(scoreBand(55)).toBe("amber");
    expect(scoreBand(69.99)).toBe("amber");
    expect(scoreBand(70)).toBe("green");
    expect(scoreBand(79.99)).toBe("green");
    expect(scoreBand(80)).toBe("deep");
    expect(scoreBand(89.99)).toBe("deep");
    expect(scoreBand(90)).toBe("elite");
  });

  it("handles out-of-range and missing values", () => {
    expect(scoreBand(150)).toBe("elite");
    expect(scoreBand(-5)).toBe("red");
    expect(scoreBand(0)).toBe("red");
    expect(scoreBand(null)).toBe("unknown");
    expect(scoreBand(undefined)).toBe("unknown");
    expect(scoreBand(Number.NaN)).toBe("unknown");
  });

  it("maps 70+ to clear green, 80-89 to chromatic emerald, and 90+ to elite blue", () => {
    expect(scoreColor(75)).toBe("text-pitch");
    // 80-89 is a chromatic emerald (pitch.mid), NOT the near-black pitch.dark
    expect(scoreColor(85)).toBe("text-pitch-mid");
    expect(scoreColor(85)).not.toBe("text-pitch-dark");
    // 90+ is elite BLUE, but the darker `elite.ink` rather than the brighter
    // `elite`. Changed in the M7 accessibility closeout: `elite` (#2e74e6)
    // measures 3.94:1 on warm paper, which fails WCAG 2.2 SC 1.4.3 at the sizes
    // this class actually renders — the leaderboard's `text-sm` cell, the
    // comparison metric column, `ScoreReadout size="sm"`, and the role tab's
    // 18px (below the 18.66px bold large-text cut-off). `elite.ink` (#1f57b0)
    // measures 6.15:1 and passes at every size; the palette already defined it
    // as "a darker companion for small text".
    expect(scoreColor(92)).toBe("text-elite-ink");
    // Still blue, and still distinct from every other band.
    expect(scoreColor(92)).not.toBe(scoreColor(85));
    expect(scoreColor(null)).toBe("text-ink-soft");
    // 80-89 is distinct from the 70-79 green and the 90+ blue
    expect(scoreColor(85)).not.toBe(scoreColor(75));
    expect(scoreColor(85)).not.toBe(scoreColor(92));
    // bar colour stays coherent with text
    expect(scoreBarClass(85)).toBe("bg-pitch-mid");
    expect(scoreBarClass(92)).toBe("bg-elite");
    expect(scoreBarClass(45)).toBe("bg-accent-rust");
    expect(scoreBarClass(75)).toBe("bg-pitch");
  });
});

describe("market chart helpers", () => {
  it("produces a deterministic nice axis covering the data", () => {
    const a1 = niceAxis(20_000_000, 87_800_000);
    const a2 = niceAxis(20_000_000, 87_800_000);
    expect(a1).toEqual(a2);
    expect(a1.min).toBeLessThanOrEqual(20_000_000);
    expect(a1.max).toBeGreaterThanOrEqual(87_800_000);
    expect(a1.ticks.length).toBeGreaterThanOrEqual(3);
    expect(axisPos(a1.min, a1)).toBeCloseTo(0);
    expect(axisPos(a1.max, a1)).toBeCloseTo(1);
  });

  it("never returns a zero-width span for a single value", () => {
    const a = niceAxis(20_000_000, 20_000_000);
    expect(a.max).toBeGreaterThan(a.min);
  });

  it("computes the asking-vs-model gap only when both inputs exist", () => {
    const base = {
      public_value_eur: 20_000_000,
      model_value_low_eur: 40_000_000,
      model_value_high_eur: 54_600_000,
      expected_asking_low_eur: 58_500_000,
      expected_asking_high_eur: 87_800_000,
      confidence: "high",
      label: "inflated",
      manual_review_required: false,
      version: "market-v1",
      explanation: {},
    } as unknown as MarketPanel;
    expect(askingVsModelGap(base)).toBeCloseTo(3_900_000);
    expect(askingVsModelGap({ ...base, model_value_high_eur: null } as MarketPanel)).toBeNull();
    expect(askingVsModelGap({ ...base, expected_asking_low_eur: null } as MarketPanel)).toBeNull();
  });
});

function market(overrides: Partial<MarketPanel> = {}): MarketPanel {
  return {
    public_value_eur: 20_000_000,
    model_value_low_eur: 40_000_000,
    model_value_high_eur: 54_600_000,
    expected_asking_low_eur: 58_500_000,
    expected_asking_high_eur: 87_800_000,
    confidence: "high",
    label: "inflated",
    manual_review_required: false,
    version: "market-v1",
    explanation: {},
    ...overrides,
  } as unknown as MarketPanel;
}

describe("MarketValuePanel", () => {
  it("keeps the three reads as distinct labelled values and a chart", () => {
    render(<MarketValuePanel market={market()} />);
    expect(screen.getByText("Public market value")).toBeInTheDocument();
    expect(screen.getByText("Model value range")).toBeInTheDocument();
    expect(screen.getByText("Expected asking price")).toBeInTheDocument();
    expect(screen.getByText("Inflated")).toBeInTheDocument();
    expect(screen.getByTestId("market-chart")).toBeInTheDocument();
    // interpretation from the transparent gap comparison
    expect(screen.getByText(/above the model’s high end/i)).toBeInTheDocument();
  });

  it("describes the reads as distinct — never statistically independent", () => {
    render(<MarketValuePanel market={market()} />);
    const lead = screen.getByTestId("market-lead");
    expect(lead).toHaveTextContent(
      "Public value, model range, and expected ask on a shared euro axis.",
    );
    expect(lead.textContent ?? "").not.toMatch(/independent/i);
  });

  it("labels missing reads as unknown and never plots them at zero", () => {
    render(
      <MarketValuePanel
        market={market({
          model_value_low_eur: null,
          model_value_high_eur: null,
          expected_asking_low_eur: null,
          expected_asking_high_eur: null,
        })}
      />,
    );
    // model + asking legend values read Unknown (not €0)
    expect(screen.getAllByText(/Unknown/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("€0")).not.toBeInTheDocument();
    // no gap interpretation when model ceiling is unknown
    expect(screen.queryByText(/model’s high end/i)).not.toBeInTheDocument();
  });

  it("surfaces the manual-review guardrail prominently", () => {
    render(<MarketValuePanel market={market({ manual_review_required: true })} />);
    expect(screen.getByTestId("market-review")).toBeInTheDocument();
  });

  it("renders an honest fallback when market data is missing", () => {
    render(<MarketValuePanel market={null} />);
    expect(screen.getByText(/No market data/i)).toBeInTheDocument();
  });
});

describe("enum → display label normalization", () => {
  it("capitalizes confidence, market, evidence, and tier labels", () => {
    expect(confidenceText("high")).toBe("High");
    expect(confidenceText("medium")).toBe("Medium");
    expect(confidenceText(null)).toBe("Unknown");
    expect(marketLabelText("inflated")).toBe("Inflated");
    expect(marketLabelText("high-risk")).toBe("High-Risk");
    expect(marketLabelText(null)).toBe("Unknown");
    expect(evidenceStatusText("high_coverage")).toBe("High Coverage");
    expect(evidenceStatusText("profile_only")).toBe("Profile Only");
    expect(tierText("elite")).toBe("Elite");
    expect(tierText("base")).toBe("");
    expect(tierText(null)).toBe("");
  });
});

describe("Complete Audit Trail readable role names", () => {
  it("renders role and group keys as Title Case, with capitalized controls", () => {
    const audits: AuditBreakdown[] = [
      {
        role_key: "complete_forward",
        metric_breakdown: {
          raw_score: 66,
          groups: [
            { key: "shot_threat", weight: 0.2, normalized_weight: 0.2, group_score: 91, metrics: [] },
          ],
        },
        context_breakdown: {},
        confidence_breakdown: {},
        penalties: { total: 0, items: [] },
        explanation_text: "",
      } as unknown as AuditBreakdown,
    ];
    render(<AuditAccordion audits={audits} />);
    expect(screen.getByText("Complete Forward")).toBeInTheDocument();
    expect(screen.getByText("Why This Score")).toBeInTheDocument();
    expect(screen.queryByText("complete forward")).not.toBeInTheDocument();
  });
});

describe("partial market ranges", () => {
  it("preserves whichever endpoint is present and never emits €0", () => {
    expect(marketRangeText(40_000_000, 54_600_000)).toBe("€40.0M – €54.6M");
    expect(marketRangeText(40_000_000, null)).toBe("From €40.0M");
    expect(marketRangeText(null, 54_600_000)).toBe("Up to €54.6M");
    expect(marketRangeText(null, null)).toBe("Unknown");
    for (const t of [
      marketRangeText(40_000_000, null),
      marketRangeText(null, 54_600_000),
      marketRangeText(null, null),
    ]) {
      expect(t).not.toMatch(/€0\b/);
    }
  });

  it("both endpoints present → full interval, chart, no €0", () => {
    render(<MarketValuePanel market={market()} />);
    expect(screen.getByText(/€40\.0M – €54\.6M/)).toBeInTheDocument();
    expect(screen.getByText(/€58\.5M – €87\.8M/)).toBeInTheDocument();
    expect(screen.getByTestId("market-chart")).toBeInTheDocument();
    expect(screen.queryByText("€0")).not.toBeInTheDocument();
  });

  it("model low-only → 'From …' lower bound, chart, not wholly unknown, no €0", () => {
    render(<MarketValuePanel market={market({ model_value_high_eur: null })} />);
    expect(screen.getByText("From €40.0M")).toBeInTheDocument();
    expect(screen.getByTestId("market-chart")).toBeInTheDocument();
    expect(screen.queryByText("€0")).not.toBeInTheDocument();
  });

  it("model high-only → 'Up to …' upper bound, chart, not wholly unknown, no €0", () => {
    render(<MarketValuePanel market={market({ model_value_low_eur: null })} />);
    expect(screen.getByText("Up to €54.6M")).toBeInTheDocument();
    expect(screen.getByTestId("market-chart")).toBeInTheDocument();
    expect(screen.queryByText("€0")).not.toBeInTheDocument();
  });

  it("expected-ask low-only → 'From …' lower bound, chart, not wholly unknown, no €0", () => {
    render(<MarketValuePanel market={market({ expected_asking_high_eur: null })} />);
    expect(screen.getByText("From €58.5M")).toBeInTheDocument();
    expect(screen.getByTestId("market-chart")).toBeInTheDocument();
    expect(screen.queryByText("€0")).not.toBeInTheDocument();
  });

  it("expected-ask high-only → 'Up to …' upper bound, chart, not wholly unknown, no €0", () => {
    render(<MarketValuePanel market={market({ expected_asking_low_eur: null })} />);
    expect(screen.getByText("Up to €87.8M")).toBeInTheDocument();
    expect(screen.getByTestId("market-chart")).toBeInTheDocument();
    expect(screen.queryByText("€0")).not.toBeInTheDocument();
  });

  it("both endpoints missing → 'Unknown', no €0 (chart still present via public value)", () => {
    render(
      <MarketValuePanel market={market({ model_value_low_eur: null, model_value_high_eur: null })} />,
    );
    // the model legend reads Unknown, never €0
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(screen.getByTestId("market-chart")).toBeInTheDocument();
    expect(screen.queryByText("€0")).not.toBeInTheDocument();
  });
});

describe("RoleRatingsPanel leaderboard link", () => {
  it("uses clear wording and a role-specific accessible name", () => {
    const ratings: RoleRatingSummary[] = [
      {
        role_key: "shadow_striker",
        display_name: "Shadow Striker",
        final_score: 90,
        raw_score: 87,
        context_adjusted_score: 88,
        confidence: "high",
        rank_in_peer_group: 1,
        is_best: true,
      } as unknown as RoleRatingSummary,
    ];
    render(
      <ScoutingStateProvider>
        <RoleRatingsPanel ratings={ratings} />
      </ScoutingStateProvider>,
    );
    const link = screen.getByRole("link", { name: /View the Shadow Striker leaderboard/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/roles/shadow_striker");
    expect(within(link).getByText(/View leaderboard/i)).toBeInTheDocument();
    expect(screen.queryByText(/^board$/)).not.toBeInTheDocument();
  });
});
