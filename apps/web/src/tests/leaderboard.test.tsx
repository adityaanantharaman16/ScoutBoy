import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => window.localStorage.clear());
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

// ---------------------------------------------------------------------------
// Shared heart/Compare action bar
// ---------------------------------------------------------------------------
// The leaderboard used to carry its own `Shortlist` + `Compare` button pair. It now
// composes the SAME `CardActionBar` the dossier's comparable-player cards use, on
// both the desktop table and the mobile ledger — one implementation, not a third.
describe("Role leaderboard actions", () => {
  beforeEach(() => {
    useRoleLeaderboardMock.mockReturnValue({ isLoading: false, isError: false, data: board() });
  });

  /** The desktop table's bar and the mobile ledger's bar for the first row. */
  function bars() {
    const table = screen.getByTestId("leaderboard-table");
    const ledger = screen.getByTestId("leaderboard-ledger");
    return {
      desktop: within(table).getAllByTestId("card-action-bar")[0],
      mobile: within(ledger).getAllByTestId("card-action-bar")[0],
    };
  }

  it("shows the shared two-part bar on both the desktop table and the mobile ledger", () => {
    renderPage();
    const { desktop, mobile } = bars();
    for (const [surface, bar] of [["desktop", desktop], ["mobile", mobile]] as const) {
      expect(bar.className, surface).toContain("rail-box");
      expect(bar.className, surface).toContain("rail-box-inline");
      // never the Discovery radius exception
      expect(bar.className, surface).not.toContain("rail-box-discovery");
      // two equal regions, both the shared rail-action treatment
      expect(bar.children).toHaveLength(2);
      expect(within(bar).getByTestId("favorite-action").className, surface).toContain("rail-action");
      expect(within(bar).getByTestId("compare-action").className, surface).toContain("rail-action");
    }
  });

  it("leads with an outlined heart and follows with the exact word Compare", () => {
    renderPage();
    const { desktop } = bars();
    const [left, right] = Array.from(desktop.children) as HTMLElement[];
    expect(left).toHaveAttribute("data-testid", "favorite-action");
    expect(within(left).getByTestId("favorite-heart")).toHaveAttribute("data-filled", "false");
    expect(right).toHaveAttribute("data-testid", "compare-action");
    expect(right.textContent).toBe("Compare");
  });

  it("shows no retired action wording anywhere on the surface", () => {
    const { container } = renderPage();
    expect(container.textContent).not.toMatch(/Shortlisted|Shortlist|Queued|vs Compare/);
    // no plus glyph survives on an action control
    for (const action of screen.getAllByTestId(/favorite-action|compare-action/)) {
      expect(action.textContent).not.toContain("+");
    }
  });

  it("ties the heart to device-local My Favorites, with a player-specific name", () => {
    renderPage();
    const heart = within(bars().desktop).getByTestId("favorite-action");
    expect(heart).toHaveAttribute("aria-pressed", "false");
    expect(heart).toHaveAccessibleName("Add Luca Bianchi to My Favorites");

    fireEvent.click(heart);
    expect(heart).toHaveAttribute("aria-pressed", "true");
    expect(heart).toHaveAccessibleName("Remove Luca Bianchi from My Favorites");
    expect(within(heart).getByTestId("favorite-heart")).toHaveAttribute("data-filled", "true");
    expect(JSON.parse(window.localStorage.getItem("scoutboy.shortlist.v1") ?? "[]")).toContain(101);
  });

  it("ties Compare to the shared queue, with a player-specific name", () => {
    renderPage();
    const compare = within(bars().desktop).getByTestId("compare-action");
    expect(compare).toHaveAttribute("aria-pressed", "false");
    expect(compare).toHaveAccessibleName("Add Luca Bianchi to compare queue");

    fireEvent.click(compare);
    expect(compare).toHaveAttribute("aria-pressed", "true");
    expect(compare).toHaveAccessibleName("Remove Luca Bianchi from compare queue");
    // the label never becomes "Queued"
    expect(compare.textContent).toBe("Compare");
    expect(JSON.parse(window.localStorage.getItem("scoutboy.compareQueue.v1") ?? "[]")).toEqual([
      { id: 101, name: "Luca Bianchi" },
    ]);
  });

  it("shares one state across the desktop and mobile renderings of a row", () => {
    renderPage();
    const { desktop, mobile } = bars();
    fireEvent.click(within(desktop).getByTestId("favorite-action"));
    // both renderings read the same device-local state
    expect(within(mobile).getByTestId("favorite-action")).toHaveAttribute("aria-pressed", "true");
  });

  it("adds no dimension-affecting class when either action is toggled", () => {
    renderPage();
    const bar = bars().desktop;
    const before = Array.from(bar.children).map((c) => (c as HTMLElement).className);
    fireEvent.click(within(bar).getByTestId("favorite-action"));
    fireEvent.click(within(bar).getByTestId("compare-action"));
    expect(Array.from(bar.children).map((c) => (c as HTMLElement).className)).toEqual(before);
  });

  it("keeps every player's actions independent", () => {
    renderPage();
    const table = screen.getByTestId("leaderboard-table");
    const hearts = within(table).getAllByTestId("favorite-action");
    expect(hearts).toHaveLength(2);
    fireEvent.click(hearts[1]);
    expect(hearts[1]).toHaveAttribute("aria-pressed", "true");
    expect(hearts[0]).toHaveAttribute("aria-pressed", "false");
    expect(hearts[1]).toHaveAccessibleName("Remove Théo Marchand from My Favorites");
  });

  it("keeps the desktop table's columns, semantics and ranking data intact", () => {
    renderPage();
    const table = screen.getByTestId("leaderboard-table");
    expect(table.tagName.toLowerCase()).toBe("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "#",
      "Player",
      "Score",
      "RoleFit Confidence",
      "Playstyles",
      "Expected asking",
      "Actions",
    ]);
    const firstRow = within(table).getByText("Luca Bianchi").closest("tr")!;
    // the action bar lives in a real cell, and the row's data is untouched
    expect(within(firstRow).getByTestId("card-action-bar").closest("td")).not.toBeNull();
    expect(within(firstRow).getByText("83.1")).toBeInTheDocument();
    expect(within(firstRow).getByTestId("confidence-meter")).toBeInTheDocument();
    expect(within(firstRow).getByText(/€43.8M/)).toBeInTheDocument();
  });

  it("keeps rank order, hero score, confidence, market and playstyles on mobile", () => {
    renderPage();
    const ledger = screen.getByTestId("leaderboard-ledger");
    const rows = ledger.querySelectorAll("article");
    expect(rows).toHaveLength(2);
    const first = rows[0] as HTMLElement;
    expect(within(first).getByText("#1")).toBeInTheDocument();
    expect(within(first).getByTestId("score-readout")).toHaveTextContent("83.1");
    expect(within(first).getByTestId("confidence-readout")).toBeInTheDocument();
    expect(within(first).getByText(/€43.8M/)).toBeInTheDocument();
    expect(within(first).getByText(/Technical Carrier/)).toBeInTheDocument();
    // the bar is the row's last block, beneath the information
    expect(first.lastElementChild).toContainElement(within(first).getByTestId("card-action-bar"));
  });
});

