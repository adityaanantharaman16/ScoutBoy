import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CalibrationPanel } from "@/components/methodology/CalibrationPanel";
import { FaceStatsGrid } from "@/components/player/FaceStatsGrid";
import { MarketValuePanel } from "@/components/player/MarketValuePanel";
import { PlaystyleBadges } from "@/components/player/PlaystyleBadges";
import { PlayerSearchFilters } from "@/components/search/PlayerSearchFilters";
import { ResultCard } from "@/components/search/PlayerSearchResults";
import type { FaceStat, MarketPanel, PlayerSearchCard, PlaystyleBadge } from "@/lib/api/types";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";

const badges: PlaystyleBadge[] = [
  {
    playstyle_key: "technical_carrier",
    display_name: "Technical Carrier",
    category: "progression",
    tier: "elite",
    confidence: "high",
    is_concern: false,
    why_applied: { text: "96th percentile" },
    supporting_metrics: [],
  },
];
const concerns: PlaystyleBadge[] = [
  {
    playstyle_key: "raw_finishing",
    display_name: "Raw Finishing",
    category: "risk",
    tier: null,
    confidence: "medium",
    is_concern: true,
    why_applied: { text: "bottom tail" },
    supporting_metrics: [],
  },
];

describe("PlaystyleBadges", () => {
  it("renders positive and concern badges", () => {
    render(<PlaystyleBadges playstyles={badges} concerns={concerns} />);
    expect(screen.getByText(/Technical Carrier/)).toBeInTheDocument();
    expect(screen.getByText("Raw Finishing")).toBeInTheDocument();
  });

  it("shows honest empty state when no playstyles qualify", () => {
    render(<PlaystyleBadges playstyles={[]} concerns={[]} />);
    expect(screen.getByText(/No qualifying playstyles/i)).toBeInTheDocument();
  });
});

describe("FaceStatsGrid missing-data honesty", () => {
  it("renders 'unknown' for a null face-stat score instead of zero", () => {
    const faces: FaceStat[] = [
      { group_key: "attack", group_label: "Attack", score: null, confidence: "unknown", metrics: [] },
      { group_key: "progression", group_label: "Progression", score: 83.4, confidence: "high", metrics: [] },
    ];
    render(<FaceStatsGrid faceStats={faces} />);
    expect(screen.getAllByText("unknown").length).toBeGreaterThan(0);
    expect(screen.getByText("83.4")).toBeInTheDocument();
    expect(screen.queryByText("0.0")).not.toBeInTheDocument();
  });
});

describe("MarketValuePanel", () => {
  it("keeps the three market concepts as separate rows", () => {
    const market: MarketPanel = {
      public_value_eur: 40_000_000,
      model_value_low_eur: 30_000_000,
      model_value_high_eur: 45_000_000,
      expected_asking_low_eur: 50_000_000,
      expected_asking_high_eur: 70_000_000,
      confidence: "high",
      label: "inflated",
      manual_review_required: false,
      version: "market-v1",
      explanation: {},
    };
    render(<MarketValuePanel market={market} />);
    expect(screen.getByText("Public market value")).toBeInTheDocument();
    expect(screen.getByText("Model value range")).toBeInTheDocument();
    expect(screen.getByText("Expected asking price")).toBeInTheDocument();
    expect(screen.getByText("inflated")).toBeInTheDocument();
  });

  it("renders an honest fallback when market data is missing", () => {
    render(<MarketValuePanel market={null} />);
    expect(screen.getByText(/No market data/i)).toBeInTheDocument();
  });
});

