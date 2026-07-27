import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Mock the data hook so we can render the Methodology page without a QueryClient.
vi.mock("@/lib/api/hooks", () => ({
  useMethodology: () => ({
    isLoading: false,
    isError: false,
    error: null,
    data: {
      scope: "Prototype scope: U23 attackers and midfielders in Europe",
      formula: "final = role_weighted_performance_score × ...",
      rating_version: "rolefit-v2",
      playstyle_version: "playstyles-v1",
      market_version: "market-v1",
      calibration: {
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
        config_hash: "6f25ab01e7b575c4",
      },
      context_dimensions: [],
      roles: [
        {
          role_key: "shadow_striker",
          display_name: "Shadow Striker",
          position_group: "ATT",
          description: "A late-arriving second striker.",
          groups: [
            { key: "shot_threat", weight: 0.25 },
            { key: "progressive_receiving", weight: 0.2 },
          ],
        },
      ],
      playstyles: [],
      concerns: [],
      data_sources: [],
      limitations: [],
    },
  }),
}));

// Imported after the mock is declared (vitest hoists vi.mock above imports).
import MethodologyPage from "@/app/methodology/page";

describe("Methodology chip capitalization", () => {
  it("capitalizes calibration chips while preserving technical identifiers", () => {
    render(<MethodologyPage />);
    // technical identifier + version preserved verbatim, prefix capitalized
    expect(screen.getByText("Suite rolefit_calibration v1")).toBeInTheDocument();
    expect(screen.getByText("Status: Pass")).toBeInTheDocument();
    expect(screen.getByText(/Benchmarks 9\/9 Pass/)).toBeInTheDocument();
    expect(screen.getByText(/Guardrails 9\/9 Pass/)).toBeInTheDocument();
    // config hash is untouched
    expect(screen.getByText("6f25ab01e7b575c4")).toBeInTheDocument();
  });

  it("Title-Cases role-group weight chips", () => {
    render(<MethodologyPage />);
    expect(screen.getByText("Shot Threat 25%")).toBeInTheDocument();
    expect(screen.getByText("Progressive Receiving 20%")).toBeInTheDocument();
    // the old lowercase forms are gone
    expect(screen.queryByText("shot threat 25%")).not.toBeInTheDocument();
    expect(screen.queryByText("progressive receiving 20%")).not.toBeInTheDocument();
  });
});
