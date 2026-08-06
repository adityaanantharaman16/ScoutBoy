import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AGE_STOPS } from "@/lib/filters";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";
import type { PlayerSearchCard } from "@/lib/api/types";

// ---- routing + data are mocked so the discovery surface renders standalone ----
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
vi.mock("@/lib/api/hooks", () => ({ usePlayerSearch: usePlayerSearchMock }));

// The rail writes its URL through the native History API (see SearchExperience for
// why), so that is what the assertions observe.
const replaceStateSpy = vi.spyOn(window.history, "replaceState");

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

/** The single URL the last filter interaction wrote. */
function lastUrl(): string {
  return replaceStateSpy.mock.calls.at(-1)![2] as string;
}

/** The filters object the results hook was last asked to fetch. */
function lastRequest() {
  return usePlayerSearchMock.mock.calls.at(-1)![0];
}

// The default response reports the page the default request asked for (1 of 4), so
// no test is incidentally exercising the out-of-range page canonicalization. The
// cases that DO exercise it set their own mock.
beforeEach(() => {
  replaceStateSpy.mockClear();
  usePlayerSearchMock.mockReset();
  usePlayerSearchMock.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { items: [card(), card({ id: 2, canonical_name: "Jack Whitmore" })], total: 37, page: 1, page_size: 12, total_pages: 4 },
  });
});

