import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADVANCED_CATEGORIES } from "@/lib/filters/criteria";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";
import type { PlayerSearchCard } from "@/lib/api/types";

/**
 * Phase 8.2 — the compact, URL-backed Advanced Discovery interface.
 *
 * Covers the progressive-disclosure architecture (one Advanced Filters row over
 * three single-open categories), the active-criteria area (count, summaries,
 * individual removal, Clear All), the URL contract for every newly exposed field,
 * the EUR-millions market inputs, the range invariants, and the accessibility of
 * all of it. The pure helpers are asserted in `discovery-criteria.test.ts`; the
 * measured geometry lives in the Playwright suites.
 */

/**
 * A LIVE URL harness.
 *
 * `discovery-filters.test.tsx` asserts the URL a single interaction writes. This
 * suite needs the other half of the loop — remove a criterion, watch the request,
 * the controls, the counts and the focus all follow — so the mocked
 * `useSearchParams` subscribes to the URL the rail writes, exactly as Next.js
 * keeps it in sync with the native History methods. Without it, "removal" would
 * only ever be a string assertion about an address bar.
 */
const { paramsRef, usePlayerSearchMock, listeners } = vi.hoisted(() => ({
  paramsRef: { current: new URLSearchParams() },
  usePlayerSearchMock: vi.fn(),
  listeners: new Set<() => void>(),
}));

vi.mock("next/navigation", async () => {
  const { useEffect, useReducer } = await import("react");
  return {
    useRouter: () => ({
      replace: vi.fn(),
      push: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
    }),
    usePathname: () => "/",
    useSearchParams: () => {
      const [, rerender] = useReducer((n: number) => n + 1, 0);
      useEffect(() => {
        listeners.add(rerender);
        return () => {
          listeners.delete(rerender);
        };
      }, []);
      return paramsRef.current;
    },
  };
});

/**
 * The Playstyle select's options are the METHODOLOGY CONTRACT's positives, not a
 * hand-written frontend list. `usePlaystyleOptions` is the seam; this mock is the
 * shape it returns, and `assertsPlaystyleSource` below pins the seam itself.
 */
const PLAYSTYLE_OPTIONS = [
  { key: "technical_carrier", label: "Technical Carrier" },
  { key: "box_crasher", label: "Box Crasher" },
  { key: "press_resistant", label: "Press Resistant" },
];
vi.mock("@/lib/api/hooks", () => ({
  usePlayerSearch: usePlayerSearchMock,
  usePlaystyleOptions: () => PLAYSTYLE_OPTIONS,
}));

/** The rail's own write path, wired back into the mocked search params. */
const replaceStateSpy = vi
  .spyOn(window.history, "replaceState")
  .mockImplementation(((_state: unknown, _title: string, url?: string | URL | null) => {
    const raw = String(url ?? "/");
    const q = raw.indexOf("?");
    paramsRef.current = new URLSearchParams(q === -1 ? "" : raw.slice(q + 1));
    listeners.forEach((notify) => notify());
  }) as typeof window.history.replaceState);

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
    best_role_confidence: "high",
    result_role: "shadow_striker",
    result_role_display: "Shadow Striker",
    result_role_score: 88.4,
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

function lastUrl(): string {
  return replaceStateSpy.mock.calls.at(-1)![2] as string;
}

function lastRequest() {
  return usePlayerSearchMock.mock.calls.at(-1)![0];
}

/** Search params of the URL the last interaction wrote. */
function lastParams(): URLSearchParams {
  const url = lastUrl();
  const q = url.indexOf("?");
  return new URLSearchParams(q === -1 ? "" : url.slice(q + 1));
}

const advancedToggle = () => screen.getByTestId("advanced-filters-toggle");
const advancedRegion = () => screen.getByTestId("advanced-filters-region");
const categoryToggle = (key: string) => screen.getByTestId(`advanced-category-toggle-${key}`);
const categoryFields = (key: string) => screen.getByTestId(`advanced-category-fields-${key}`);

beforeEach(() => {
  replaceStateSpy.mockClear();
  usePlayerSearchMock.mockReset();
  usePlayerSearchMock.mockReturnValue({
    isLoading: false,
    isError: false,
    data: {
      items: [card(), card({ id: 2, canonical_name: "Jack Whitmore" })],
      total: 37,
      page: 1,
      page_size: 12,
      total_pages: 4,
    },
  });
});

