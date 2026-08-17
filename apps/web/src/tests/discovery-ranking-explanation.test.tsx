import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScoutingStateProvider } from "@/lib/state/scouting-state";
import type { PlayerSearchCard, RankingExplanation, RankingKey } from "@/lib/api/types";

// ---------------------------------------------------------------------------
// Phase 8.3 — "Why this order"
//
// The surface's entire job is to render what the API sent. These tests therefore
// treat the backend payload as the authority: the key sequence is asserted to
// appear EXACTLY as supplied (including a deliberately unusual order the frontend
// could not have invented), and a source scan proves the component holds no
// comparator, no key table and no rule text of its own.
//
// The explanation is PAGE-LEVEL, so several tests here assert an absence: no
// player is named, no two results are compared, and no row carries a control of
// its own.
// ---------------------------------------------------------------------------

const { paramsRef, usePlayerSearchMock } = vi.hoisted(() => ({
  paramsRef: { current: new URLSearchParams() },
  usePlayerSearchMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => paramsRef.current,
}));
vi.mock("@/lib/api/hooks", () => ({
  usePlayerSearch: usePlayerSearchMock,
  usePlaystyleOptions: () => [],
}));

// The rail writes its URL through the native History API (see SearchExperience for
// why), so that is what a control-driven assertion observes.
const replaceStateSpy = vi.spyOn(window.history, "replaceState");

import { SearchExperience } from "@/components/search/SearchExperience";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// fixtures — shaped exactly like the API's own payload
// ---------------------------------------------------------------------------
function card(over: Partial<PlayerSearchCard> = {}): PlayerSearchCard {
  return {
    id: 1,
    canonical_name: "Luca Bianchi",
    season: "2023/24",
    age: 24.2,
    club: "Stuttgart",
    league: "Bundesliga",
    primary_position: "CF",
    position_group: "ATT",
    best_role: "shadow_striker",
    best_role_display: "Shadow Striker",
    best_role_score: 83.1,
    best_role_confidence: "high",
    result_role: "shadow_striker",
    result_role_display: "Shadow Striker",
    result_role_score: 83.1,
    result_role_confidence: "high",
    result_role_source: "best_role",
    confidence: "high",
    analysis_status: "analyzed",
    evidence_status: "high_coverage",
    has_rolefit_analysis: true,
    is_high_coverage: true,
    top_playstyles: ["Technical Carrier"],
    minutes: 1800,
    represented_minutes: 1800,
    market_label: "fair",
    expected_asking_low_eur: 12_000_000,
    expected_asking_high_eur: 20_000_000,
    ...over,
  } as PlayerSearchCard;
}

function key(over: Partial<RankingKey> = {}): RankingKey {
  return {
    position: 1,
    key: "rated_first",
    label: "Rated Before Unrated",
    direction: "ascending",
    direction_label: "Known first",
    role: "placement",
    unit: "rating_status",
    rule: "Players with a stored RoleFit rating are placed before players without one.",
    ...over,
  } as RankingKey;
}

const ROLEFIT_KEYS: RankingKey[] = [
  key(),
  key({
    position: 2,
    key: "result_role_score",
    label: "RoleFit Score",
    direction: "descending",
    direction_label: "Highest first",
    role: "measure",
    unit: "rolefit_score",
    rule: "The applicable role context's stored RoleFit score, highest first.",
  }),
  key({
    position: 3,
    key: "result_role_confidence",
    label: "RoleFit Confidence",
    direction: "descending",
    direction_label: "Highest first",
    role: "measure",
    unit: "confidence",
    rule: "Only on an equal score: High Confidence, then Medium, then Low, then Unknown.",
  }),
  key({
    position: 4,
    key: "canonical_name",
    label: "Canonical Name",
    direction: "ascending",
    direction_label: "A to Z",
    role: "tie_breaker",
    unit: "name",
    rule: "The canonical name, lowercased and compared by Unicode code point, A to Z.",
  }),
  key({
    position: 5,
    key: "player_id",
    label: "Player ID",
    direction: "ascending",
    direction_label: "Lowest first",
    role: "tie_breaker",
    unit: "player_id",
    rule: "The stable player ID, ascending, decides anything still equal.",
  }),
];

