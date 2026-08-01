import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AGE_BANDS, SEARCH_SCOPES } from "@/lib/constants";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";
import type { PlayerSearchCard } from "@/lib/api/types";

// ---- routing + data are mocked so the discovery surface renders standalone ----
const { replaceMock, paramsRef, usePlayerSearchMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  paramsRef: { current: new URLSearchParams() },
  usePlayerSearchMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => paramsRef.current,
}));
vi.mock("@/lib/api/hooks", () => ({ usePlayerSearch: usePlayerSearchMock }));

import { SearchExperience } from "@/components/search/SearchExperience";

function card(over: Partial<PlayerSearchCard> = {}): PlayerSearchCard {
  return {
    id: 1,
    canonical_name: "Anton Keller",
    season: "2023/24",
    age: 21,
    club: "Stuttgart",
    league: "Bundesliga",
    primary_position: "CF",
    position_group: "ATT",
    best_role: "shadow_striker",
    best_role_display: "Shadow Striker",
    best_role_score: 88.4,
    confidence: "high",
    analysis_status: "analyzed",
    evidence_status: "high_coverage",
    has_rolefit_analysis: true,
    is_high_coverage: true,
    top_playstyles: ["Technical Carrier"],
    minutes: 1800,
    represented_minutes: 1800,
    market_label: "inflated",
    expected_asking_low_eur: 58_500_000,
    expected_asking_high_eur: 87_800_000,
    ...over,
  } as PlayerSearchCard;
}

function mountDiscovery(search = "") {
  paramsRef.current = new URLSearchParams(search);
  return render(
    <ScoutingStateProvider>
      <SearchExperience />
    </ScoutingStateProvider>,
  );
}

/** The single URL the last filter interaction pushed. */
function lastUrl(): string {
  return replaceMock.mock.calls.at(-1)![0] as string;
}

beforeEach(() => {
  replaceMock.mockReset();
  usePlayerSearchMock.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { items: [card(), card({ id: 2, canonical_name: "Jack Whitmore" })], total: 37, page: 2, page_size: 12, total_pages: 4 },
  });
});

