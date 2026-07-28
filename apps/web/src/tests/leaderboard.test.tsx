import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RoleLeaderboard, RoleRankingRow } from "@/lib/api/types";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";

// next/navigation drives the role param + selector; mock it so the page renders.
vi.mock("next/navigation", () => ({
  useParams: () => ({ roleId: "touchline_winger" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/roles/touchline_winger",
  useSearchParams: () => new URLSearchParams(),
}));

const { useRoleLeaderboardMock } = vi.hoisted(() => ({ useRoleLeaderboardMock: vi.fn() }));
vi.mock("@/lib/api/hooks", () => ({ useRoleLeaderboard: useRoleLeaderboardMock }));

import RoleLeaderboardPage from "@/app/roles/[roleId]/page";

function row(over: Partial<RoleRankingRow> = {}): RoleRankingRow {
  return {
    rank: 1,
    player_id: 101,
    canonical_name: "Luca Bianchi",
    age: 22,
    club: "Atalanta",
    league: "Serie A",
    final_score: 83.1,
    confidence: "high",
    top_playstyles: ["Technical Carrier", "Touchline Isolator"],
    expected_asking_low_eur: 43_800_000,
    expected_asking_high_eur: 65_700_000,
    ...over,
  } as RoleRankingRow;
}

function board(over: Partial<RoleLeaderboard> = {}): RoleLeaderboard {
  return {
    role_key: "touchline_winger",
    display_name: "Touchline Winger",
    position_group: "ATT",
    description: "Receives wide, attacks the fullback 1v1, and stretches the pitch.",
    season: "2023/24",
    rating_version: "rolefit-v2",
    total: 6,
    rows: [row(), row({ rank: 2, player_id: 102, canonical_name: "Théo Marchand", final_score: 66.9, expected_asking_low_eur: null, expected_asking_high_eur: null })],
    ...over,
  } as unknown as RoleLeaderboard;
}

const renderPage = () => render(<ScoutingStateProvider><RoleLeaderboardPage /></ScoutingStateProvider>);

afterEach(() => useRoleLeaderboardMock.mockReset());

describe("Role leaderboard masthead + ledger", () => {
  it("renders the role masthead with cohort context from the underused API fields", () => {
    useRoleLeaderboardMock.mockReturnValue({ isLoading: false, isError: false, data: board() });
    renderPage();
    expect(screen.getByRole("heading", { name: "Touchline Winger" })).toBeInTheDocument();
    expect(screen.getByText(/Receives wide, attacks the fullback/)).toBeInTheDocument();
    const meta = screen.getByTestId("page-meta");
    expect(meta).toHaveTextContent("ATT");
    expect(meta).toHaveTextContent("6 rated players");
    expect(meta).toHaveTextContent("2023/24");
    expect(meta).toHaveTextContent("rating rolefit-v2");
  });

  it("labels confidence as 'RoleFit Confidence' (not 'Conf') and keeps it separate from rank/score", () => {
    useRoleLeaderboardMock.mockReturnValue({ isLoading: false, isError: false, data: board() });
    renderPage();
    const table = screen.getByTestId("leaderboard-table");
    expect(within(table).getByText("RoleFit Confidence")).toBeInTheDocument();
    // rank, score, and confidence are separate columns
    const firstRow = within(table).getByText("Luca Bianchi").closest("tr")!;
    expect(within(firstRow).getByText("1")).toBeInTheDocument();
    expect(within(firstRow).getByText("83.1")).toBeInTheDocument();
    expect(within(firstRow).getByTestId("confidence-meter")).toBeInTheDocument();
  });

  it("renders a missing asking range as Unknown, never €0", () => {
    useRoleLeaderboardMock.mockReturnValue({ isLoading: false, isError: false, data: board() });
    renderPage();
    const table = screen.getByTestId("leaderboard-table");
    const secondRow = within(table).getByText("Théo Marchand").closest("tr")!;
    expect(within(secondRow).getByText("Unknown")).toBeInTheDocument();
    expect(within(secondRow).queryByText("€0")).not.toBeInTheDocument();
  });

  it("shows an honest empty state when the role has no rated players", () => {
    useRoleLeaderboardMock.mockReturnValue({ isLoading: false, isError: false, data: board({ rows: [], total: 0 }) });
    renderPage();
    expect(screen.getByText(/No rated players for this role/)).toBeInTheDocument();
  });

  it("keeps the masthead identity while loading (structural skeleton, not a blank page)", () => {
    useRoleLeaderboardMock.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    renderPage();
    // page identity: the role selector + title fallback remain
    expect(screen.getByTestId("role-select")).toBeInTheDocument();
    expect(screen.getByTestId("ledger-skeleton")).toBeInTheDocument();
  });
});
