import { describe, expect, it } from "vitest";

import {
  activeCriteria,
  ADVANCED_CATEGORIES,
  countAdvanced,
  countInGroup,
  criterionRemoveLabel,
  criterionSummary,
  firstActiveCategory,
  removalPatch,
  type CriteriaSource,
} from "@/lib/filters/criteria";
import {
  askingMillionsInput,
  coherentBounds,
  DEFAULT_DISCOVERY_FILTERS,
  EUR_PER_MILLION,
  parseAskingEur,
  parseAskingMillions,
  parseTextFilter,
} from "@/lib/filters";

// ---------------------------------------------------------------------------
// Expected-asking units
//
// The API contract is absolute EUR; the rail is EUR millions because "12500000"
// is unreadable in a 248px column and a mistype away from a tenfold error. Every
// case below pins one direction of that conversion, so the two units cannot start
// leaking into each other.
// ---------------------------------------------------------------------------
describe("Expected-asking millions <-> absolute EUR", () => {
  it("uses one million as the scale, named once", () => {
    expect(EUR_PER_MILLION).toBe(1_000_000);
  });

  it.each([
    ["5", 5_000_000],
    ["12.5", 12_500_000],
    ["0.5", 500_000],
    ["100", 100_000_000],
    ["1.234567", 1_234_567],
  ])("converts the typed %s to %i absolute EUR", (typed, eur) => {
    expect(parseAskingMillions(typed)).toBe(eur);
  });

  it.each([
    [5_000_000, "5"],
    [12_500_000, "12.5"],
    [500_000, "0.5"],
    [1_234_567, "1.234567"],
    [0, "0"],
  ])("shows %i absolute EUR as %s in the input", (eur, shown) => {
    expect(askingMillionsInput(eur)).toBe(shown);
  });

  it("round-trips a hard-loaded URL value without rewriting it", () => {
    // "Preserve representable hard-loaded URL values": a control must never
    // quietly turn EUR 1,234,567 into EUR 1.2M just by displaying it.
    for (const eur of [0, 1, 999, 500_000, 1_234_567, 12_500_000, 99_999_999]) {
      expect(parseAskingMillions(askingMillionsInput(eur))).toBe(eur);
    }
  });

  it("treats blank as no bound and keeps a typed zero as a real bound", () => {
    expect(parseAskingMillions("")).toBeUndefined();
    expect(parseAskingMillions("   ")).toBeUndefined();
    expect(parseAskingMillions(null)).toBeUndefined();
    expect(parseAskingMillions(undefined)).toBeUndefined();
    expect(askingMillionsInput(undefined)).toBe("");
    expect(askingMillionsInput(null)).toBe("");

    expect(parseAskingMillions("0")).toBe(0);
    expect(parseAskingEur("0")).toBe(0);
  });

  it.each(["abc", "Infinity", "-Infinity", "NaN", "-5", "-0.1"])(
    "rejects the non-finite or negative value %s as no bound",
    (raw) => {
      expect(parseAskingMillions(raw)).toBeUndefined();
      expect(parseAskingEur(raw)).toBeUndefined();
    },
  );

  it("parses a URL bound as absolute EUR, never as millions", () => {
    expect(parseAskingEur("12500000")).toBe(12_500_000);
    // the same string read through the input parser would mean something else
    // entirely, which is exactly why the two are separate functions
    expect(parseAskingMillions("12500000")).toBe(12_500_000_000_000);
  });

  it("rounds to whole euros so floating-point dust cannot reach the URL", () => {
    expect(parseAskingMillions("1.1")).toBe(1_100_000);
    expect(Number.isInteger(parseAskingMillions("3.3"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Range safety
// ---------------------------------------------------------------------------
describe("Inclusive bound pairs stay coherent", () => {
  it("leaves an already-coherent pair completely alone", () => {
    expect(coherentBounds(10, 90, "min")).toEqual({ min: 10, max: 90 });
    expect(coherentBounds(10, 90, "max")).toEqual({ min: 10, max: 90 });
    expect(coherentBounds(50, 50, "min")).toEqual({ min: 50, max: 50 });
  });

  it("leaves a one-sided pair alone, whichever side is missing", () => {
    expect(coherentBounds(70, undefined, "min")).toEqual({ min: 70, max: undefined });
    expect(coherentBounds(undefined, 40, "max")).toEqual({ min: undefined, max: 40 });
    expect(coherentBounds(undefined, undefined, "min")).toEqual({
      min: undefined,
      max: undefined,
    });
  });

  it("raises the maximum when the MINIMUM is the edited bound", () => {
    // The documented rule: the edited bound wins and its companion follows, so
    // the edit is never discarded and the request is never invalid.
    expect(coherentBounds(80, 20, "min")).toEqual({ min: 80, max: 80 });
  });

  it("lowers the minimum when the MAXIMUM is the edited bound", () => {
    expect(coherentBounds(80, 20, "max")).toEqual({ min: 20, max: 20 });
  });

  it("treats the minimum as authoritative by default, for URL hydration", () => {
    // A hard-loaded URL has no edited side; `min` is the documented default.
    expect(coherentBounds(80, 20)).toEqual({ min: 80, max: 80 });
  });

  it("never returns min greater than max, for any pair or edited side", () => {
    const values = [undefined, 0, 1, 20, 50, 80, 99];
    for (const min of values) {
      for (const max of values) {
        for (const edited of ["min", "max"] as const) {
          const out = coherentBounds(min, max, edited);
          if (out.min != null && out.max != null) {
            expect(out.min, `${min}/${max}/${edited}`).toBeLessThanOrEqual(out.max);
          }
          // and the edited side is always preserved exactly as given
          if (edited === "min") expect(out.min).toBe(min);
          else expect(out.max).toBe(max);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Text predicates
// ---------------------------------------------------------------------------
describe("Text predicates", () => {
  it("treats an empty or whitespace-only string as no predicate", () => {
    expect(parseTextFilter("")).toBeUndefined();
    expect(parseTextFilter("   ")).toBeUndefined();
    expect(parseTextFilter("\t\n")).toBeUndefined();
    expect(parseTextFilter(null)).toBeUndefined();
    expect(parseTextFilter(undefined)).toBeUndefined();
  });

  it("removes outer whitespace, which would otherwise reach the SQL predicate", () => {
    // `club=Paris ` was sent as a literal substring with a trailing space, so a stray
    // keystroke or a paste from a spreadsheet silently matched nothing.
    expect(parseTextFilter("Bayer ")).toBe("Bayer");
    expect(parseTextFilter(" Leverkusen")).toBe("Leverkusen");
    expect(parseTextFilter("  psg  ")).toBe("psg");
  });

  it("leaves internal spacing exactly as typed", () => {
    expect(parseTextFilter("Paris Saint-Germain")).toBe("Paris Saint-Germain");
    expect(parseTextFilter(" Manchester City ")).toBe("Manchester City");
    // not collapsed either: stored football names are never rewritten
    expect(parseTextFilter("Paris  Saint-Germain")).toBe("Paris  Saint-Germain");
  });
});

// ---------------------------------------------------------------------------
// The default request
// ---------------------------------------------------------------------------
describe("The default Discovery request", () => {
  it("is the analyzed scope, the default sort, page 1 and page size 12", () => {
    expect(DEFAULT_DISCOVERY_FILTERS).toEqual({
      scope: "analyzed",
      sort: "rolefit_desc",
      page: 1,
      page_size: 12,
    });
  });

  it("carries no narrowing criterion at all", () => {
    // The cast is the assertion: the default request shares NO property with the
    // criteria model, because scope, sort and pagination are not criteria.
    expect(activeCriteria({ ...DEFAULT_DISCOVERY_FILTERS } as CriteriaSource)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The active-criteria model
// ---------------------------------------------------------------------------
describe("Active criteria", () => {
  const PLAYSTYLES = { box_crasher: "Box Crasher" };

  const COMPOUND: CriteriaSource = {
    q: "Anton",
    age_max: 25,
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
  };

  it("reports every exposed narrowing parameter, in rail order", () => {
    expect(activeCriteria(COMPOUND, PLAYSTYLES).map((c) => c.key)).toEqual([
      "q",
      "age",
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
    ]);
  });

  it("phrases each one readably, with display names rather than keys", () => {
    expect(activeCriteria(COMPOUND, PLAYSTYLES).map(criterionSummary)).toEqual([
      "Search: Anton",
      "Age: 25 Years And Younger",
      "Position Group: Attackers",
      "Role: Inside Forward",
      "League: Bundesliga",
      "Club: Leverkusen",
      "Nationality: Germany",
      "Minimum Minutes: 900",
      "Minimum RoleFit: 60",
      "Maximum RoleFit: 95",
      "Playstyle: Box Crasher",
      "Minimum Expected Asking: €5.0M",
      "Maximum Expected Asking: €12.5M",
    ]);
  });

  it("uses the shared currency formatter for asking bounds, never raw euros", () => {
    const market = activeCriteria({ value_min: 5_000_000, value_max: 12_500_000 });
    expect(market.map((c) => c.value)).toEqual(["€5.0M", "€12.5M"]);
    // the millions the input is typed in never reach the sentence
    for (const c of market) expect(c.value).not.toMatch(/000/);
  });

  it("never invents a midpoint between the two asking bounds", () => {
    const summaries = activeCriteria({ value_min: 4_000_000, value_max: 8_000_000 }).map(
      criterionSummary,
    );
    // 6.0M would be the midpoint; it must appear nowhere
    for (const s of summaries) expect(s).not.toContain("6.0M");
    expect(summaries).toEqual([
      "Minimum Expected Asking: €4.0M",
      "Maximum Expected Asking: €8.0M",
    ]);
  });

  it("counts a typed zero as a real, removable bound", () => {
    const zeroes = activeCriteria({ min_minutes: 0, rolefit_min: 0, value_min: 0 });
    expect(zeroes.map(criterionSummary)).toEqual([
      "Minimum Minutes: 0",
      "Minimum RoleFit: 0",
      "Minimum Expected Asking: €0",
    ]);
  });

  it("names a remove action after the criterion it removes", () => {
    const league = activeCriteria({ league: "Bundesliga" })[0];
    expect(criterionRemoveLabel(league)).toBe("Remove League: Bundesliga.");
  });

  it("falls back to a title-cased key while the playstyle contract is loading", () => {
    expect(activeCriteria({ playstyle: "box_crasher" }, {})[0].value).toBe("Box Crasher");
    expect(activeCriteria({ playstyle: "press_resistant" })[0].value).toBe("Press Resistant");
  });

  it("removes only its own parameters", () => {
    const byKey = Object.fromEntries(
      activeCriteria(COMPOUND, PLAYSTYLES).map((c) => [c.key, c.params]),
    );
    expect(byKey.league).toEqual(["league"]);
    expect(byKey.rolefit_max).toEqual(["rolefit_max"]);
    expect(byKey.value_min).toEqual(["value_min"]);
    // the age control writes one of two bounds and may have arrived via a legacy
    // band, so removing "Age" has to clear all three
    expect(byKey.age).toEqual(["age_min", "age_max", "age_band"]);
  });

  it("expresses removal as an explicit undefined per owned parameter", () => {
    const age = activeCriteria({ age_min: 28 })[0];
    expect(removalPatch(age)).toEqual({
      age_min: undefined,
      age_max: undefined,
      age_band: undefined,
    });
  });

  // ---- what is deliberately NOT a criterion ------------------------------
  it("does not count sort, pagination or the retired analysis scope", () => {
    const noisy = {
      ...DEFAULT_DISCOVERY_FILTERS,
      sort: "name_asc",
      page: 4,
      page_size: 100,
      scope: "all_records",
      universe: "mvp",
      age_band: "u23",
    } as CriteriaSource & Record<string, unknown>;
    expect(activeCriteria(noisy)).toEqual([]);
  });

  it("reports no age criterion when no age bound is active", () => {
    expect(activeCriteria({}).length).toBe(0);
    expect(activeCriteria({ age_min: undefined, age_max: undefined }).length).toBe(0);
  });

  it("reports the active age direction in the shared phrasing", () => {
    expect(activeCriteria({ age_min: 31 })[0].value).toBe("31 Years And Older");
    expect(activeCriteria({ age_max: 19 })[0].value).toBe("19 Years And Younger");
  });
});

// ---------------------------------------------------------------------------
// Advanced categories
// ---------------------------------------------------------------------------
describe("Advanced categories", () => {
  it("are exactly Context, Evidence & Fit and Market, in that order", () => {
    expect(ADVANCED_CATEGORIES.map((c) => [c.key, c.label])).toEqual([
      ["context", "Context"],
      ["evidence", "Evidence & Fit"],
      ["market", "Market"],
    ]);
  });

  it("assigns every advanced criterion to exactly one category", () => {
    const criteria = activeCriteria({
      league: "Bundesliga",
      club: "Leverkusen",
      nationality: "Germany",
      min_minutes: 900,
      rolefit_min: 60,
      rolefit_max: 95,
      playstyle: "box_crasher",
      value_min: 1_000_000,
      value_max: 2_000_000,
    });
    expect(countInGroup(criteria, "context")).toBe(3);
    expect(countInGroup(criteria, "evidence")).toBe(4);
    expect(countInGroup(criteria, "market")).toBe(2);
    expect(countInGroup(criteria, "core")).toBe(0);
    expect(countAdvanced(criteria)).toBe(9);
    expect(countAdvanced(criteria) + countInGroup(criteria, "core")).toBe(criteria.length);
  });

  it("keeps core criteria out of the advanced count", () => {
    const core = activeCriteria({ q: "Anton", age_max: 22, position_group: "MID", role: "advanced_8" });
    expect(countInGroup(core, "core")).toBe(4);
    expect(countAdvanced(core)).toBe(0);
    expect(firstActiveCategory(core)).toBeNull();
  });

  it("names the first category a hard-loaded URL is actually using", () => {
    expect(firstActiveCategory(activeCriteria({ value_max: 2_000_000 }))).toBe("market");
    expect(firstActiveCategory(activeCriteria({ rolefit_max: 80 }))).toBe("evidence");
    expect(firstActiveCategory(activeCriteria({ club: "Leverkusen" }))).toBe("context");
    // category order decides the winner when several are active
    expect(
      firstActiveCategory(activeCriteria({ value_max: 2_000_000, rolefit_max: 80, club: "X" })),
    ).toBe("context");
    expect(firstActiveCategory(activeCriteria({}))).toBeNull();
  });
});
