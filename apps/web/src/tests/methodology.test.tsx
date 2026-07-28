import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Methodology } from "@/lib/api/types";

// Hoisted mock so we can vary the response per test without a QueryClient.
const { useMethodologyMock } = vi.hoisted(() => ({ useMethodologyMock: vi.fn() }));
vi.mock("@/lib/api/hooks", () => ({ useMethodology: useMethodologyMock }));

// Imported after the mock is declared (vitest hoists vi.mock above imports).
import MethodologyPage from "@/app/methodology/page";

function makeMethodology(over: Partial<Methodology> = {}): Methodology {
  return {
    scope: "Prototype scope: U23 attackers and midfielders in Europe",
    formula: "final = role_weighted_performance_score × league × opposition × stakes − risk_penalties",
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
      methodology_note: "Benchmarks re-scored with the production engine on committed synthetic fixtures.",
      pilot_coverage_limitation: "Bayer Leverkusen-centered StatsBomb slice.",
      config_hash: "6f25ab01e7b575c4",
    },
    context_dimensions: [{ key: "league_strength", explanation: "Adjusts for division difficulty." }],
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
      {
        role_key: "tempo_controller",
        display_name: "Tempo Controller",
        position_group: "MID",
        description: "Dictates rhythm from deep.",
        groups: [{ key: "progression", weight: 0.3 }],
      },
    ],
    playstyles: [{ key: "technical_carrier", display_name: "Technical Carrier", category: "progression", description: null }],
    concerns: [{ key: "raw_finishing", display_name: "Raw Finishing", description: null }],
    data_sources: [
      { name: "Transfermarkt", role: "Identity & market", url: "https://example.com", note: "Public snapshot." },
    ],
    limitations: ["Coverage is limited to the local pilot snapshots, not full world football."],
    last_updated: null,
    ...over,
  } as unknown as Methodology;
}

function mockData(over: Partial<Methodology> = {}) {
  useMethodologyMock.mockReturnValue({ isLoading: false, isError: false, error: null, data: makeMethodology(over) });
}

beforeEach(() => {
  useMethodologyMock.mockReset();
  mockData();
});

describe("Methodology calibration disclosure", () => {
  it("capitalizes calibration chips while preserving technical identifiers", () => {
    render(<MethodologyPage />);
    expect(screen.getByText("Suite rolefit_calibration v1")).toBeInTheDocument();
    expect(screen.getByText("Status: Pass")).toBeInTheDocument();
    expect(screen.getByText(/Benchmarks 9\/9 Pass/)).toBeInTheDocument();
    expect(screen.getByText(/Guardrails 9\/9 Pass/)).toBeInTheDocument();
    expect(screen.getByText("6f25ab01e7b575c4")).toBeInTheDocument();
    // real-pilot + synthetic-fixture honesty is visible, not hidden
    expect(screen.getByText(/Real-pilot limitation/)).toBeInTheDocument();
    expect(screen.getByText(/synthetic fixtures/)).toBeInTheDocument();
  });

  it("shows an honest inconclusive/unavailable calibration state without fabricating totals", () => {
    mockData({
      calibration: {
        available: false,
        status: "inconclusive",
        benchmarks: { passed: 0, warned: 0, failed: 0, inconclusive: 0, total: 0 },
        scenarios: { passed: 0, warned: 0, failed: 0, inconclusive: 0, total: 0 },
        methodology_note: "Calibration evidence is unavailable in this environment.",
        pilot_coverage_limitation: "Bayer Leverkusen-centered StatsBomb slice.",
      },
    } as unknown as Partial<Methodology>);
    render(<MethodologyPage />);
    // textual, non-colour-dependent state
    expect(screen.getByText("Status: Inconclusive")).toBeInTheDocument();
    expect(screen.getByText("Evidence Unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/9\/9/)).not.toBeInTheDocument();
  });
});

describe("Methodology role registry", () => {
  it("groups the role registry by position family and keeps descriptions + stored weights", () => {
    render(<MethodologyPage />);
    expect(screen.getByText("Attackers · 1")).toBeInTheDocument();
    expect(screen.getByText("Midfielders · 1")).toBeInTheDocument();
    expect(screen.getByTestId("role-registry-shadow_striker")).toBeInTheDocument();
    expect(screen.getByTestId("role-registry-tempo_controller")).toBeInTheDocument();
    // description kept
    expect(screen.getByText("A late-arriving second striker.")).toBeInTheDocument();
    // stored group weights kept, Title-Cased
    expect(screen.getByText("Shot Threat 25%")).toBeInTheDocument();
    expect(screen.getByText("Progressive Receiving 20%")).toBeInTheDocument();
  });
});

describe("Methodology document integrity", () => {
  it("contains the formula, sources, and limitations as visible (non-collapsed) content", () => {
    const { container } = render(<MethodologyPage />);
    const pre = container.querySelector("#formula pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain("final = role_weighted_performance_score");
    // version ledger preserved verbatim
    expect(screen.getByText("rolefit-v2")).toBeInTheDocument();
    expect(screen.getByText("market-v1")).toBeInTheDocument();
    // sources + limitations are present as plain text (not behind a disclosure)
    expect(screen.getByText("Transfermarkt")).toBeInTheDocument();
    expect(screen.getByText(/Coverage is limited to the local pilot snapshots/)).toBeInTheDocument();
    // static verification index is present
    expect(screen.getByTestId("methodology-contents")).toBeInTheDocument();
  });

  it("shows last_updated when supplied and an honest fallback when not", () => {
    mockData({ last_updated: "2026-07-01" });
    const { rerender } = render(<MethodologyPage />);
    expect(screen.getByText(/Last updated 2026-07-01/)).toBeInTheDocument();

    mockData({ last_updated: null });
    rerender(<MethodologyPage />);
    expect(screen.getByText(/Last updated: not provided/)).toBeInTheDocument();
  });
});