// ---------------------------------------------------------------------------
// Desktop table presentation
// ---------------------------------------------------------------------------
describe("Role leaderboard desktop table presentation", () => {
  beforeEach(() => {
    useRoleLeaderboardMock.mockReturnValue({ isLoading: false, isError: false, data: board() });
  });

  it("uses the compact label variant in the fixed-width Actions column", () => {
    renderPage();
    const table = screen.getByTestId("leaderboard-table");
    const bar = within(table).getAllByTestId("card-action-bar")[0];
    expect(bar.className).toContain("rail-box-compact");
    // the cell keeps its controlled width
    expect(bar.closest("td")!.className).toContain("w-[168px]");
  });

  it("leaves the mobile ledger's bar at the default label size", () => {
    renderPage();
    const ledger = screen.getByTestId("leaderboard-ledger");
    const bar = within(ledger).getAllByTestId("card-action-bar")[0];
    expect(bar.className).not.toContain("rail-box-compact");
  });

  it("keeps every expected-asking range on one line", () => {
    renderPage();
    const table = screen.getByTestId("leaderboard-table");
    const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
    expect(bodyRows).toHaveLength(2);
    for (const tr of bodyRows) {
      const cell = tr.children[5] as HTMLElement;
      expect(cell.className, cell.textContent ?? "").toContain("whitespace-nowrap");
    }
    // including the widest pair of magnitudes, where the high end used to wrap
    const wide = bodyRows[0].children[5] as HTMLElement;
    expect(wide.textContent).toMatch(/€43\.8M.*€65\.7M/);
    // and the honest unknown, which has nothing to wrap
    expect((bodyRows[1].children[5] as HTMLElement).textContent).toBe("Unknown");
  });

  it("marks a selected Compare on its right edge, exactly as the home page does", () => {
    renderPage();
    const table = screen.getByTestId("leaderboard-table");
    const bar = within(table).getAllByTestId("card-action-bar")[0];
    const compare = within(bar).getByTestId("compare-action");
    const heart = within(bar).getByTestId("favorite-action");
    // the right-edge marker class, mirrored against the heart's left marker
    expect(compare.className).toContain("rail-action-compare");
    expect(heart.className).not.toContain("rail-action-compare");

    // and the class list does not change when either is selected
    const before = [heart.className, compare.className];
    fireEvent.click(heart);
    fireEvent.click(compare);
    expect([heart.className, compare.className]).toEqual(before);
  });
});
