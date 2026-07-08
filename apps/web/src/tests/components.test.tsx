import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FaceStatsGrid } from "@/components/player/FaceStatsGrid";
import { MarketValuePanel } from "@/components/player/MarketValuePanel";
import { PlaystyleBadges } from "@/components/player/PlaystyleBadges";
import type { FaceStat, MarketPanel, PlaystyleBadge } from "@/lib/api/types";

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