function ranking(over: Partial<RankingExplanation> = {}): RankingExplanation {
  return {
    sort: "rolefit_desc",
    sort_label: "RoleFit",
    direction: "descending",
    direction_label: "highest first",
    summary: "Ordered by RoleFit, highest first.",
    keys: ROLEFIT_KEYS,
    role_context: {
      source: "best_role",
      role_key: null,
      role_display: null,
      label: "Best role for each player",
      detail:
        "No role is selected, so the RoleFit on each result is that player's own stored best " +
        "role, which may differ from row to row. That rating's stored score and confidence are " +
        "two of the ordering keys below, and are what this page is ordered by.",
    },
    missing_values:
      "A player with no stored rating for this role context is placed after every rated player.",
    tie_breakers: [ROLEFIT_KEYS[3], ROLEFIT_KEYS[4]],
    limitation: "This explains ordering, not recruitment suitability.",
    ...over,
  } as RankingExplanation;
}

function respond(over: Partial<RankingExplanation> = {}, items = [card(), card({ id: 2, canonical_name: "Théo Marchand", result_role_score: 66.9 })]) {
  usePlayerSearchMock.mockReturnValue({
    isLoading: false,
    isError: false,
    data: {
      items,
      total: items.length,
      page: 1,
      page_size: 12,
      total_pages: 1,
      ranking: ranking(over),
    },
  });
}

function mount(search = "") {
  paramsRef.current = new URLSearchParams(search);
  return render(
    <ScoutingStateProvider>
      <SearchExperience />
    </ScoutingStateProvider>,
  );
}

const toggle = () => screen.getByTestId("why-this-order-toggle");
const region = () => screen.getByTestId("why-this-order-region");

beforeEach(() => {
  usePlayerSearchMock.mockReset();
  respond();
});