// ---------------------------------------------------------------------------
// The compact default rail
// ---------------------------------------------------------------------------
describe("Compact default filter rail", () => {
  it("shows exactly the five core controls, in the required order", () => {
    mountDiscovery();
    const items = Array.from(screen.getByTestId("filter-grid").children).map((child) => {
      const el = child as HTMLElement;
      return el.dataset.testid ?? el.querySelector(".label")?.textContent?.trim() ?? el.tagName;
    });
    expect(items).toEqual(["Search", "age-threshold-filter", "Position group", "Role", "Sort"]);
  });

  it("moves the specialized thresholds out of the default view", () => {
    mountDiscovery();
    // Min Minutes and Min RoleFit were core controls before Phase 8.2; they are
    // still present and still work, but they now live inside a closed disclosure.
    for (const id of ["min-minutes-filter", "rolefit-min-filter"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
      expect(screen.getByTestId("filter-grid")).not.toContainElement(screen.getByTestId(id));
    }
    expect(advancedRegion()).toHaveAttribute("hidden");
  });

  it("collapses Advanced Filters by default and reports no count", () => {
    mountDiscovery();
    expect(advancedToggle()).toHaveAttribute("aria-expanded", "false");
    expect(advancedToggle()).toHaveAccessibleName("Advanced Filters");
    expect(screen.queryByTestId("advanced-filters-toggle-count")).not.toBeInTheDocument();
  });

  it("shows no active-criteria area at all on the root Discovery route", () => {
    mountDiscovery();
    expect(screen.queryByTestId("active-criteria")).not.toBeInTheDocument();
    expect(screen.queryByTestId("clear-all-filters")).not.toBeInTheDocument();
  });

  it("adds no nested scrolling region to the rail", () => {
    mountDiscovery();
    const rail = screen.getByTestId("filter-rail");
    for (const el of [rail, ...Array.from(rail.querySelectorAll<HTMLElement>("*"))]) {
      const cls = el.getAttribute("class") ?? "";
      expect(cls, cls).not.toMatch(/overflow-(?:y|x)?-?(?:auto|scroll)/);
      expect(cls, cls).not.toMatch(/max-h-/);
    }
  });
});

// ---------------------------------------------------------------------------
// The disclosure contract
// ---------------------------------------------------------------------------
describe("Advanced Filters disclosure", () => {
  it("is a real button with aria-expanded and a resolvable aria-controls", () => {
    mountDiscovery();
    const toggle = advancedToggle();
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("type", "button");
    const controls = toggle.getAttribute("aria-controls")!;
    // The region is always in the DOM, so the reference resolves in BOTH states.
    expect(document.getElementById(controls)).toBe(advancedRegion());
  });

  it("opens and closes on click, keeping the region reference intact", () => {
    mountDiscovery();
    fireEvent.click(advancedToggle());
    expect(advancedToggle()).toHaveAttribute("aria-expanded", "true");
    expect(advancedRegion()).not.toHaveAttribute("hidden");

    fireEvent.click(advancedToggle());
    expect(advancedToggle()).toHaveAttribute("aria-expanded", "false");
    expect(advancedRegion()).toHaveAttribute("hidden");
  });

  it("opens and closes on Enter and on Space, as a native button does", () => {
    mountDiscovery();
    const toggle = advancedToggle();
    toggle.focus();
    expect(toggle).toHaveFocus();
    // A <button> synthesises `click` from both keys; asserting the element type
    // and the click behaviour together is what proves the platform handles them.
    for (const key of ["Enter", " "]) {
      fireEvent.keyDown(toggle, { key });
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    }
  });

  it("writes nothing to the URL and refetches nothing when opened or closed", () => {
    mountDiscovery("league=Bundesliga");
    const requestsBefore = usePlayerSearchMock.mock.calls.length;
    replaceStateSpy.mockClear();

    fireEvent.click(advancedToggle());
    fireEvent.click(advancedToggle());
    fireEvent.click(categoryToggle("market"));
    fireEvent.click(categoryToggle("market"));

    // Disclosure state is presentation, deliberately not URL state: a shared link
    // describes a cohort, not which drawer the sender had open.
    expect(replaceStateSpy).not.toHaveBeenCalled();
    // ...and every render asked for the identical request object
    const requests = usePlayerSearchMock.mock.calls.slice(requestsBefore).map((c) => c[0]);
    for (const request of requests) expect(request).toEqual(lastRequest());
    expect(lastRequest()).toMatchObject({ league: "Bundesliga" });
  });

  it("counts the active advanced criteria, and only the advanced ones", () => {
    mountDiscovery("q=Anton&age_max=25&league=Bundesliga&rolefit_max=80&value_min=5000000");
    // 5 criteria in total; 3 of them are advanced (league, rolefit_max, value_min)
    expect(screen.getByTestId("active-criteria-count")).toHaveTextContent("5 Active Criteria");
    expect(screen.getByTestId("advanced-filters-toggle-count")).toHaveTextContent("3");
    expect(advancedToggle()).toHaveAccessibleName("Advanced Filters, 3 active");
  });
});

describe("Advanced categories", () => {
  it("renders exactly the three specified categories, in order", () => {
    mountDiscovery();
    const headers = ADVANCED_CATEGORIES.map((c) => categoryToggle(c.key));
    expect(headers.map((h) => h.textContent)).toEqual([
      expect.stringContaining("Context"),
      expect.stringContaining("Evidence & Fit"),
      expect.stringContaining("Market"),
    ]);
    for (const header of headers) {
      expect(header.tagName).toBe("BUTTON");
      expect(header).toHaveAttribute("aria-expanded");
      expect(document.getElementById(header.getAttribute("aria-controls")!)).not.toBeNull();
    }
  });

  it("puts each specified field in its specified category", () => {
    mountDiscovery();
    const expected: Record<string, string[]> = {
      context: ["league-filter", "club-filter", "nationality-filter"],
      evidence: [
        "min-minutes-filter",
        "rolefit-min-filter",
        "rolefit-max-filter",
        "playstyle-filter",
      ],
      market: ["value-min-filter", "value-max-filter"],
    };
    for (const [category, ids] of Object.entries(expected)) {
      const fields = categoryFields(category);
      for (const id of ids) expect(fields, `${id} in ${category}`).toContainElement(screen.getByTestId(id));
      // DOM order inside a category is the specified order, so it is also the
      // visual and keyboard order at every width (no `order` utilities anywhere).
      const found = Array.from(fields.querySelectorAll<HTMLElement>("[data-testid]"))
        .map((el) => el.dataset.testid!)
        .filter((id) => ids.includes(id));
      expect(found, category).toEqual(ids);
    }
  });

  it("expands only one category at a time, and never clears the closed one", () => {
    mountDiscovery();
    fireEvent.click(advancedToggle());
    // Context is open by default so the first press already reveals real fields
    expect(categoryToggle("context")).toHaveAttribute("aria-expanded", "true");

    fireEvent.change(screen.getByTestId("league-filter"), { target: { value: "Bundesliga" } });
    expect(lastParams().get("league")).toBe("Bundesliga");
    expect(screen.getByTestId("league-filter")).toHaveValue("Bundesliga");

    fireEvent.click(categoryToggle("market"));
    expect(categoryToggle("market")).toHaveAttribute("aria-expanded", "true");
    expect(categoryToggle("context")).toHaveAttribute("aria-expanded", "false");
    expect(categoryFields("context")).toHaveAttribute("hidden");
    expect(categoryFields("market")).not.toHaveAttribute("hidden");

    // closing did not clear the value, the URL, the request or the summary
    expect(screen.getByTestId("league-filter")).toHaveValue("Bundesliga");
    expect(lastRequest()).toMatchObject({ league: "Bundesliga" });
    expect(screen.getByTestId("active-criteria-summary")).toHaveTextContent("League: Bundesliga");

    fireEvent.click(categoryToggle("evidence"));
    expect(
      ADVANCED_CATEGORIES.filter((c) => categoryToggle(c.key).getAttribute("aria-expanded") === "true"),
    ).toHaveLength(1);
  });

  it("closes a category on a second press without collapsing Advanced Filters", () => {
    mountDiscovery();
    fireEvent.click(advancedToggle());
    fireEvent.click(categoryToggle("context"));
    expect(categoryToggle("context")).toHaveAttribute("aria-expanded", "false");
    expect(advancedToggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("reports how many criteria are active inside each category", () => {
    mountDiscovery("league=Bundesliga&club=Leverkusen&rolefit_max=80&value_min=0");
    expect(screen.getByTestId("advanced-category-toggle-context-count")).toHaveTextContent("2");
    expect(screen.getByTestId("advanced-category-toggle-evidence-count")).toHaveTextContent("1");
    // a typed zero is a real bound, so Market reports one too
    expect(screen.getByTestId("advanced-category-toggle-market-count")).toHaveTextContent("1");

    expect(categoryToggle("context")).toHaveAccessibleName("Context, 2 active");
    expect(categoryToggle("evidence")).toHaveAccessibleName("Evidence & Fit, 1 active");
    expect(categoryToggle("market")).toHaveAccessibleName("Market, 1 active");
  });

  it("keeps reporting a closed category's count while it is closed", () => {
    mountDiscovery("club=Leverkusen");
    fireEvent.click(categoryToggle("context"));
    expect(categoryToggle("context")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("advanced-category-toggle-context-count")).toHaveTextContent("1");
  });

  it("shows no count box for a category with nothing active", () => {
    mountDiscovery("league=Bundesliga");
    expect(screen.queryByTestId("advanced-category-toggle-market-count")).not.toBeInTheDocument();
    expect(categoryToggle("market")).toHaveAccessibleName("Market");
  });

  it("opens onto the category a hard-loaded URL is actually using", () => {
    mountDiscovery("value_min=5000000");
    expect(advancedToggle()).toHaveAttribute("aria-expanded", "true");
    expect(categoryToggle("market")).toHaveAttribute("aria-expanded", "true");
    expect(categoryToggle("context")).toHaveAttribute("aria-expanded", "false");
    expect(categoryFields("market")).not.toHaveAttribute("hidden");
  });

  it("leaves Advanced Filters closed when a hard-loaded URL only uses core controls", () => {
    mountDiscovery("q=Anton&age_max=25&role=inside_forward");
    expect(advancedToggle()).toHaveAttribute("aria-expanded", "false");
    expect(advancedRegion()).toHaveAttribute("hidden");
    // ...but its active state is still obvious, from the criteria summary
    expect(screen.getByTestId("active-criteria-count")).toHaveTextContent("3 Active Criteria");
  });
});

// ---------------------------------------------------------------------------
// Native controls only
// ---------------------------------------------------------------------------
describe("Advanced controls are native", () => {
  it("uses a native select for Playstyle, not a custom combobox", () => {
    mountDiscovery();
    fireEvent.click(advancedToggle());
    fireEvent.click(categoryToggle("evidence"));
    const select = screen.getByTestId("playstyle-filter");
    expect(select.tagName).toBe("SELECT");
    expect(select).not.toHaveAttribute("role");
    // it exposes the platform's own combobox semantics, with no listbox, option
    // widgets or aria-activedescendant of our own
    expect(screen.getByRole("combobox", { name: "Playstyle" })).toBe(select);
    expect(select).not.toHaveAttribute("aria-activedescendant");
    expect(screen.getByTestId("advanced-filters").querySelector('[role="listbox"]')).toBeNull();
  });

  it("takes its Playstyle options from the Methodology contract's positives", () => {
    mountDiscovery();
    const select = screen.getByTestId("playstyle-filter") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => [o.value, o.text])).toEqual([
      ["", "Any Playstyle"],
      ...PLAYSTYLE_OPTIONS.map((p) => [p.key, p.label]),
    ]);
  });

  it("still shows a hard-loaded key the contract has not delivered yet", () => {
    mountDiscovery("playstyle=not_yet_loaded");
    const select = screen.getByTestId("playstyle-filter") as HTMLSelectElement;
    expect(select.value).toBe("not_yet_loaded");
    expect(lastRequest()).toMatchObject({ playstyle: "not_yet_loaded" });
  });

  it("uses plain text inputs for the Context predicates", () => {
    mountDiscovery();
    for (const id of ["league-filter", "club-filter", "nationality-filter"]) {
      const input = screen.getByTestId(id);
      expect(input.tagName).toBe("INPUT");
      expect(input).not.toHaveAttribute("type", "search");
      expect(input).toHaveAttribute("aria-describedby", "advanced-context-help");
    }
    const help = document.getElementById("advanced-context-help")!;
    // Each field's semantics are STATED: they are three different rules.
    expect(help.textContent).toMatch(/League matches name, country, or code/i);
    expect(help.textContent).toMatch(/Club accepts names and common aliases/i);
    expect(help.textContent).toMatch(/Nationality matches any part of the country/i);
    expect(help.textContent).toMatch(/ignore case/i);
    // ...and no longer claims nationality needs the whole country
    expect(help.textContent).not.toMatch(/whole country/i);
  });
});

// ---------------------------------------------------------------------------
// URL contract for the newly exposed fields
// ---------------------------------------------------------------------------
describe("URL contract for the Phase 8.2 fields", () => {
  it.each([
    ["league-filter", "league", "Bundesliga"],
    ["club-filter", "club", "Leverkusen"],
    ["nationality-filter", "nationality", "Germany"],
  ])("serializes %s as %s", (testId, param, value) => {
    mountDiscovery();
    fireEvent.change(screen.getByTestId(testId), { target: { value } });
    expect(lastParams().get(param)).toBe(value);
    expect(lastRequest()).toMatchObject({ [param]: value });
  });

  it.each([
    ["league=Bundesliga", { league: "Bundesliga" }, "league-filter", "Bundesliga"],
    ["club=Leverkusen", { club: "Leverkusen" }, "club-filter", "Leverkusen"],
    ["nationality=Germany", { nationality: "Germany" }, "nationality-filter", "Germany"],
    ["rolefit_max=80", { rolefit_max: 80 }, "rolefit-max-filter", 80],
    ["playstyle=box_crasher", { playstyle: "box_crasher" }, "playstyle-filter", "box_crasher"],
    ["value_min=5000000", { value_min: 5_000_000 }, "value-min-filter", "5"],
    ["value_max=12500000", { value_max: 12_500_000 }, "value-max-filter", "12.5"],
  ])("hydrates %s into the request and the control", (search, request, testId, shown) => {
    mountDiscovery(search);
    expect(lastRequest()).toMatchObject(request);
    expect(screen.getByTestId(testId)).toHaveValue(shown);
  });

  it("hydrates a compound URL into every control at once", () => {
    mountDiscovery(
      "q=Anton&age_min=22&position_group=ATT&role=inside_forward&league=Bundesliga" +
        "&club=Leverkusen&nationality=Germany&min_minutes=900&rolefit_min=60&rolefit_max=95" +
        "&playstyle=box_crasher&value_min=5000000&value_max=12500000&sort=name_asc&page_size=24",
    );
    expect(lastRequest()).toMatchObject({
      q: "Anton",
      age_min: 22,
      position_group: "ATT",
      role: "inside_forward",
      league: "Bundesliga",
      club: "Leverkusen",
      nationality: "Germany",
      min_minutes: 900,
      rolefit_min: 60,
      rolefit_max: 95,
      playstyle: "box_crasher",
      value_min: 5_000_000,
      value_max: 12_500_000,
      sort: "name_asc",
      page_size: 24,
      scope: "analyzed",
      page: 1,
    });

    expect(screen.getByTestId("search-input")).toHaveValue("Anton");
    expect(screen.getByTestId("age-threshold-value")).toHaveTextContent("22 Years");
    expect(screen.getByTestId("position-group-filter")).toHaveValue("ATT");
    expect(screen.getByTestId("role-filter")).toHaveValue("inside_forward");
    expect(screen.getByTestId("league-filter")).toHaveValue("Bundesliga");
    expect(screen.getByTestId("club-filter")).toHaveValue("Leverkusen");
    expect(screen.getByTestId("nationality-filter")).toHaveValue("Germany");
    expect(screen.getByTestId("min-minutes-filter")).toHaveValue(900);
    expect(screen.getByTestId("rolefit-min-filter")).toHaveValue(60);
    expect(screen.getByTestId("rolefit-max-filter")).toHaveValue(95);
    expect(screen.getByTestId("playstyle-filter")).toHaveValue("box_crasher");
    expect(screen.getByTestId("value-min-filter")).toHaveValue("5");
    expect(screen.getByTestId("value-max-filter")).toHaveValue("12.5");
    expect(screen.getByTestId("sort-filter")).toHaveValue("name_asc");

    // 13 narrowing criteria; sort, page_size and scope are not among them
    expect(screen.getByTestId("active-criteria-count")).toHaveTextContent("13 Active Criteria");
    expect(screen.getByTestId("result-count")).toHaveTextContent("13 active criteria");
  });

  it("composes every criterion into ONE request, with nothing filtered in the browser", () => {
    mountDiscovery("league=Bundesliga&club=Leverkusen&rolefit_min=60&playstyle=box_crasher");
    // AND semantics are the backend's: the frontend sends one request carrying
    // every predicate and renders exactly the rows it returns.
    expect(usePlayerSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        league: "Bundesliga",
        club: "Leverkusen",
        rolefit_min: 60,
        playstyle: "box_crasher",
      }),
    );
    expect(screen.getAllByTestId("result-row")).toHaveLength(2);
  });

  it("omits every default from the canonical URL", () => {
    mountDiscovery();
    fireEvent.change(screen.getByTestId("league-filter"), { target: { value: "Bundesliga" } });
    const params = lastParams();
    expect([...params.keys()]).toEqual(["league"]);
    for (const key of ["scope", "sort", "page", "page_size"]) {
      expect(params.has(key), key).toBe(false);
    }
  });

  it("resets pagination on every new advanced field", () => {
    for (const [testId, value] of [
      ["league-filter", "Bundesliga"],
      ["club-filter", "Leverkusen"],
      ["nationality-filter", "Germany"],
      ["min-minutes-filter", "900"],
      ["rolefit-min-filter", "60"],
      ["rolefit-max-filter", "90"],
      ["value-min-filter", "5"],
      ["value-max-filter", "20"],
    ] as const) {
      const view = mountDiscovery("page=3");
      fireEvent.change(screen.getByTestId(testId), { target: { value } });
      expect(lastParams().has("page"), testId).toBe(false);
      view.unmount();
    }

    const view = mountDiscovery("page=3");
    fireEvent.change(screen.getByTestId("playstyle-filter"), { target: { value: "box_crasher" } });
    expect(lastParams().has("page")).toBe(false);
    view.unmount();
  });

  it("preserves every unrelated criterion when one changes", () => {
    mountDiscovery("q=Anton&role=inside_forward&min_minutes=900&value_max=20000000");
    fireEvent.change(screen.getByTestId("league-filter"), { target: { value: "Bundesliga" } });
    const params = lastParams();
    expect(params.get("q")).toBe("Anton");
    expect(params.get("role")).toBe("inside_forward");
    expect(params.get("min_minutes")).toBe("900");
    expect(params.get("value_max")).toBe("20000000");
    expect(params.get("league")).toBe("Bundesliga");
  });

  it("restores identical state on reload and on back/forward", () => {
    const url = "league=Bundesliga&rolefit_max=80&value_min=5000000&club=Leverkusen";
    const first = mountDiscovery(url);
    const initialRequest = lastRequest();
    first.unmount();

    // reload: the same URL produces the same request and the same controls
    const reload = mountDiscovery(url);
    expect(lastRequest()).toEqual(initialRequest);
    expect(screen.getByTestId("value-min-filter")).toHaveValue("5");
    reload.unmount();

    // forward to a different filtered URL...
    const forward = mountDiscovery("nationality=Germany");
    expect(lastRequest()).toMatchObject({ nationality: "Germany" });
    expect(lastRequest().league).toBeUndefined();
    forward.unmount();

    // ...and back to the first one, rebuilt from the URL alone
    mountDiscovery(url);
    expect(lastRequest()).toEqual(initialRequest);
    expect(screen.getByTestId("league-filter")).toHaveValue("Bundesliga");
    expect(screen.getByTestId("rolefit-max-filter")).toHaveValue(80);
  });

  it("uses replace-style history writes so typing adds no entry per keystroke", () => {
    const push = vi.spyOn(window.history, "pushState");
    mountDiscovery();
    for (const value of ["B", "Bu", "Bun"]) {
      fireEvent.change(screen.getByTestId("league-filter"), { target: { value } });
    }
    expect(push).not.toHaveBeenCalled();
    expect(replaceStateSpy).toHaveBeenCalledTimes(3);
    push.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Expected-asking inputs
// ---------------------------------------------------------------------------
describe("Expected-asking inputs", () => {
  it("is typed in EUR millions and serialized as absolute EUR", () => {
    mountDiscovery();
    fireEvent.change(screen.getByTestId("value-min-filter"), { target: { value: "5" } });
    expect(lastParams().get("value_min")).toBe("5000000");

    fireEvent.change(screen.getByTestId("value-max-filter"), { target: { value: "12.5" } });
    expect(lastParams().get("value_max")).toBe("12500000");
    expect(lastRequest()).toMatchObject({ value_min: 5_000_000, value_max: 12_500_000 });
  });

  it("declares the unit in the label and explains it in the helper copy", () => {
    mountDiscovery();
    for (const id of ["value-min-filter", "value-max-filter"]) {
      const input = screen.getByTestId(id);
      expect(input).toHaveAccessibleName(expect.stringContaining("Expected Asking"));
      expect(input).toHaveAccessibleName(expect.stringContaining("€M"));
      expect(input).toHaveAttribute("aria-describedby", "advanced-market-help");
      // A TEXT input with a decimal keypad, deliberately: the browser's own number
      // sanitization is what destroyed the intermediate "12." while typing 12.5.
      expect(input).toHaveAttribute("type", "text");
      expect(input).toHaveAttribute("inputmode", "decimal");
      expect(input).not.toHaveAttribute("step");
    }
    const help = document.getElementById("advanced-market-help")!;
    expect(help.textContent).toMatch(/EUR millions/);
    expect(help.textContent).toContain("12.5");
    expect(help.textContent).toMatch(/overlaps/i);
    // honest about missing market data, and never about an exact transfer value
    expect(help.textContent).toMatch(/excluded/i);
    expect(help.textContent).not.toMatch(/transfer fee|exact value|will cost/i);
  });

  it("says Expected Asking everywhere, never a bare transfer value", () => {
    const { container } = mountDiscovery("value_min=5000000");
    expect(container.textContent).toMatch(/Expected Asking/);
    expect(container.textContent).not.toMatch(/Transfer Value|Market Price|Exact Value/i);
  });

  it("treats a blank field as no bound and a zero as a real bound", () => {
    const blank = mountDiscovery("value_min=5000000");
    fireEvent.change(screen.getByTestId("value-min-filter"), { target: { value: "" } });
    expect(lastParams().has("value_min")).toBe(false);
    expect(lastRequest().value_min).toBeUndefined();
    blank.unmount();

    mountDiscovery();
    fireEvent.change(screen.getByTestId("value-min-filter"), { target: { value: "0" } });
    expect(lastParams().get("value_min")).toBe("0");
    expect(lastRequest()).toMatchObject({ value_min: 0 });
    // a zero bound is a real, listed, removable criterion
    expect(screen.getByTestId("active-criteria-count")).toHaveTextContent("1 Active Criterion");
  });

  it.each(["-5", "abc", "Infinity"])("does not forward the invalid URL bound %s", (raw) => {
    mountDiscovery(`value_min=${raw}`);
    expect(lastRequest().value_min).toBeUndefined();
    expect(screen.getByTestId("value-min-filter")).toHaveValue("");
  });

  it("preserves a representable hard-loaded value exactly", () => {
    mountDiscovery("value_min=1234567");
    expect(lastRequest()).toMatchObject({ value_min: 1_234_567 });
    expect(screen.getByTestId("value-min-filter")).toHaveValue("1.234567");
    // and re-emitting it does not rewrite the euros
    fireEvent.change(screen.getByTestId("value-max-filter"), { target: { value: "20" } });
    expect(lastParams().get("value_min")).toBe("1234567");
  });

  it("reads the bounds back through the shared currency formatter", () => {
    mountDiscovery("value_min=5000000&value_max=12500000");
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    const rows = screen.getAllByTestId("active-criterion").map((r) => r.textContent);
    expect(rows.some((r) => r?.includes("€5.0M"))).toBe(true);
    expect(rows.some((r) => r?.includes("€12.5M"))).toBe(true);
    // no midpoint of the two is ever computed or shown
    expect(rows.join(" ")).not.toContain("8.75");
  });
});

// ---------------------------------------------------------------------------
// Sequential decimal typing
//
// The parser always understood "12.5"; the CONTROL did not. As a plain controlled
// number input it re-derived from the canonical URL value on every keystroke, so the
// intermediate "12." was rewritten before the "5" could be typed. These cases feed one
// character at a time, which is the only way the defect shows.
// ---------------------------------------------------------------------------
describe("Expected-asking sequential typing", () => {
  /** Type `text` one character at a time, as a keyboard does. */
  function typeSequentially(el: HTMLElement, text: string) {
    let sofar = "";
    for (const char of text) {
      sofar += char;
      fireEvent.change(el, { target: { value: sofar } });
    }
  }

  it("keeps 12.5 visible while it is typed, and sends absolute EUR", () => {
    mountDiscovery();
    const input = screen.getByTestId("value-min-filter");
    typeSequentially(input, "12.5");
    expect(input).toHaveValue("12.5");
    expect(lastParams().get("value_min")).toBe("12500000");
    expect(lastRequest()).toMatchObject({ value_min: 12_500_000 });
  });

  it("survives the intermediate trailing point", () => {
    mountDiscovery();
    const input = screen.getByTestId("value-min-filter");
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.change(input, { target: { value: "12." } });
    // the point is still on screen, not sanitized away
    expect(input).toHaveValue("12.");
    fireEvent.change(input, { target: { value: "12.5" } });
    expect(input).toHaveValue("12.5");
    expect(lastParams().get("value_min")).toBe("12500000");
  });

  it("handles a leading point and a long decimal", () => {
    mountDiscovery();
    const input = screen.getByTestId("value-min-filter");
    typeSequentially(input, "0.75");
    expect(input).toHaveValue("0.75");
    expect(lastParams().get("value_min")).toBe("750000");

    const max = screen.getByTestId("value-max-filter");
    typeSequentially(max, "1.234567");
    expect(max).toHaveValue("1.234567");
    expect(lastParams().get("value_max")).toBe("1234567");
  });

  it("accepts a pasted value in one change", () => {
    mountDiscovery();
    fireEvent.change(screen.getByTestId("value-min-filter"), { target: { value: "12.5" } });
    expect(screen.getByTestId("value-min-filter")).toHaveValue("12.5");
    expect(lastParams().get("value_min")).toBe("12500000");
  });

  it("supports backspacing back down to blank, which clears the bound", () => {
    mountDiscovery("value_min=12500000");
    const input = screen.getByTestId("value-min-filter");
    expect(input).toHaveValue("12.5");
    for (const value of ["12.", "12", "1", ""]) {
      fireEvent.change(input, { target: { value } });
    }
    expect(input).toHaveValue("");
    expect(lastParams().has("value_min")).toBe(false);
    expect(lastRequest().value_min).toBeUndefined();
  });

  it("holds a malformed draft on screen without ever sending it", () => {
    mountDiscovery("value_min=5000000");
    const input = screen.getByTestId("value-min-filter");
    for (const bad of ["-", "-5", "1.2.3", "abc"]) {
      fireEvent.change(input, { target: { value: bad } });
      expect(input, bad).toHaveValue(bad);
      // Nothing was written at all: no URL update, and the request still carries the
      // last value the two agreed on.
      expect(replaceStateSpy, bad).not.toHaveBeenCalled();
      expect(lastRequest().value_min, bad).toBe(5_000_000);
      expect(input, bad).toHaveAttribute("aria-invalid", "true");
    }
  });

  it("snaps a malformed draft back to the URL on blur", () => {
    mountDiscovery("value_min=5000000");
    const input = screen.getByTestId("value-min-filter");
    fireEvent.change(input, { target: { value: "1.2.3" } });
    expect(input).toHaveValue("1.2.3");
    fireEvent.blur(input);
    expect(input).toHaveValue("5");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("drops the draft when the value changes from outside the control", () => {
    mountDiscovery("value_min=5000000&league=Bundesliga");
    const input = screen.getByTestId("value-min-filter");
    fireEvent.change(input, { target: { value: "9." } });
    expect(input).toHaveValue("9.");

    // Removing the criterion is an outside change: the field must follow the URL.
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    fireEvent.click(screen.getByTestId("remove-criterion-value_min"));
    expect(screen.getByTestId("value-min-filter")).toHaveValue("");
    expect(lastParams().has("value_min")).toBe(false);
    expect(lastParams().get("league")).toBe("Bundesliga");
  });

  it("drops the draft on Clear All and on a replayed URL", () => {
    const view = mountDiscovery("value_min=5000000");
    fireEvent.change(screen.getByTestId("value-min-filter"), { target: { value: "7." } });
    fireEvent.click(screen.getByTestId("clear-all-filters"));
    expect(screen.getByTestId("value-min-filter")).toHaveValue("");
    expect(lastUrl()).toBe("/");
    view.unmount();

    // back/forward replays a URL: the control rebuilds from it, draft or no draft
    mountDiscovery("value_min=12500000");
    expect(screen.getByTestId("value-min-filter")).toHaveValue("12.5");
  });

  it("keeps the coherent min/max rule while typing", () => {
    mountDiscovery("value_max=2000000");
    typeSequentially(screen.getByTestId("value-min-filter"), "50");
    // the edited bound wins and its companion follows, mid-typing included
    expect(lastParams().get("value_min")).toBe("50000000");
    expect(lastParams().get("value_max")).toBe("50000000");
    expect(screen.getByTestId("value-max-filter")).toHaveValue("50");
  });

  it("pulls the companion on every keystroke, including the intermediate ones", () => {
    // Documented consequence of combining a per-keystroke commit with "the edited
    // bound wins and its companion follows": typing a LARGE maximum passes through
    // small intermediate values, and each one drags the minimum down with it.
    //
    // Pinned rather than worked around. The alternative — deferring the pull —
    // would let `min > max` reach the API between keystrokes, and that is the one
    // thing the rule exists to prevent. Both fields update visibly together, the
    // URL always matches them, and nothing invalid is ever sent.
    mountDiscovery("value_min=12500000");
    typeSequentially(screen.getByTestId("value-max-filter"), "120.75");
    expect(lastParams().get("value_max")).toBe("120750000");
    // the minimum followed the first intermediate maximum ("1") down and stayed
    expect(lastParams().get("value_min")).toBe("1000000");
    expect(screen.getByTestId("value-min-filter")).toHaveValue("1");
    // ...and the pair is still coherent, which is the invariant that matters
    expect(Number(lastParams().get("value_min"))).toBeLessThanOrEqual(
      Number(lastParams().get("value_max")),
    );
  });
});

// ---------------------------------------------------------------------------
// Free-text trimming
// ---------------------------------------------------------------------------
describe("Free-text predicates are trimmed on the way out", () => {
  it("lets a multi-word club name be typed one character at a time", () => {
    mountDiscovery();
    const club = screen.getByTestId("club-filter");
    let sofar = "";
    for (const char of "Paris Saint-Germain") {
      sofar += char;
      fireEvent.change(club, { target: { value: sofar } });
    }
    // The space between the words survived - trimming a controlled input naively
    // would have swallowed it the moment "Paris " was typed.
    expect(club).toHaveValue("Paris Saint-Germain");
    expect(lastParams().get("club")).toBe("Paris Saint-Germain");
  });

  it("shows the raw text while typing but sends the trimmed value", () => {
    mountDiscovery();
    const club = screen.getByTestId("club-filter");
    fireEvent.change(club, { target: { value: "Paris " } });
    expect(club).toHaveValue("Paris ");
    expect(lastParams().get("club")).toBe("Paris");
    expect(lastRequest()).toMatchObject({ club: "Paris" });
  });

  it("settles on the trimmed value when the field is left", () => {
    mountDiscovery();
    const club = screen.getByTestId("club-filter");
    fireEvent.change(club, { target: { value: "  Leverkusen  " } });
    expect(lastParams().get("club")).toBe("Leverkusen");
    fireEvent.blur(club);
    expect(club).toHaveValue("Leverkusen");
  });

  it("treats whitespace-only input as no predicate", () => {
    mountDiscovery("club=Leverkusen");
    fireEvent.change(screen.getByTestId("club-filter"), { target: { value: "   " } });
    expect(lastParams().has("club")).toBe(false);
    expect(lastRequest().club).toBeUndefined();
  });

  it("trims every free-text predicate, including Search", () => {
    for (const [testId, param] of [
      ["search-input", "q"],
      ["league-filter", "league"],
      ["club-filter", "club"],
      ["nationality-filter", "nationality"],
    ] as const) {
      const view = mountDiscovery();
      fireEvent.change(screen.getByTestId(testId), { target: { value: "  Anton  " } });
      expect(lastParams().get(param), testId).toBe("Anton");
      view.unmount();
    }
  });

  it("trims a hard-loaded URL value too, so the summary and request agree", () => {
    mountDiscovery("club=%20Leverkusen%20");
    expect(lastRequest()).toMatchObject({ club: "Leverkusen" });
    expect(screen.getByTestId("club-filter")).toHaveValue("Leverkusen");
    expect(screen.getByTestId("active-criteria-summary")).toHaveTextContent("Club: Leverkusen");
  });
});

// ---------------------------------------------------------------------------
// Context semantics are stated, and alias values stay readable
// ---------------------------------------------------------------------------
describe("Context criteria stay readable", () => {
  it("shows a club alias exactly as it was typed", () => {
    // The rail never rewrites the input into the clubs it resolved to: the criterion
    // is what the scout asked for, and the ledger shows what it found.
    mountDiscovery("club=psg");
    expect(screen.getByTestId("active-criteria-summary")).toHaveTextContent("Club: psg");
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    expect(screen.getByTestId("active-criterion-value")).toHaveTextContent("psg");
    expect(screen.getByTestId("remove-criterion-club")).toHaveAccessibleName("Remove Club: psg.");
  });

  it("keeps a partial nationality and a league country readable", () => {
    mountDiscovery("nationality=Eng&league=England");
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    const rows = screen.getAllByTestId("active-criterion").map((r) => r.textContent);
    expect(rows.some((r) => r?.includes("Eng"))).toBe(true);
    expect(rows.some((r) => r?.includes("England"))).toBe(true);
  });

  it("removes one Context criterion and preserves the others", () => {
    mountDiscovery("league=England&club=psg&nationality=Eng&page=3");
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    fireEvent.click(screen.getByTestId("remove-criterion-club"));
    const params = lastParams();
    expect(params.has("club")).toBe(false);
    expect(params.get("league")).toBe("England");
    expect(params.get("nationality")).toBe("Eng");
    expect(params.has("page")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Range invariants
// ---------------------------------------------------------------------------
describe("Range invariants", () => {
  it("never emits a RoleFit min above its max, whichever side is edited", () => {
    mountDiscovery("rolefit_max=20");
    fireEvent.change(screen.getByTestId("rolefit-min-filter"), { target: { value: "80" } });
    // the edited bound wins; its companion follows
    expect(lastParams().get("rolefit_min")).toBe("80");
    expect(lastParams().get("rolefit_max")).toBe("80");

    mountDiscovery("rolefit_min=80");
    fireEvent.change(screen.getAllByTestId("rolefit-max-filter").at(-1)!, {
      target: { value: "20" },
    });
    expect(lastParams().get("rolefit_min")).toBe("20");
    expect(lastParams().get("rolefit_max")).toBe("20");
  });

  it("never emits an asking min above its max, whichever side is edited", () => {
    mountDiscovery("value_max=2000000");
    fireEvent.change(screen.getByTestId("value-min-filter"), { target: { value: "50" } });
    expect(lastParams().get("value_min")).toBe("50000000");
    expect(lastParams().get("value_max")).toBe("50000000");

    mountDiscovery("value_min=50000000");
    fireEvent.change(screen.getAllByTestId("value-max-filter").at(-1)!, { target: { value: "2" } });
    expect(lastParams().get("value_min")).toBe("2000000");
    expect(lastParams().get("value_max")).toBe("2000000");
  });

  it("normalizes an inverted hard-loaded pair so the request stays valid", () => {
    mountDiscovery("rolefit_min=80&rolefit_max=20&value_min=50000000&value_max=2000000");
    // The minimum is authoritative when there is no edited side.
    expect(lastRequest()).toMatchObject({
      rolefit_min: 80,
      rolefit_max: 80,
      value_min: 50_000_000,
      value_max: 50_000_000,
    });
    // control, request and summary all agree on the normalized pair
    expect(screen.getByTestId("rolefit-max-filter")).toHaveValue(80);
    expect(screen.getByTestId("value-max-filter")).toHaveValue("50");
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    const rows = screen.getAllByTestId("active-criterion").map((r) => r.textContent!.replace(/\s+/g, " "));
    expect(rows.some((r) => /Maximum RoleFit ?80/.test(r))).toBe(true);
    expect(rows.some((r) => /Maximum Expected Asking ?€50\.0M/.test(r))).toBe(true);
  });

  it("changes nothing outside the pair it is correcting", () => {
    mountDiscovery("q=Anton&role=inside_forward&min_minutes=900&rolefit_max=20&club=Leverkusen");
    fireEvent.change(screen.getByTestId("rolefit-min-filter"), { target: { value: "80" } });
    const params = lastParams();
    expect(params.get("q")).toBe("Anton");
    expect(params.get("role")).toBe("inside_forward");
    expect(params.get("min_minutes")).toBe("900");
    expect(params.get("club")).toBe("Leverkusen");
    // and the OTHER pair is untouched
    expect(params.has("value_min")).toBe(false);
    expect(params.has("value_max")).toBe(false);
  });

  it("leaves a one-sided bound one-sided", () => {
    mountDiscovery();
    fireEvent.change(screen.getByTestId("rolefit-max-filter"), { target: { value: "70" } });
    expect(lastParams().get("rolefit_max")).toBe("70");
    expect(lastParams().has("rolefit_min")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Active criteria: summary, removal, reset
// ---------------------------------------------------------------------------
describe("Active criteria area", () => {
  it("summarizes the count plus the first two criteria, then +N more", () => {
    mountDiscovery("q=Anton&age_max=25&league=Bundesliga&club=Leverkusen");
    expect(screen.getByTestId("active-criteria-count")).toHaveTextContent("4 Active Criteria");
    const summary = screen.getByTestId("active-criteria-summary");
    expect(summary).toHaveTextContent("Search: Anton");
    expect(summary).toHaveTextContent("Age: 25 Years And Younger");
    expect(summary).toHaveTextContent("+2 more");
    // the third and fourth are NOT spelled out in the collapsed line
    expect(summary.textContent).not.toContain("Bundesliga");
  });

  it("omits +N more when everything already fits", () => {
    mountDiscovery("league=Bundesliga");
    expect(screen.getByTestId("active-criteria-count")).toHaveTextContent("1 Active Criterion");
    expect(screen.getByTestId("active-criteria-summary").textContent).not.toContain("more");
  });

  it("truncates a long value instead of widening the rail", () => {
    mountDiscovery(`q=${"Maximiliaan Van Der Steenhuizen-Oppenheimer".repeat(3)}`);
    expect(screen.getByTestId("active-criteria-summary").className).toContain("truncate");
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    expect(screen.getByTestId("active-criterion-value").className).toContain("truncate");
  });

  it("is a disclosure over one flat rectangular row per criterion", () => {
    mountDiscovery("q=Anton&league=Bundesliga&value_min=5000000");
    const toggle = screen.getByTestId("active-criteria-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBe(
      screen.getByTestId("active-criteria-region"),
    );
    expect(screen.getByTestId("active-criteria-region")).toHaveAttribute("hidden");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const rows = screen.getAllByTestId("active-criterion");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.tagName).toBe("LI");
      // states the field AND the readable value
      expect(row.querySelector(".label")!.textContent).toBeTruthy();
      expect(within(row).getByTestId("active-criterion-value").textContent).toBeTruthy();
    }
  });

  it("is not rendered as a DisplayTag or a rounded chip", () => {
    mountDiscovery("league=Bundesliga");
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    const area = screen.getByTestId("active-criteria");
    // These are interactive filter controls, not semantic display labels.
    expect(area.querySelector("[data-tag-variant]")).toBeNull();
    expect(area.querySelector(".display-tag")).toBeNull();
    for (const el of [area, ...Array.from(area.querySelectorAll<HTMLElement>("*"))]) {
      expect(el.getAttribute("class") ?? "").not.toMatch(/(?:^|\s)rounded(?:-|\s|$)/);
    }
  });

  it("names every remove action after the criterion it removes", () => {
    mountDiscovery("league=Bundesliga&value_min=5000000&age_min=28");
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    expect(screen.getByTestId("remove-criterion-league")).toHaveAccessibleName(
      "Remove League: Bundesliga.",
    );
    expect(screen.getByTestId("remove-criterion-value_min")).toHaveAccessibleName(
      "Remove Minimum Expected Asking: €5.0M.",
    );
    expect(screen.getByTestId("remove-criterion-age")).toHaveAccessibleName(
      "Remove Age: 28 Years And Older.",
    );
  });

  it("removes only the chosen criterion's parameters and resets the page", () => {
    mountDiscovery("q=Anton&league=Bundesliga&club=Leverkusen&rolefit_min=60&page=3");
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    fireEvent.click(screen.getByTestId("remove-criterion-league"));

    const params = lastParams();
    expect(params.has("league")).toBe(false);
    expect(params.get("q")).toBe("Anton");
    expect(params.get("club")).toBe("Leverkusen");
    expect(params.get("rolefit_min")).toBe("60");
    expect(params.has("page")).toBe(false);
  });

  it("removes both age bounds and the legacy band when Age is removed", () => {
    mountDiscovery("age_band=u23&club=Leverkusen");
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    fireEvent.click(screen.getByTestId("remove-criterion-age"));
    const params = lastParams();
    for (const key of ["age_min", "age_max", "age_band"]) expect(params.has(key)).toBe(false);
    expect(params.get("club")).toBe("Leverkusen");
  });

  it("removes one half of a range pair without touching the other", () => {
    mountDiscovery("rolefit_min=60&rolefit_max=95");
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    fireEvent.click(screen.getByTestId("remove-criterion-rolefit_max"));
    expect(lastParams().get("rolefit_min")).toBe("60");
    expect(lastParams().has("rolefit_max")).toBe(false);
  });

  it("keeps focus inside the rail after a removal", () => {
    mountDiscovery("league=Bundesliga&club=Leverkusen&nationality=Germany");
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    const remove = screen.getByTestId("remove-criterion-club");
    remove.focus();
    fireEvent.click(remove);

    // The removed button is gone; focus is on the action that took its place,
    // never on <body>.
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByTestId("filter-rail")).toContainElement(document.activeElement as HTMLElement);
  });

  it("lands focus on Search once the last criterion is gone", () => {
    mountDiscovery("league=Bundesliga");
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    fireEvent.click(screen.getByTestId("remove-criterion-league"));
    expect(screen.queryByTestId("active-criteria")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("search-input"));
  });
});

// ---------------------------------------------------------------------------
// Clear All
// ---------------------------------------------------------------------------
describe("Clear All", () => {
  it("returns to the clean root URL from a fully compound one", () => {
    mountDiscovery(
      "q=Anton&age_min=22&position_group=ATT&role=inside_forward&league=Bundesliga" +
        "&club=Leverkusen&nationality=Germany&min_minutes=900&rolefit_min=60&rolefit_max=95" +
        "&playstyle=box_crasher&value_min=5000000&value_max=12500000&sort=name_asc&page=3&page_size=48",
    );
    fireEvent.click(screen.getByTestId("clear-all-filters"));
    expect(lastUrl()).toBe("/");
  });

  it("restores the established default request exactly", () => {
    mountDiscovery("league=Bundesliga&sort=name_asc&page=3&page_size=48");
    fireEvent.click(screen.getByTestId("clear-all-filters"));
    expect(lastRequest()).toEqual({
      scope: "analyzed",
      sort: "rolefit_desc",
      page: 1,
      page_size: 12,
    });
  });

  it("drops the legacy hidden scope, universe and age_band parameters", () => {
    mountDiscovery("scope=all_records&universe=mvp&age_band=u23&league=Bundesliga");
    // they were honoured on the way in (age_band=u23 normalizes to age_max=22)...
    expect(lastRequest()).toMatchObject({ scope: "all_records", age_max: 22 });
    fireEvent.click(screen.getByTestId("clear-all-filters"));
    // ...and are gone from the canonical URL afterwards
    expect(lastUrl()).toBe("/");
    expect(lastRequest()).toMatchObject({ scope: "analyzed" });
  });

  it("is available while the criteria list is collapsed", () => {
    mountDiscovery("league=Bundesliga");
    expect(screen.getByTestId("active-criteria-region")).toHaveAttribute("hidden");
    expect(screen.getByTestId("clear-all-filters")).toBeVisible();
    expect(screen.getByTestId("clear-all-filters")).toHaveAccessibleName("Clear All");
  });

  it("does not touch device-local shortlist or compare state", () => {
    window.localStorage.setItem("scoutboy.shortlist.v1", JSON.stringify([7]));
    window.localStorage.setItem("scoutboy.compare.v1", JSON.stringify([7, 8]));
    mountDiscovery("league=Bundesliga");
    fireEvent.click(screen.getByTestId("clear-all-filters"));
    expect(window.localStorage.getItem("scoutboy.shortlist.v1")).toBe("[7]");
    expect(window.localStorage.getItem("scoutboy.compare.v1")).toBe("[7,8]");
    window.localStorage.clear();
  });
});

// ---------------------------------------------------------------------------
// Unsupported filters stay absent
// ---------------------------------------------------------------------------
describe("Unsupported filters remain absent", () => {
  it("exposes no control for scope, universe, legacy age band, confidence, evidence or concern", () => {
    const { container } = mountDiscovery();
    fireEvent.click(screen.getByTestId("advanced-filters-toggle"));
    for (const category of ADVANCED_CATEGORIES) fireEvent.click(categoryToggle(category.key));

    const rail = screen.getByTestId("filter-rail");
    for (const id of ["scope-filter", "universe-filter", "age-band-filter", "confidence-filter", "evidence-filter", "concern-filter"]) {
      expect(screen.queryByTestId(id), id).not.toBeInTheDocument();
    }
    // No FIELD offers them either. Asserted on the rail's own field labels rather
    // than on its prose, because the Evidence & Fit helper legitimately mentions
    // concerns in order to rule them out ("a qualifying strength, never a concern").
    const labels = Array.from(rail.querySelectorAll(".label")).map((el) =>
      el.textContent!.trim(),
    );
    for (const banned of [
      "Analysis Scope",
      "Universe",
      "Age Band",
      "Confidence",
      "RoleFit Confidence",
      "Evidence",
      "Evidence State",
      "Concern",
      "Concerns",
    ]) {
      expect(labels, banned).not.toContain(banned);
    }
    expect(rail.textContent).not.toMatch(/analysis scope|universe|age band/i);
    expect(rail.textContent).not.toMatch(/evidence state/i);
    // and the request never carries an invented parameter
    for (const key of ["confidence", "evidence_status", "concern", "universe", "age_band"]) {
      expect(lastRequest()[key], key).toBeUndefined();
    }
    expect(container.textContent).not.toMatch(/High-coverage U23|All records/);
  });

  it("only ever sends parameters the search contract already accepts", () => {
    mountDiscovery(
      "q=Anton&age_max=25&position_group=ATT&role=inside_forward&league=Bundesliga" +
        "&club=Leverkusen&nationality=Germany&min_minutes=900&rolefit_min=60&rolefit_max=95" +
        "&playstyle=box_crasher&value_min=5000000&value_max=12500000",
    );
    const SUPPORTED = new Set([
      "q",
      "age_min",
      "age_max",
      "age_band",
      "position_group",
      "role",
      "league",
      "club",
      "nationality",
      "min_minutes",
      "rolefit_min",
      "rolefit_max",
      "playstyle",
      "value_min",
      "value_max",
      "sort",
      "scope",
      "universe",
      "page",
      "page_size",
    ]);
    for (const key of Object.keys(lastRequest())) expect(SUPPORTED, key).toContain(key);
  });
});

// ---------------------------------------------------------------------------
// Empty-result recovery
// ---------------------------------------------------------------------------
describe("Empty-result recovery", () => {
  beforeEach(() => {
    usePlayerSearchMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { items: [], total: 0, page: 1, page_size: 12, total_pages: 0 },
    });
  });

  it("leaves the whole rail usable, and says how to recover", () => {
    mountDiscovery("league=Nowhere&rolefit_min=99&value_min=900000000");
    expect(screen.getByText(/No players match these filters/)).toBeInTheDocument();
    // the rail is a sibling of the results pane and is completely unaffected
    expect(screen.getByTestId("filter-rail")).toBeInTheDocument();
    expect(screen.getByTestId("clear-all-filters")).toBeVisible();
    expect(screen.getByText(/Remove one of the 3 active criteria/)).toBeInTheDocument();
  });

  it("lets one criterion be removed without a reload", () => {
    mountDiscovery("league=Nowhere&rolefit_min=99");
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    fireEvent.click(screen.getByTestId("remove-criterion-rolefit_min"));
    expect(lastParams().get("league")).toBe("Nowhere");
    expect(lastParams().has("rolefit_min")).toBe(false);
  });

  it("lets everything be cleared without a reload", () => {
    mountDiscovery("league=Nowhere&rolefit_min=99");
    fireEvent.click(screen.getByTestId("clear-all-filters"));
    expect(lastUrl()).toBe("/");
  });

  it("keeps the original advice when nothing is active", () => {
    mountDiscovery();
    expect(screen.getByText(/Try widening the age range or clearing a filter/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DOM / tab order
// ---------------------------------------------------------------------------
describe("Logical DOM and tab order", () => {
  it("orders the rail's focusable controls the way it reads", () => {
    mountDiscovery("league=Bundesliga");
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    fireEvent.click(screen.getByTestId("advanced-filters-toggle"));

    const focusable = Array.from(
      screen
        .getByTestId("filter-rail")
        .querySelectorAll<HTMLElement>("button, input, select, [tabindex]"),
    )
      .filter((el) => el.offsetParent !== null || el.dataset.testid != null)
      .map((el) => el.dataset.testid ?? el.tagName.toLowerCase());

    const order = (id: string) => focusable.indexOf(id);
    // active criteria, then the core controls, then Advanced Filters
    expect(order("active-criteria-toggle")).toBeLessThan(order("clear-all-filters"));
    expect(order("clear-all-filters")).toBeLessThan(order("remove-criterion-league"));
    expect(order("remove-criterion-league")).toBeLessThan(order("search-input"));
    expect(order("search-input")).toBeLessThan(order("age-threshold-slider"));
    expect(order("age-threshold-slider")).toBeLessThan(order("position-group-filter"));
    expect(order("position-group-filter")).toBeLessThan(order("role-filter"));
    expect(order("role-filter")).toBeLessThan(order("sort-filter"));
    expect(order("sort-filter")).toBeLessThan(order("advanced-filters-toggle"));
    expect(order("advanced-filters-toggle")).toBeLessThan(
      order("advanced-category-toggle-context"),
    );
    expect(order("advanced-category-toggle-context")).toBeLessThan(order("league-filter"));
    expect(order("league-filter")).toBeLessThan(order("advanced-category-toggle-evidence"));
    expect(order("advanced-category-toggle-evidence")).toBeLessThan(
      order("advanced-category-toggle-market"),
    );
  });

  it("adds no positive tabindex and traps focus nowhere", () => {
    mountDiscovery("league=Bundesliga");
    fireEvent.click(screen.getByTestId("advanced-filters-toggle"));
    fireEvent.click(screen.getByTestId("active-criteria-toggle"));
    const rail = screen.getByTestId("filter-rail");
    for (const el of Array.from(rail.querySelectorAll("[tabindex]"))) {
      expect(Number(el.getAttribute("tabindex"))).toBeLessThanOrEqual(0);
    }
    // no dialog/modal semantics anywhere in an inline disclosure
    expect(rail.querySelector('[role="dialog"], [aria-modal="true"]')).toBeNull();
  });
});