describe("Discover filters", () => {
  it("renders Analyzed as the default scope and supports U23 quick filtering", () => {
    const onChange = vi.fn();
    render(
      <PlayerSearchFilters
        filters={{ scope: "analyzed", age_band: "all", sort: "rolefit_desc", page: 1 }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("Analyzed")).toBeInTheDocument();
    fireEvent.click(screen.getByText("U23"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "analyzed", age_band: "u23", page: 1 }),
    );
  });

  it("supports All records and High-coverage U23 scopes plus defender/GK filters", () => {
    const onChange = vi.fn();
    render(
      <PlayerSearchFilters
        filters={{ scope: "analyzed", age_band: "all", sort: "rolefit_desc", page: 1 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("All records"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ scope: "all_records" }));
    fireEvent.click(screen.getByText("High-coverage U23"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "high_coverage_u23" }),
    );
    expect(screen.getByRole("option", { name: "Defenders" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Goalkeepers" })).toBeInTheDocument();
  });
});

describe("Discover cards", () => {
  const baseCard: PlayerSearchCard = {
    id: 1,
    canonical_name: "Card Player",
    season: "2023/24",
    age: 22,
    club: "Test FC",
    league: "Test League",
    primary_position: "LW",
    position_group: "ATT",
    best_role: "inside_forward",
    best_role_display: "Inside Forward",
    best_role_score: 81.2,
    confidence: "high",
    analysis_status: "analyzed",
    evidence_status: "high_coverage",
    has_rolefit_analysis: true,
    is_high_coverage: true,
    top_playstyles: ["Technical Carrier"],
    minutes: 1200,
    represented_minutes: 1200,
    market_label: "fair",
    expected_asking_low_eur: 1000000,
    expected_asking_high_eur: 2000000,
  };

  function renderResultCard(card: PlayerSearchCard) {
    return render(
      <ScoutingStateProvider>
        <ResultCard p={card} />
      </ScoutingStateProvider>,
    );
  }

  it("renders rated scores, confidence, and high-coverage evidence", () => {
    renderResultCard(baseCard);
    expect(screen.getByText("81.2")).toBeInTheDocument();
    expect(screen.getByText("High coverage")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
  });

  it("renders profile-only players without fake scores or empty playstyles", () => {
    renderResultCard({
      ...baseCard,
      best_role: null,
      best_role_display: null,
      best_role_score: null,
      confidence: "unknown",
      analysis_status: "profile_only",
      evidence_status: "profile_only",
      has_rolefit_analysis: false,
      is_high_coverage: false,
      top_playstyles: [],
      age: null,
    });
    expect(screen.getAllByText("Profile only").length).toBeGreaterThan(0);
    expect(screen.getByTestId("profile-only-card")).toBeInTheDocument();
    expect(screen.queryByText("0.0")).not.toBeInTheDocument();
    expect(screen.queryByText(/No qualifying playstyles/)).not.toBeInTheDocument();
    expect(screen.getByText(/unknown/)).toBeInTheDocument();
  });
});

describe("CalibrationPanel", () => {
  const available = {
    available: true,
    suite_id: "rolefit_calibration",
    suite_version: "v1",
    calibration_version: "rolefit-calibration-v1",
    rating_version: "rolefit-v2",
    status: "pass",
    benchmarks: { passed: 9, warned: 0, failed: 0, inconclusive: 0, total: 9 },
    scenarios: { passed: 9, warned: 0, failed: 0, inconclusive: 0, total: 9 },
    methodology_note: "Benchmarks re-scored with the production engine.",
    pilot_coverage_limitation: "Bayer Leverkusen-centered StatsBomb slice.",
    config_hash: "abc123",
  } as unknown as NonNullable<
    import("@/lib/api/types").Methodology["calibration"]
  >;

  it("renders the available calibration summary", () => {
    render(<CalibrationPanel calibration={available} />);
    expect(screen.getByTestId("calibration-available")).toBeInTheDocument();
    expect(screen.getByText(/benchmarks 9\/9 pass/)).toBeInTheDocument();
    expect(screen.getByText(/guardrails 9\/9 pass/)).toBeInTheDocument();
    expect(screen.getByText(/Real-pilot limitation/)).toBeInTheDocument();
  });

  it("renders an honest unavailable/inconclusive state without fabricating totals", () => {
    const unavailable = {
      available: false,
      status: "inconclusive",
      benchmarks: { passed: 0, warned: 0, failed: 0, inconclusive: 0, total: 0 },
      scenarios: { passed: 0, warned: 0, failed: 0, inconclusive: 0, total: 0 },
      methodology_note: "Calibration evidence is unavailable in this environment.",
      pilot_coverage_limitation: "Bayer Leverkusen-centered StatsBomb slice.",
    } as unknown as NonNullable<import("@/lib/api/types").Methodology["calibration"]>;
    render(<CalibrationPanel calibration={unavailable} />);
    expect(screen.getByTestId("calibration-unavailable")).toBeInTheDocument();
    expect(screen.getByText(/evidence unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/inconclusive/)).toBeInTheDocument();
    expect(screen.queryByText(/9\/9 pass/)).not.toBeInTheDocument();
    expect(screen.getByText(/Real-pilot limitation/)).toBeInTheDocument();
  });

  it("handles a null calibration block", () => {
    render(<CalibrationPanel calibration={null} />);
    expect(screen.getByTestId("calibration-unavailable")).toBeInTheDocument();
  });
});