// ---------------------------------------------------------------------------
// collapsed default
// ---------------------------------------------------------------------------
describe("Why this order: collapsed by default", () => {
  it("renders one disclosure for the whole page, closed, with the active sort", () => {
    mount();
    expect(screen.getAllByTestId("why-this-order")).toHaveLength(1);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(region()).toHaveAttribute("hidden");
    expect(screen.getByTestId("ranking-summary-collapsed")).toHaveTextContent(
      "Ordered by RoleFit, highest first.",
    );
  });

  it("adds no explanation control to any result row", () => {
    mount();
    for (const row of screen.getAllByTestId("result-row")) {
      expect(within(row).queryByTestId("why-this-order-toggle")).toBeNull();
      expect(within(row).queryByText(/why/i)).toBeNull();
    }
  });

  it("keeps every expanded field out of the accessibility tree while closed", () => {
    mount();
    // `hidden` is what removes them, so nothing inside is focusable or readable.
    expect(screen.queryByTestId("ranking-limitation")).not.toBeVisible();
    expect(screen.queryAllByTestId("ranking-key").every((k) => !k.checkVisibility?.())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// placement — the ledger, never the filter rail
// ---------------------------------------------------------------------------
describe("Why this order: placement", () => {
  it("lives inside the results ledger, between the header and the first row", () => {
    mount();
    const ledger = screen.getByTestId("results-ledger");
    expect(within(ledger).getByTestId("why-this-order")).toBeInTheDocument();

    const children = Array.from(ledger.children);
    const headerIndex = children.findIndex((c) => c.getAttribute("data-testid") === "result-count");
    const explainIndex = children.findIndex(
      (c) => c.getAttribute("data-testid") === "why-this-order",
    );
    const firstRowIndex = children.findIndex(
      (c) => c.getAttribute("data-testid") === "result-row",
    );
    expect(headerIndex).toBeLessThan(explainIndex);
    expect(explainIndex).toBeLessThan(firstRowIndex);
  });

  it("is absent from the filter rail entirely", () => {
    mount();
    const rail = screen.getByTestId("filter-column");
    expect(within(rail).queryByTestId("why-this-order")).toBeNull();
    expect(rail.textContent).not.toMatch(/why this order/i);
  });

  it("does not turn the ledger header into a second metadata block", () => {
    mount();
    const header = screen.getByTestId("result-count");
    expect(header.textContent).not.toMatch(/RoleFit Score|tie-break|Ordered by/i);
  });
});

// ---------------------------------------------------------------------------
// expanded content
// ---------------------------------------------------------------------------
describe("Why this order: expanded", () => {
  it("opens on click and reveals the active sort, rules, tie-breaks and limitation", () => {
    mount();
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(region()).not.toHaveAttribute("hidden");

    expect(screen.getByTestId("ranking-summary")).toHaveTextContent(
      "Ordered by RoleFit, highest first.",
    );
    expect(screen.getByTestId("ranking-role-context")).toHaveTextContent(
      "Best role for each player",
    );
    expect(screen.getByTestId("ranking-missing-values")).toHaveTextContent(
      /placed after every rated player/,
    );
    expect(screen.getByTestId("ranking-tie-breakers")).toHaveTextContent(
      "Final tie-breakers, always applied last: Canonical Name, Player ID.",
    );
    expect(screen.getByTestId("ranking-limitation")).toHaveTextContent(
      "This explains ordering, not recruitment suitability.",
    );
  });

  it("renders the backend key sequence exactly, in the supplied order", () => {
    mount();
    fireEvent.click(toggle());
    const keys = screen.getAllByTestId("ranking-key");
    expect(keys.map((k) => k.getAttribute("data-ranking-key"))).toEqual([
      "rated_first",
      "result_role_score",
      "result_role_confidence",
      "canonical_name",
      "player_id",
    ]);
    expect(keys.map((k) => k.getAttribute("data-ranking-position"))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    expect(keys[1]).toHaveTextContent("RoleFit Score");
    expect(keys[1]).toHaveTextContent("Highest first");
    expect(keys[1]).toHaveTextContent(
      "The applicable role context's stored RoleFit score, highest first.",
    );
  });

  it("renders an order the frontend could not have invented, unchanged", () => {
    // Deliberately backwards: name first, score last. If the surface held any
    // opinion about precedence it would reorder or relabel this.
    const reversed = [...ROLEFIT_KEYS].reverse().map((k, index) => ({ ...k, position: index + 1 }));
    respond({ keys: reversed, tie_breakers: [] });
    mount();
    fireEvent.click(toggle());
    expect(
      screen.getAllByTestId("ranking-key").map((k) => k.getAttribute("data-ranking-key")),
    ).toEqual([
      "player_id",
      "canonical_name",
      "result_role_confidence",
      "result_role_score",
      "rated_first",
    ]);
    expect(screen.queryByTestId("ranking-tie-breakers")).toBeNull();
  });

  it("closes again without losing anything", () => {
    mount();
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(region()).toHaveAttribute("hidden");
    // The ledger and its rows are untouched by opening or closing.
    expect(screen.getAllByTestId("result-row")).toHaveLength(2);
  });

  it("ends with the limitation, immediately after the ordering rules", () => {
    mount();
    fireEvent.click(toggle());
    const blocks = Array.from(region().children);
    const rulesIndex = blocks.findIndex((b) => b.getAttribute("data-testid") === "ranking-rules");
    const limitation = screen.getByTestId("ranking-limitation");
    const limitationIndex = blocks.findIndex((b) => b.contains(limitation));

    expect(rulesIndex).toBeGreaterThanOrEqual(0);
    // Nothing sits between the rules and the limitation, and the limitation is last.
    expect(limitationIndex).toBe(rulesIndex + 1);
    expect(limitationIndex).toBe(blocks.length - 1);
  });
});

// ---------------------------------------------------------------------------
// the explanation is page-level: it names no player and compares no two results
// ---------------------------------------------------------------------------
describe("Why this order: page-level only", () => {
  it("shows no adjacent-results section and no player-versus-player reason", () => {
    mount();
    fireEvent.click(toggle());
    expect(region().textContent).not.toMatch(/adjacent results/i);
    expect(region().textContent).not.toMatch(/appears above|appears below|precedes/i);
    expect(screen.queryAllByTestId("ranking-adjacent")).toHaveLength(0);
    expect(screen.queryByTestId("ranking-adjacent-list")).toBeNull();
  });

  it("names no result, on a page whose every result has a distinctive name", () => {
    mount();
    fireEvent.click(toggle());
    for (const name of ["Luca Bianchi", "Théo Marchand"]) {
      expect(region().textContent).not.toContain(name);
    }
  });

  it("shows no first-visible note", () => {
    mount();
    fireEvent.click(toggle());
    expect(region().textContent).not.toMatch(/first visible/i);
  });

  it("does not grow with the page: identical content for 1 result and for 12", () => {
    respond({}, [card()]);
    const one = mount();
    fireEvent.click(toggle());
    const withOneResult = region().innerHTML;
    one.unmount();

    respond(
      {},
      Array.from({ length: 12 }, (_, i) => card({ id: i + 1 })),
    );
    mount();
    fireEvent.click(toggle());
    expect(region().innerHTML).toBe(withOneResult);
  });
});


// ---------------------------------------------------------------------------
// role context and sort changes
// ---------------------------------------------------------------------------
describe("Why this order: context follows the request", () => {
  it("reports the selected role when one is active", () => {
    respond({
      role_context: {
        source: "selected_role",
        role_key: "touchline_winger",
        role_display: "Touchline Winger",
        label: "Selected role: Touchline Winger",
        detail:
          "Touchline Winger is selected, so every result is judged by its stored Touchline " +
          "Winger rating, and no other role's rating is read. That rating's stored score and " +
          "confidence are two of the ordering keys below, and are what this page is ordered by.",
      },
    });
    mount("role=touchline_winger");
    fireEvent.click(toggle());
    const context = screen.getByTestId("ranking-role-context");
    expect(context).toHaveTextContent("Selected role: Touchline Winger");
    expect(context).toHaveTextContent("judged by its stored Touchline Winger rating");
    expect(context.textContent).not.toMatch(/best role/i);
  });

  it("renders the RoleFit modes' claim that the rating ordered the page", () => {
    mount();
    fireEvent.click(toggle());
    const context = screen.getByTestId("ranking-role-context");
    expect(context).toHaveTextContent("Best role for each player");
    expect(context).toHaveTextContent("what this page is ordered by");
    expect(context.textContent).not.toMatch(/did not order/i);
  });

  it.each([
    ["age_asc", "Age", "youngest first"],
    ["age_desc", "Age", "oldest first"],
    ["value_desc", "Expected Asking", "highest first"],
    ["value_asc", "Expected Asking", "lowest first"],
    ["name_asc", "Name", "A to Z"],
  ])(
    "renders the %s context as displayed RoleFit rather than RoleFit ordering",
    (sort, label, direction) => {
      // The backend's correction: under these modes RoleFit is what each result
      // SHOWS, and the named sort is what ordered the page. The surface renders that
      // sentence verbatim — it has no opinion about which sorts use RoleFit.
      const detail =
        "No role is selected, so the RoleFit on each result is that player's own stored best " +
        `role, which may differ from row to row. That rating is what each result DISPLAYS. It ` +
        `did not order this page: the ordering comes from the ${label} sort (${direction}), as ` +
        "the keys below state.";
      respond({
        sort,
        summary: `Ordered by ${label}.`,
        role_context: {
          source: "best_role",
          role_key: null,
          role_display: null,
          label: "Best role for each player",
          detail,
        },
      });
      mount(`sort=${sort}`);
      fireEvent.click(toggle());
      const context = screen.getByTestId("ranking-role-context");
      expect(context).toHaveTextContent("did not order this page");
      expect(context).toHaveTextContent(`the ordering comes from the ${label} sort`);
      expect(context.textContent).not.toMatch(/ordering keys below/i);
    },
  );

  it.each([
    ["rolefit_desc", "Ordered by RoleFit, highest first."],
    ["rolefit_asc", "Ordered by RoleFit, lowest first."],
    ["age_asc", "Ordered by age, youngest first."],
    ["value_desc", "Ordered by Expected Asking, highest first."],
    ["value_asc", "Ordered by Expected Asking, lowest first."],
    ["name_asc", "Ordered by name, A to Z."],
  ])("follows the %s sort the control can represent", (sort, summary) => {
    respond({ sort, summary });
    mount(`sort=${sort}`);
    expect(screen.getByTestId("ranking-summary-collapsed")).toHaveTextContent(summary);
    fireEvent.click(toggle());
    expect(screen.getByTestId("ranking-summary")).toHaveTextContent(summary);
  });

  it("re-renders the explanation when the Sort control changes", () => {
    const view = mount();
    expect(screen.getByTestId("ranking-summary-collapsed")).toHaveTextContent("highest first");

    respond({ sort: "name_asc", summary: "Ordered by name, A to Z." });
    fireEvent.change(screen.getByTestId("sort-filter"), { target: { value: "name_asc" } });

    // The rail is URL-backed: it writes the new sort with the native History API,
    // and the surface re-hydrates from that URL. Replaying the write is what makes
    // this a real control -> URL -> request -> explanation round trip.
    const url = replaceStateSpy.mock.calls.at(-1)![2] as string;
    expect(url).toContain("sort=name_asc");
    paramsRef.current = new URLSearchParams(new URL(url, "http://localhost").search);
    view.rerender(
      <ScoutingStateProvider>
        <SearchExperience />
      </ScoutingStateProvider>,
    );

    expect(screen.getByTestId("ranking-summary-collapsed")).toHaveTextContent(
      "Ordered by name, A to Z.",
    );
  });
});

// ---------------------------------------------------------------------------
// sparse and failing states
// ---------------------------------------------------------------------------
describe("Why this order: sparse states", () => {
  it("is complete when only one result is visible", () => {
    respond({}, [card()]);
    mount();
    fireEvent.click(toggle());
    expect(screen.getAllByTestId("result-row")).toHaveLength(1);
    // The explanation describes the ordering, so one row explains as fully as many.
    expect(screen.getAllByTestId("ranking-key")).toHaveLength(5);
    expect(screen.getByTestId("ranking-tie-breakers")).toBeInTheDocument();
    expect(screen.getByTestId("ranking-limitation")).toBeInTheDocument();
  });

  it("is absent when there are no results at all", () => {
    usePlayerSearchMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        items: [],
        total: 0,
        page: 1,
        page_size: 12,
        total_pages: 0,
        ranking: ranking(),
      },
    });
    mount();
    expect(screen.queryByTestId("why-this-order")).toBeNull();
    expect(screen.getByText("No players match these filters.")).toBeInTheDocument();
  });

  it("is absent while loading and while erroring", () => {
    usePlayerSearchMock.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    const { unmount } = mount();
    expect(screen.queryByTestId("why-this-order")).toBeNull();
    unmount();

    usePlayerSearchMock.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("boom"),
      data: undefined,
    });
    mount();
    expect(screen.queryByTestId("why-this-order")).toBeNull();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders the ledger unharmed if a response arrives without a ranking", () => {
    usePlayerSearchMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { items: [card()], total: 1, page: 1, page_size: 12, total_pages: 1 },
    });
    mount();
    expect(screen.queryByTestId("why-this-order")).toBeNull();
    expect(screen.getAllByTestId("result-row")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// keyboard, focus and naming
// ---------------------------------------------------------------------------
describe("Why this order: accessibility contract", () => {
  it("is a real button whose accessible name states its purpose", () => {
    mount();
    const button = toggle();
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    const name = button.getAttribute("aria-label")!;
    expect(name.startsWith("Why this order")).toBe(true);
    expect(name).toContain("Ordered by RoleFit, highest first.");
    // The visible text leads the accessible name (WCAG 2.5.3 Label in Name).
    expect(button.textContent).toMatch(/Why This Order/i);
  });

  it("points aria-controls at a region that exists in both states", () => {
    mount();
    const controls = toggle().getAttribute("aria-controls")!;
    expect(document.getElementById(controls)).toBe(region());
    fireEvent.click(toggle());
    expect(document.getElementById(controls)).toBe(region());
  });

  it("keeps focus on the control through open and close", () => {
    mount();
    toggle().focus();
    fireEvent.click(toggle());
    expect(document.activeElement).toBe(toggle());
    fireEvent.click(toggle());
    expect(document.activeElement).toBe(toggle());
    expect(document.activeElement).not.toBe(document.body);
  });

  it("responds to Enter and Space through the platform's own button handling", () => {
    mount();
    // A native <button> with a click handler gets both keys for free; asserting the
    // element type is what guarantees it, and no key handler may be shadowing it.
    const source = readFileSync(join(SRC, "components", "search", "WhyThisOrder.tsx"), "utf8");
    expect(source).not.toMatch(/onKeyDown|onKeyPress|onKeyUp/);
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("traps nothing: the region's own content is plain flow content", () => {
    mount();
    fireEvent.click(toggle());
    // No focusable element is introduced inside the region at all, so there is
    // nothing that could hold focus when it closes.
    expect(region().querySelectorAll("button, a, input, select, textarea, [tabindex]")).toHaveLength(
      0,
    );
  });
});

// ---------------------------------------------------------------------------
// containment and geometry
// ---------------------------------------------------------------------------
describe("Why this order: containment and geometry", () => {
  it("wraps long key labels and long role labels rather than widening anything", () => {
    respond({
      keys: [
        key({
          label: "An Extremely Long Ordering Key Label That Must Wrap Inside The Ledger",
          rule: "A rule sentence long enough to need more than one line at 320 pixels wide, twice over.",
        }),
      ],
      tie_breakers: [],
      role_context: {
        source: "selected_role",
        role_key: "extraordinarily_long_role",
        role_display: "Extraordinarily Long Hyphenated Role-Name Of Considerable Width",
        label: "Selected role: Extraordinarily Long Hyphenated Role-Name Of Considerable Width",
        detail:
          "Extraordinarily Long Hyphenated Role-Name Of Considerable Width is selected, so " +
          "every result is judged by that stored rating, and no other role's rating is read.",
      },
    });
    mount();
    fireEvent.click(toggle());
    for (const row of screen.getAllByTestId("ranking-key")) {
      expect(row.className).toContain("ledger-explain-row");
      const wrapper = row.querySelector("span.min-w-0");
      expect(wrapper?.className).toContain("break-words");
    }
    // The role context is ordinary flow text in a `min-w-0` block, so a long role
    // display name cannot set a min-content width for the ledger either.
    expect(screen.getByTestId("ranking-role-context").textContent).toContain(
      "Extraordinarily Long Hyphenated Role-Name Of Considerable Width",
    );
  });

  it("introduces no nested scroller of either axis", () => {
    mount();
    fireEvent.click(toggle());
    for (const el of [region(), ...Array.from(region().querySelectorAll("*"))]) {
      const cls = (el as HTMLElement).className?.toString?.() ?? "";
      expect(cls).not.toMatch(/overflow-(x|y)-(auto|scroll)|overflow-auto|overflow-scroll/);
      expect(cls).not.toMatch(/max-h-|h-\[/);
    }
  });

  it("introduces no rounded corner, shadow, gradient or glass effect", () => {
    mount();
    fireEvent.click(toggle());
    for (const el of [
      screen.getByTestId("why-this-order"),
      ...Array.from(screen.getByTestId("why-this-order").querySelectorAll("*")),
    ]) {
      const cls = (el as HTMLElement).className?.toString?.() ?? "";
      expect(cls).not.toMatch(/(^|\s)rounded(-|\s|$)/);
      expect(cls).not.toMatch(/shadow-|bg-gradient|backdrop-blur|drop-shadow/);
    }
  });

  it("declares no radius and no layout animation in its own source", () => {
    const source = readFileSync(join(SRC, "components", "search", "WhyThisOrder.tsx"), "utf8");
    expect(source).not.toMatch(/rounded|borderRadius|border-radius/);
    expect(source).not.toMatch(/transition|animate-|@keyframes/);

    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    const rule = /\.ledger-explain\s*\{[^}]*\}/.exec(css)?.[0];
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/border-radius:\s*0;/);
    // The open marker is paint, never a dimension: an inset shadow cannot move the
    // ledger, the rail or their shared top edge.
    const openRule = /\.ledger-explain\[aria-expanded="true"\]\s*\{[^}]*\}/.exec(css)?.[0];
    expect(openRule).toMatch(/box-shadow:\s*inset/);
    expect(openRule).not.toMatch(/height|width|padding|margin|top|left/);
  });
});

// ---------------------------------------------------------------------------
// the source contract: no second copy of the ordering rules
// ---------------------------------------------------------------------------
describe("Why this order: no independent frontend comparator", () => {
  const source = () =>
    readFileSync(join(SRC, "components", "search", "WhyThisOrder.tsx"), "utf8");

  const stripComments = (code: string) =>
    code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");

  it("holds no ordering-key name, label or rule text of its own", () => {
    const code = stripComments(source());
    // Quoted forms only. `pair.player_id` is READING the response; a literal
    // `"player_id"` would be the surface holding an opinion about that key.
    for (const literal of [
      "rated_first",
      "result_role_score",
      "result_role_confidence",
      "expected_asking_low_eur",
      "asking_low_known_first",
      "canonical_name",
      "player_id",
      "rolefit_desc",
      "value_desc",
      "age_asc",
      "Highest first",
      "Lowest first",
      "Youngest first",
      "A to Z",
      "Ordered by",
      "unknown ages",
      "did not order",
      "ordering keys",
    ]) {
      expect(code, `${literal} is a backend concern`).not.toMatch(
        new RegExp(`["'\`]${literal}`),
      );
    }
  });

  it("compares nothing, sorts nothing and reverses nothing", () => {
    const code = stripComments(source());
    expect(code).not.toMatch(/\.sort\(|\.reverse\(|localeCompare|\bMath\.(min|max)\b/);
    // No response VALUE is ever on either side of a relational operator. `.length`
    // is exempt: it is a presence check on a supplied list, not an ordering.
    expect(code).not.toMatch(/\.(?!length\b)[A-Za-z_]+\s*[<>]=?[^=>]/);
    // The only comparisons in the file at all are emptiness checks on supplied
    // lists — nothing that could re-derive an order.
    const comparisons = code.match(/[A-Za-z_.\]]+\s*(===|!==|<=|>=|<|>)\s*[A-Za-z0-9_."']+/g) ?? [];
    expect([...comparisons].sort()).toEqual(["tieBreakers.length > 0"]);
  });

  it("reads its data from the response rather than from any local table", () => {
    const results = readFileSync(
      join(SRC, "components", "search", "PlayerSearchResults.tsx"),
      "utf8",
    );
    expect(results).toMatch(/ranking=\{data\.ranking\}/);
    // The surface has no constant that could stand in for the backend's sequence.
    expect(source()).not.toMatch(/const\s+[A-Z_]+\s*(:\s*[^=]+)?=\s*\[/);
  });
});