// ---------------------------------------------------------------------------
// Compact filter rail — native selectors, unchanged semantics
// ---------------------------------------------------------------------------
describe("Discovery filter rail", () => {
  it("exposes Analysis scope as an accessible selector carrying every existing option", () => {
    mountDiscovery();
    const scope = screen.getByLabelText("Analysis scope");
    expect(scope.tagName.toLowerCase()).toBe("select");
    expect(scope).toBe(screen.getByTestId("scope-filter"));
    expect(
      Array.from((scope as HTMLSelectElement).options).map((o) => [o.value, o.text]),
    ).toEqual(SEARCH_SCOPES.map((s) => [s.key, s.label]));
    expect(scope).toHaveValue("analyzed");
  });

  it("exposes Age band as an accessible selector carrying every existing option", () => {
    mountDiscovery();
    const age = screen.getByLabelText("Age band");
    expect(age.tagName.toLowerCase()).toBe("select");
    expect(age).toBe(screen.getByTestId("age-band-filter"));
    expect(
      Array.from((age as HTMLSelectElement).options).map((o) => [o.value, o.text]),
    ).toEqual(AGE_BANDS.map((b) => [b.key, b.label]));
    expect(age).toHaveValue("all");
  });

  it("shows the selected scope's explanation as helper text and updates it with the scope", () => {
    mountDiscovery();
    expect(screen.getByTestId("scope-description")).toHaveTextContent(
      "Players with at least one RoleFit rating.",
    );

    mountDiscovery("scope=high_coverage_u23");
    expect(screen.getAllByTestId("scope-description").at(-1)).toHaveTextContent(
      "U23 attackers and midfielders meeting ScoutBoy coverage thresholds.",
    );
  });

  it("keeps the helper text out of the selector's accessible name", () => {
    mountDiscovery();
    // described-by, not labelled-by: the name stays the short control label
    expect(screen.getByTestId("scope-filter")).toHaveAccessibleName("Analysis scope");
    expect(screen.getByTestId("scope-filter")).toHaveAccessibleDescription(
      "Players with at least one RoleFit rating.",
    );
  });

  it("writes the scope to the URL and resets pagination", () => {
    mountDiscovery("page=3");
    fireEvent.change(screen.getByTestId("scope-filter"), { target: { value: "all_records" } });
    expect(lastUrl()).toContain("scope=all_records");
    expect(lastUrl()).not.toContain("page=");
  });

  it("writes the age band to the URL and resets pagination", () => {
    mountDiscovery("page=3");
    fireEvent.change(screen.getByTestId("age-band-filter"), { target: { value: "u23" } });
    expect(lastUrl()).toContain("age_band=u23");
    expect(lastUrl()).not.toContain("page=");
  });

  it("drops the scope and age band from the URL when returned to their defaults", () => {
    mountDiscovery("scope=all_records&age_band=u23");
    fireEvent.change(screen.getByTestId("scope-filter"), { target: { value: "analyzed" } });
    expect(lastUrl()).not.toContain("scope=");
    expect(lastUrl()).toContain("age_band=u23");
  });

  it("keeps every other filter as it was, with unchanged semantics", () => {
    mountDiscovery();
    expect(screen.getByTestId("search-input").tagName.toLowerCase()).toBe("input");
    for (const testId of ["position-group-filter", "role-filter"]) {
      expect(screen.getByTestId(testId).tagName.toLowerCase()).toBe("select");
    }
    for (const label of ["Min minutes", "Min RoleFit"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("type", "number");
    }
    expect(screen.getByLabelText("Sort").tagName.toLowerCase()).toBe("select");

    fireEvent.change(screen.getByTestId("role-filter"), { target: { value: "inside_forward" } });
    expect(lastUrl()).toContain("role=inside_forward");
    fireEvent.change(screen.getByLabelText("Min minutes"), { target: { value: "900" } });
    expect(lastUrl()).toContain("min_minutes=900");
  });

  it("is sticky only from the desktop breakpoint up", () => {
    mountDiscovery();
    const column = screen.getByTestId("filter-column");
    expect(column.className).toContain("lg:sticky");
    expect(column.className).toContain("lg:top-4");
    // never sticky below lg: no unprefixed sticky/fixed utility
    expect(column.className).not.toMatch(/(?:^|\s)(?:sticky|fixed)(?=\s|$)/);
  });
});

// ---------------------------------------------------------------------------
// Filter / ledger alignment
// ---------------------------------------------------------------------------
describe("Discovery results ledger header", () => {
  it("renders the result summary inside the bordered ledger, not above it", () => {
    mountDiscovery();
    const ledger = screen.getByTestId("results-ledger");
    const summary = screen.getByTestId("result-count");
    expect(ledger).toContainElement(summary);
    expect(ledger.className).toContain("border");
    // it is the ledger's own header row, ahead of every player row
    expect(ledger.firstElementChild).toBe(summary);
    expect(within(ledger).getAllByTestId("result-row").length).toBe(2);
  });

  it("keeps the full summary — count, scope, age band, season, page and Ranked ledger", () => {
    mountDiscovery();
    const summary = screen.getByTestId("result-count");
    expect(summary).toHaveTextContent("37 players");
    expect(summary).toHaveTextContent("Analyzed");
    expect(summary).toHaveTextContent("All ages");
    expect(summary).toHaveTextContent("2023/24");
    expect(summary).toHaveTextContent("page 2 of 4");
    expect(summary).toHaveTextContent("Ranked ledger");
  });

  it("separates the header from the first row with the ledger's existing hairline", () => {
    mountDiscovery();
    expect(screen.getByTestId("results-ledger").className).toContain("divide-y");
  });

  it("starts the results column with the ledger itself, so nothing offsets it from the rail", () => {
    mountDiscovery();
    const results = screen.getByRole("region", { name: "Results" });
    // no metadata line, spacer or heading precedes the bordered container
    expect(results.firstElementChild!.firstElementChild).toBe(screen.getByTestId("results-ledger"));
    expect(screen.getByTestId("filter-column").previousElementSibling).toBeNull();
  });

  it("still renders the honest empty state instead of a fabricated header", () => {
    usePlayerSearchMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { items: [], total: 0, page: 1, page_size: 12, total_pages: 0 },
    });
    mountDiscovery();
    expect(screen.queryByTestId("results-ledger")).not.toBeInTheDocument();
    expect(screen.queryByTestId("result-count")).not.toBeInTheDocument();
    expect(screen.getByText(/No players match these filters/)).toBeInTheDocument();
  });
});