// ---------------------------------------------------------------------------
// Analysis scope is gone from the surface, not from the API contract
// ---------------------------------------------------------------------------
describe("Discovery filter rail: retired Analysis scope", () => {
  it("exposes no scope selector or helper copy anywhere in the rail", () => {
    const { container } = mountDiscovery();
    expect(screen.queryByTestId("scope-filter")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scope-description")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/analysis scope/i)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/analysis scope/i);
    // none of the retired option labels survive as visible copy either
    expect(container.textContent).not.toMatch(/All records|High-coverage U23/);
  });

  it("still requests the default analyzed pool", () => {
    mountDiscovery();
    expect(lastRequest()).toMatchObject({ scope: "analyzed" });
  });

  it("keeps the global scope/evidence banner, which is not the retired filter", () => {
    mountDiscovery();
    expect(screen.getByTestId("scope-banner")).toHaveTextContent("RoleFit analysis");
  });

  it("loads an existing scope-bearing URL safely and forwards it unchanged", () => {
    mountDiscovery("scope=all_records");
    expect(lastRequest()).toMatchObject({ scope: "all_records" });
    expect(screen.getByTestId("results-ledger")).toBeInTheDocument();
  });

  it("falls back to the default for an unknown scope rather than forwarding it", () => {
    mountDiscovery("scope=not_a_scope");
    expect(lastRequest()).toMatchObject({ scope: "analyzed" });
  });
});

// ---------------------------------------------------------------------------
// The five-stop directional age control
// ---------------------------------------------------------------------------
describe("Discovery age threshold control", () => {
  const slider = () => screen.getByTestId("age-threshold-slider") as HTMLInputElement;

  it("is a native range input over exactly the five career stops", () => {
    mountDiscovery();
    expect(AGE_STOPS).toEqual([19, 22, 25, 28, 31]);
    const input = slider();
    expect(input.tagName.toLowerCase()).toBe("input");
    expect(input).toHaveAttribute("type", "range");
    expect(input).toHaveAttribute("min", "19");
    expect(input).toHaveAttribute("max", "31");
    expect(input).toHaveAttribute("step", "3");

    // the rendered stops are the same five values, in order
    expect(
      screen.getAllByTestId("age-slider-stop").map((s) => Number(s.dataset.ageStop)),
    ).toEqual([19, 22, 25, 28, 31]);
  });

  it("labels the scale Youth / Seasoned and shows the active threshold", () => {
    mountDiscovery();
    expect(screen.getByText("Youth")).toBeInTheDocument();
    expect(screen.getByText("Seasoned")).toBeInTheDocument();
    expect(screen.getByTestId("age-threshold-value")).toHaveTextContent("25 Years");
  });

  it("carries an accessible label and announces the full semantics, not a bare number", () => {
    mountDiscovery("age_max=25");
    expect(slider()).toHaveAccessibleName("Age threshold");
    expect(slider()).toHaveAttribute("aria-valuetext", "25 Years And Younger");
    expect(slider()).toHaveValue("25");

    mountDiscovery("age_min=28");
    const older = screen.getAllByTestId("age-threshold-slider").at(-1)!;
    expect(older).toHaveAttribute("aria-valuetext", "28 Years And Older");
  });

  it("names the direction controls unambiguously and marks exactly one as pressed", () => {
    mountDiscovery();
    // default state: no age bound at all
    expect(screen.getByTestId("age-direction-all")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("age-direction-younger")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("age-direction-older")).toHaveAttribute("aria-pressed", "false");

    expect(screen.getByTestId("age-direction-younger")).toHaveAccessibleName(
      "25 Years And Younger",
    );
    expect(screen.getByTestId("age-direction-older")).toHaveAccessibleName("25 Years And Older");
    // visible copy is words, never a lone arrow glyph
    expect(screen.getByTestId("age-direction-younger").textContent).toBe("Younger");
    expect(screen.getByTestId("age-direction-older").textContent).toBe("Older");
    expect(screen.getByTestId("age-direction-all").textContent).toBe("All Ages");
  });

  it("emits only age_max in younger mode", () => {
    mountDiscovery();
    fireEvent.click(screen.getByTestId("age-direction-younger"));
    expect(lastUrl()).toContain("age_max=25");
    expect(lastUrl()).not.toContain("age_min");
    expect(lastUrl()).not.toContain("age_band");
  });

  it("emits only age_min in older mode, clearing a previous age_max", () => {
    mountDiscovery("age_max=25");
    fireEvent.click(screen.getByTestId("age-direction-older"));
    expect(lastUrl()).toContain("age_min=25");
    expect(lastUrl()).not.toContain("age_max");
  });

  it("applies the moved threshold, defaulting to younger when no direction was active", () => {
    mountDiscovery();
    fireEvent.change(slider(), { target: { value: "31" } });
    expect(lastUrl()).toContain("age_max=31");
    expect(lastUrl()).not.toContain("age_min");
  });

  it("keeps the active direction when the threshold moves", () => {
    mountDiscovery("age_min=22");
    fireEvent.change(slider(), { target: { value: "28" } });
    expect(lastUrl()).toContain("age_min=28");
    expect(lastUrl()).not.toContain("age_max");
  });

  it("resets pagination on a direction change and on a threshold change", () => {
    mountDiscovery("page=3");
    fireEvent.click(screen.getByTestId("age-direction-younger"));
    expect(lastUrl()).not.toContain("page=");

    mountDiscovery("page=3&age_max=22");
    fireEvent.change(screen.getAllByTestId("age-threshold-slider").at(-1)!, {
      target: { value: "28" },
    });
    expect(lastUrl()).not.toContain("page=");
  });

  it("removes both bounds on the All Ages reset", () => {
    mountDiscovery("age_min=31&q=Anton");
    fireEvent.click(screen.getByTestId("age-direction-all"));
    expect(lastUrl()).not.toContain("age_min");
    expect(lastUrl()).not.toContain("age_max");
    // unrelated filters survive the reset
    expect(lastUrl()).toContain("q=Anton");
  });

  it("leaves the root Discovery route unfiltered by age", () => {
    mountDiscovery();
    const request = lastRequest();
    expect(request.age_min).toBeUndefined();
    expect(request.age_max).toBeUndefined();
    expect(request.age_band).toBeUndefined();
  });

  // Hydration is the whole back/forward story: the control is derived from the
  // URL's own bounds, so replaying a previous URL restores it exactly.
  it.each([
    ["age_max=22", "22 Years", "age-direction-younger"],
    ["age_min=31", "31 Years", "age-direction-older"],
    ["", "25 Years", "age-direction-all"],
  ])("hydrates %s accurately from the URL", (search, value, pressedTestId) => {
    mountDiscovery(search);
    expect(screen.getByTestId("age-threshold-value")).toHaveTextContent(value);
    expect(screen.getByTestId(pressedTestId)).toHaveAttribute("aria-pressed", "true");
  });

  it("restores the control when navigation replays an earlier URL", () => {
    const { unmount } = mountDiscovery("age_max=19");
    expect(screen.getByTestId("age-threshold-value")).toHaveTextContent("19 Years");
    unmount();

    // forward
    const forward = mountDiscovery("age_min=28");
    expect(screen.getByTestId("age-threshold-value")).toHaveTextContent("28 Years");
    expect(screen.getByTestId("age-direction-older")).toHaveAttribute("aria-pressed", "true");
    forward.unmount();

    // back
    mountDiscovery("age_max=19");
    expect(screen.getByTestId("age-threshold-value")).toHaveTextContent("19 Years");
    expect(screen.getByTestId("age-direction-younger")).toHaveAttribute("aria-pressed", "true");
  });

  it("snaps an off-stop URL bound so the display and the request cannot disagree", () => {
    mountDiscovery("age_max=24");
    expect(screen.getByTestId("age-threshold-value")).toHaveTextContent("25 Years");
    expect(lastRequest()).toMatchObject({ age_max: 25 });
    expect(lastRequest().age_min).toBeUndefined();
  });

  it("ignores a non-numeric or negative URL bound rather than filtering by it", () => {
    mountDiscovery("age_max=abc");
    expect(screen.getByTestId("age-direction-all")).toHaveAttribute("aria-pressed", "true");
    expect(lastRequest().age_max).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Legacy age_band URLs
// ---------------------------------------------------------------------------
describe("Legacy age_band URLs", () => {
  it.each([
    ["u23", { age_max: 22 }, "22 Years", "age-direction-younger"],
    ["24_26", { age_min: 25 }, "25 Years", "age-direction-older"],
    ["27_30", { age_min: 28 }, "28 Years", "age-direction-older"],
    // the one band with an exact representation keeps its old semantics
    ["31_plus", { age_min: 31 }, "31 Years", "age-direction-older"],
  ])("normalizes age_band=%s deterministically", (band, bounds, value, pressedTestId) => {
    mountDiscovery(`age_band=${band}`);
    expect(lastRequest()).toMatchObject(bounds);
    expect(lastRequest().age_band).toBeUndefined();
    expect(screen.getByTestId("age-threshold-value")).toHaveTextContent(value);
    expect(screen.getByTestId(pressedTestId)).toHaveAttribute("aria-pressed", "true");
  });

  it.each(["all", "not_a_band"])("treats age_band=%s as no age filter", (band) => {
    mountDiscovery(`age_band=${band}`);
    expect(lastRequest().age_min).toBeUndefined();
    expect(lastRequest().age_max).toBeUndefined();
    expect(screen.getByTestId("age-direction-all")).toHaveAttribute("aria-pressed", "true");
  });

  it("drops the stale age_band once the new control is used", () => {
    mountDiscovery("age_band=u23");
    fireEvent.click(screen.getByTestId("age-direction-older"));
    expect(lastUrl()).not.toContain("age_band");
    expect(lastUrl()).toContain("age_min=22");
  });

  it("lets an explicit bound win over a legacy band on the same URL", () => {
    mountDiscovery("age_band=u23&age_min=28");
    expect(lastRequest()).toMatchObject({ age_min: 28 });
    expect(lastRequest().age_max).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Bounded numeric thresholds
//
// Minutes and RoleFit are SEPARATE domains with separate ceilings. They briefly
// shared one 0-99 bound, which silently rewrote a realistic 1,500-minute threshold
// as 99 minutes and made the rail's helper copy describe a contract the API did not
// have. Every case below is asserted per input so the two cannot re-converge.
// ---------------------------------------------------------------------------
describe("Discovery numeric thresholds", () => {
  it("declares its own range on each input: minutes 0-10,000, RoleFit 0-99", () => {
    mountDiscovery();
    const minutes = screen.getByLabelText("Min minutes");
    expect(minutes).toHaveAttribute("type", "number");
    expect(minutes).toHaveAttribute("min", "0");
    expect(minutes).toHaveAttribute("max", "10000");
    expect(minutes).toHaveAttribute("step", "1");

    const rolefit = screen.getByLabelText("Min RoleFit");
    expect(rolefit).toHaveAttribute("type", "number");
    expect(rolefit).toHaveAttribute("min", "0");
    expect(rolefit).toHaveAttribute("max", "99");
    expect(rolefit).toHaveAttribute("step", "1");
  });

  it("states both contracts accurately in the shared helper copy", () => {
    mountDiscovery();
    const help = document.getElementById("filter-threshold-help")!;
    expect(help.textContent).toContain("Whole minutes 0-10,000");
    expect(help.textContent).toContain("whole RoleFit 0-99");
    expect(help.textContent).toMatch(/blank for none/i);
    // both inputs point at it, and it no longer claims one 0-99 range for both
    expect(screen.getByLabelText("Min minutes")).toHaveAttribute(
      "aria-describedby",
      "filter-threshold-help",
    );
    expect(screen.getByLabelText("Min RoleFit")).toHaveAttribute(
      "aria-describedby",
      "filter-threshold-help",
    );
    expect(help.textContent).not.toMatch(/^Whole numbers 0-99/);
  });

  it.each([0, 450, 900, 1500, 2000, 10000])(
    "accepts the realistic minute threshold %i unchanged",
    (value) => {
      mountDiscovery();
      fireEvent.change(screen.getByLabelText("Min minutes"), { target: { value: String(value) } });
      if (value === 0) expect(lastUrl()).toContain("min_minutes=0");
      else expect(lastUrl()).toContain(`min_minutes=${value}`);
    },
  );

  it("accepts the RoleFit bounds and preserves a typed zero as zero", () => {
    mountDiscovery();
    fireEvent.change(screen.getByLabelText("Min RoleFit"), { target: { value: "0" } });
    expect(lastUrl()).toContain("rolefit_min=0");

    fireEvent.change(screen.getByLabelText("Min RoleFit"), { target: { value: "99" } });
    expect(lastUrl()).toContain("rolefit_min=99");

    fireEvent.change(screen.getByLabelText("Min minutes"), { target: { value: "0" } });
    expect(lastUrl()).toContain("min_minutes=0");
  });

  it("treats an emptied field as no threshold", () => {
    mountDiscovery("rolefit_min=70");
    expect(screen.getByLabelText("Min RoleFit")).toHaveValue(70);
    fireEvent.change(screen.getByLabelText("Min RoleFit"), { target: { value: "" } });
    expect(lastUrl()).not.toContain("rolefit_min");
  });

  it("clamps each input to its OWN ceiling, never the other's", () => {
    mountDiscovery();
    // RoleFit stops at 99 and must not accept the minutes ceiling
    fireEvent.change(screen.getByLabelText("Min RoleFit"), { target: { value: "150" } });
    expect(lastUrl()).toContain("rolefit_min=99");
    fireEvent.change(screen.getByLabelText("Min RoleFit"), { target: { value: "10000" } });
    expect(lastUrl()).toContain("rolefit_min=99");

    // minutes stop at 10,000 and must NOT be crushed to the RoleFit ceiling
    fireEvent.change(screen.getByLabelText("Min minutes"), { target: { value: "25000" } });
    expect(lastUrl()).toContain("min_minutes=10000");
    fireEvent.change(screen.getByLabelText("Min minutes"), { target: { value: "1500" } });
    expect(lastUrl()).toContain("min_minutes=1500");
    expect(lastUrl()).not.toContain("min_minutes=99");

    fireEvent.change(screen.getByLabelText("Min minutes"), { target: { value: "-5" } });
    expect(lastUrl()).toContain("min_minutes=0");
  });

  it("hydrates URL-supplied values through the right domain's rules", () => {
    // a realistic minutes threshold survives hydration intact
    mountDiscovery("min_minutes=1500&rolefit_min=70");
    expect(lastRequest()).toMatchObject({ min_minutes: 1500, rolefit_min: 70 });
    expect(screen.getByLabelText("Min minutes")).toHaveValue(1500);
    expect(screen.getByLabelText("Min RoleFit")).toHaveValue(70);
  });

  it("clamps out-of-range URL values per domain before they reach the request", () => {
    mountDiscovery("rolefit_min=250&min_minutes=-3");
    expect(lastRequest()).toMatchObject({ rolefit_min: 99, min_minutes: 0 });
    expect(screen.getByLabelText("Min RoleFit")).toHaveValue(99);
    expect(screen.getByLabelText("Min minutes")).toHaveValue(0);

    mountDiscovery("min_minutes=99999");
    expect(lastRequest()).toMatchObject({ min_minutes: 10000 });
  });

  it("rejects a non-finite URL value as no threshold", () => {
    mountDiscovery("rolefit_min=Infinity&min_minutes=abc");
    expect(lastRequest().rolefit_min).toBeUndefined();
    expect(lastRequest().min_minutes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sort: page reset, and never forwarding a value the control cannot show
// ---------------------------------------------------------------------------
describe("Discovery sort control", () => {
  it("resets to page 1 when the ranking changes", () => {
    mountDiscovery("page=3");
    fireEvent.change(screen.getByTestId("sort-filter"), { target: { value: "name_asc" } });
    expect(lastUrl()).toContain("sort=name_asc");
    // page 1 is the default and is therefore absent from the URL entirely
    expect(lastUrl()).not.toContain("page=");
  });

  it("keeps the rest of the filter state while resetting the page", () => {
    mountDiscovery("page=4&role=inside_forward&min_minutes=900");
    fireEvent.change(screen.getByTestId("sort-filter"), { target: { value: "value_asc" } });
    expect(lastUrl()).toContain("role=inside_forward");
    expect(lastUrl()).toContain("min_minutes=900");
    expect(lastUrl()).not.toContain("page=");
  });

  it("forwards a representable URL sort unchanged", () => {
    mountDiscovery("sort=value_desc");
    expect(lastRequest()).toMatchObject({ sort: "value_desc" });
    expect(screen.getByTestId("sort-filter")).toHaveValue("value_desc");
  });

  it.each(["not_a_sort", "age_desc", ""])(
    "never forwards the unknown or unrepresentable sort %s",
    (sort) => {
      mountDiscovery(`sort=${sort}`);
      // `age_desc` is a real API-only mode, but the control has no option for it, so
      // forwarding it would leave the visible Sort disagreeing with the request.
      expect(lastRequest()).toMatchObject({ sort: "rolefit_desc" });
      expect(screen.getByTestId("sort-filter")).toHaveValue("rolefit_desc");
    },
  );

  it("always shows the sort it actually requested", () => {
    for (const sort of ["rolefit_asc", "age_asc", "name_asc"]) {
      const view = mountDiscovery(`sort=${sort}`);
      expect(screen.getByTestId("sort-filter")).toHaveValue(lastRequest().sort);
      expect(lastRequest().sort).toBe(sort);
      view.unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Pagination hydration and canonicalization
// ---------------------------------------------------------------------------
describe("Discovery pagination", () => {
  it("forwards a valid page and page size", () => {
    mountDiscovery("page=3&page_size=24");
    expect(lastRequest()).toMatchObject({ page: 3, page_size: 24 });
  });

  it.each(["0", "-2", "1.5", "abc", "Infinity"])(
    "does not forward the invalid page %s",
    (page) => {
      mountDiscovery(`page=${page}`);
      expect(lastRequest().page).toBe(1);
    },
  );

  it.each(["0", "-1", "101", "12.5", "abc"])(
    "does not forward the invalid page size %s",
    (pageSize) => {
      mountDiscovery(`page_size=${pageSize}`);
      expect(lastRequest().page_size).toBe(12);
    },
  );

  it("accepts the API's maximum page size", () => {
    mountDiscovery("page_size=100");
    expect(lastRequest()).toMatchObject({ page_size: 100 });
  });

  it("synchronizes the URL with the canonical page the API served", () => {
    // a valid but out-of-range request: the API answered with the last page
    usePlayerSearchMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { items: [card()], total: 37, page: 4, page_size: 12, total_pages: 4 },
    });
    mountDiscovery("page=99");

    expect(lastUrl()).toContain("page=4");
    expect(lastUrl()).not.toContain("page=99");
    // and it is emphatically NOT presented as "no players match these filters"
    expect(screen.getByTestId("results-ledger")).toBeInTheDocument();
    expect(screen.queryByText(/No players match these filters/)).not.toBeInTheDocument();
  });

  it("writes nothing when the served page is the requested one", () => {
    usePlayerSearchMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { items: [card()], total: 37, page: 2, page_size: 12, total_pages: 4 },
    });
    mountDiscovery("page=2");
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("does not loop once the canonical page is in range", () => {
    usePlayerSearchMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { items: [card()], total: 37, page: 4, page_size: 12, total_pages: 4 },
    });
    mountDiscovery("page=4");
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("reports page 1 for a genuinely empty result without a page rewrite", () => {
    usePlayerSearchMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { items: [], total: 0, page: 1, page_size: 12, total_pages: 0 },
    });
    mountDiscovery();
    expect(screen.getByText(/No players match these filters/)).toBeInTheDocument();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Everything else in the rail is untouched
// ---------------------------------------------------------------------------
describe("Discovery filter rail: preserved controls", () => {
  it("keeps every other filter as it was, with unchanged semantics", () => {
    mountDiscovery();
    expect(screen.getByTestId("search-input").tagName.toLowerCase()).toBe("input");
    for (const testId of ["position-group-filter", "role-filter"]) {
      expect(screen.getByTestId(testId).tagName.toLowerCase()).toBe("select");
    }
    expect(screen.getByLabelText("Sort").tagName.toLowerCase()).toBe("select");

    fireEvent.change(screen.getByTestId("role-filter"), { target: { value: "inside_forward" } });
    expect(lastUrl()).toContain("role=inside_forward");
    fireEvent.change(screen.getByTestId("position-group-filter"), { target: { value: "DEF" } });
    expect(lastUrl()).toContain("position_group=DEF");
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
// Filter / ledger alignment + summary contents
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

  it("reports count, age condition, season, page and Ranked ledger — and no scope", () => {
    // a later page, requested and served, so the reported page is the served one
    usePlayerSearchMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { items: [card()], total: 37, page: 2, page_size: 12, total_pages: 4 },
    });
    mountDiscovery("page=2");
    const summary = screen.getByTestId("result-count");
    expect(summary).toHaveTextContent("37 players");
    expect(summary).toHaveTextContent("All Ages");
    expect(summary).toHaveTextContent("2023/24");
    expect(summary).toHaveTextContent("page 2 of 4");
    expect(summary).toHaveTextContent("Ranked ledger");
    expect(summary.textContent).not.toMatch(/Analyzed|All records|High-coverage/);
  });

  it("reports the active age condition in the shared phrasing", () => {
    mountDiscovery("age_max=25");
    expect(screen.getByTestId("result-count")).toHaveTextContent("25 Years And Younger");

    mountDiscovery("age_min=28");
    expect(screen.getAllByTestId("result-count").at(-1)).toHaveTextContent("28 Years And Older");
  });

  it("does not report a scope even when a legacy scope URL is in play", () => {
    mountDiscovery("scope=high_coverage_u23");
    expect(screen.getByTestId("result-count").textContent).not.toMatch(/High-coverage/);
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
    // the empty state no longer advises widening a scope the user cannot see
    expect(screen.getByText(/Try widening the age range or clearing a filter/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/widen(ing)? the analysis scope/i);
  });
});
