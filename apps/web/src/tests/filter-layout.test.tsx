import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlayerSearchFilters } from "@/components/search/PlayerSearchFilters";
import { ANY_PLAYSTYLE_LABEL, POSITION_GROUPS, SORT_OPTIONS } from "@/lib/constants";
import { ADVANCED_CATEGORIES } from "@/lib/filters/criteria";

const SRC = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(SRC, "..", "app", "globals.css"), "utf8");

/** Declarations only. Prose that merely NAMES a banned technique is not a use of it. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<!:)\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

const CSS_RULES = withoutComments(CSS);

const BASE = { scope: "analyzed", sort: "rolefit_desc", page: 1 };
const PLAYSTYLES = [{ key: "box_crasher", label: "Box Crasher" }];

function mount(filters: Record<string, unknown> = {}) {
  return render(
    <PlayerSearchFilters
      filters={{ ...BASE, ...filters }}
      onChange={vi.fn()}
      playstyleOptions={PLAYSTYLES}
    />,
  );
}

/** A grid's direct children, in DOM order, with a readable name each. */
function itemsOf(testId: string): Array<{ name: string; el: HTMLElement }> {
  const grid = screen.getByTestId(testId);
  return Array.from(grid.children).map((child) => {
    const el = child as HTMLElement;
    const name =
      el.dataset.testid ??
      el.querySelector(".label")?.textContent?.trim() ??
      el.tagName.toLowerCase();
    return { name, el };
  });
}

const gridItems = () => itemsOf("filter-grid");

// ---------------------------------------------------------------------------
// Panel composition
// ---------------------------------------------------------------------------
// jsdom applies no stylesheet, so this file asserts the STRUCTURE and the class
// contract that produce the layout. The measured geometry at real widths — column
// counts, full-width rail, collapsed vs expanded height, no overflow at 320px and
// at 200% zoom — is asserted in `tests/e2e/filters-and-cards.spec.ts`, where a
// real engine lays it out.
describe("Discovery filter panel composition", () => {
  it("is ONE outer panel divided by internal hairlines, not a stack of cards", () => {
    mount();
    const rail = screen.getByTestId("filter-rail");
    // Same construction as the results ledger it sits beside: one bordered box
    // with `divide-y` sections, so the two columns read as objects of one kind.
    expect(rail.className).toContain("border");
    expect(rail.className).toContain("divide-y");
    expect(rail.className).toContain("bg-paper-panel");
    // no nested card anywhere inside it
    expect(rail.querySelectorAll(".card")).toHaveLength(0);
  });

  it("stacks the header, the core controls and Advanced Filters in that order", () => {
    mount();
    const rail = screen.getByTestId("filter-rail");
    expect(rail.children).toHaveLength(3);
    expect(rail.children[0].textContent).toContain("Narrow results");
    expect(rail.children[1]).toContainElement(screen.getByTestId("filter-grid"));
    expect(rail.children[2]).toBe(screen.getByTestId("advanced-filters"));
  });

  it("inserts the active-criteria area directly below the header when active", () => {
    mount({ league: "Bundesliga" });
    const rail = screen.getByTestId("filter-rail");
    const area = screen.getByTestId("active-criteria");
    expect(rail.children[1]).toBe(area);
    // ...and is absent entirely when nothing narrows
    mount();
    expect(screen.queryAllByTestId("active-criteria")).toHaveLength(1);
  });
});

describe("Core control grid", () => {
  it("is exactly the five always-visible controls, in the required logical order", () => {
    mount();
    expect(gridItems().map((i) => i.name)).toEqual([
      "Search",
      "age-threshold-filter",
      "Position group",
      "Role",
      "Sort",
    ]);
  });

  it("spans Search, the age control and Sort across both columns below lg", () => {
    mount();
    const items = gridItems();
    for (const name of ["Search", "age-threshold-filter", "Sort"]) {
      const el = items.find((i) => i.name === name)!.el;
      expect(el.className, name).toContain("sm:col-span-2");
      // ...and back to the single narrow column on desktop
      expect(el.className, name).toContain("lg:col-span-1");
    }
  });

  it("pairs Position Group and Role at their natural single-column span", () => {
    mount();
    const items = gridItems();
    for (const name of ["Position group", "Role"]) {
      const el = items.find((i) => i.name === name)!.el;
      expect(el.className, name).not.toContain("col-span-2");
    }
  });

  it("declares one, two, then one column across the breakpoints", () => {
    mount();
    const grid = screen.getByTestId("filter-grid").className;
    expect(grid).toContain("grid-cols-1");
    expect(grid).toContain("sm:grid-cols-2");
    expect(grid).toContain("lg:grid-cols-1");
  });

  it("reorders nothing, so tab order is the visual order at every width", () => {
    // No `order-*` utility and no grid-area placement anywhere in the rail: the
    // spanning items plus DOM order are the whole layout mechanism, which is what
    // keeps focus order truthful (WCAG 2.2 SC 1.3.2 / 2.4.3).
    for (const file of [
      "PlayerSearchFilters.tsx",
      "AdvancedFilters.tsx",
      "ActiveCriteria.tsx",
      "FilterDisclosure.tsx",
      "AgeThresholdFilter.tsx",
    ]) {
      const source = withoutComments(
        readFileSync(join(SRC, "..", "components", "search", file), "utf8"),
      );
      expect(source, file).not.toMatch(/(?:^|[\s"'`:])(?:(?:sm|md|lg|xl|2xl):)?order-\d/);
      expect(source, file).not.toMatch(/grid-(?:template-)?areas?\b/);
      expect(source, file).not.toMatch(/grid-area/);
    }
  });
});

// ---------------------------------------------------------------------------
// Advanced Filters structure
// ---------------------------------------------------------------------------
describe("Advanced Filters structure", () => {
  it("is one square, full-width disclosure row over the three categories", () => {
    mount();
    const toggle = screen.getByTestId("advanced-filters-toggle");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.className).toContain("filter-disclosure");
    expect(toggle.className).not.toContain("filter-disclosure-sub");
    expect(toggle).toHaveAttribute("aria-expanded");
    expect(toggle).toHaveAttribute("aria-controls", "advanced-filters-region");
    expect(toggle.textContent).toContain("Advanced Filters");

    for (const category of ADVANCED_CATEGORIES) {
      const header = screen.getByTestId(`advanced-category-toggle-${category.key}`);
      expect(header.className).toContain("filter-disclosure-sub");
    }
  });

  it("gives every category the same one/two/one column grid as the core", () => {
    mount();
    for (const category of ADVANCED_CATEGORIES) {
      const grid = screen.getByTestId(`advanced-category-fields-${category.key}`)
        .firstElementChild as HTMLElement;
      expect(grid.className, category.key).toContain("grid-cols-1");
      expect(grid.className, category.key).toContain("sm:grid-cols-2");
      expect(grid.className, category.key).toContain("lg:grid-cols-1");
    }
  });

  it("keeps each category's helper sentence inside its own grid, spanning it", () => {
    mount();
    for (const [category, helperId] of [
      ["context", "advanced-context-help"],
      ["evidence", "filter-threshold-help"],
      ["market", "advanced-market-help"],
    ] as const) {
      const fields = screen.getByTestId(`advanced-category-fields-${category}`);
      const helper = document.getElementById(helperId)!;
      expect(fields, helperId).toContainElement(helper);
      // it spans the two-column tablet grid rather than sitting in one cell
      expect(helper.className, helperId).toContain("sm:col-span-2");
      expect(helper.className, helperId).toContain("lg:col-span-1");
    }
  });

  it("keeps the minutes/RoleFit inputs pointed at the one shared helper", () => {
    mount();
    const fields = screen.getByTestId("advanced-category-fields-evidence");
    for (const label of ["Minimum Minutes", "Minimum RoleFit", "Maximum RoleFit"]) {
      expect(within(fields).getByLabelText(label)).toHaveAttribute(
        "aria-describedby",
        "filter-threshold-help",
      );
    }
  });

  it("hides a closed region with the hidden attribute, never with a display class", () => {
    mount();
    // `hidden` keeps the element in the DOM, so every `aria-controls` resolves in
    // both states — and a `flex`/`grid` utility on the same element would override
    // its `display: none`.
    for (const id of [
      "advanced-filters-region",
      "advanced-category-fields-evidence",
      "advanced-category-fields-market",
    ]) {
      const region = screen.getByTestId(id);
      expect(region, id).toHaveAttribute("hidden");
      expect(region.className, id).not.toMatch(/\b(?:flex|grid|block|inline-flex)\b/);
    }
  });

  it("marks both rail regions so the column can release its stickiness", () => {
    mount({ league: "Bundesliga" });
    expect(screen.getByTestId("advanced-filters-region").className).toContain("filter-region");
    expect(screen.getByTestId("active-criteria-region").className).toContain("filter-region");
  });
});

// ---------------------------------------------------------------------------
// The disclosure and criteria CSS contract
// ---------------------------------------------------------------------------
describe("Disclosure and criteria geometry", () => {
  /** One declaration block, by selector. */
  function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`${escaped}\\s*\\{[^}]*\\}`).exec(CSS_RULES);
    expect(match, `${selector} rule missing`).not.toBeNull();
    return match![0];
  }

  it("declares a square, full-width, comfortably sized disclosure row", () => {
    const block = rule(".filter-disclosure");
    expect(block).toMatch(/border-radius:\s*0/);
    expect(block).toMatch(/min-height:\s*44px/);
    expect(block).toMatch(/@apply[^;]*\bw-full\b/);
    // a nested category header is shorter but still well over the 24px minimum
    expect(rule(".filter-disclosure-sub")).toMatch(/min-height:\s*40px/);
  });

  it("keeps the remove action and Clear All square and large enough to hit", () => {
    expect(rule(".filter-criterion-remove")).toMatch(/border-radius:\s*0/);
    expect(rule(".filter-criterion-remove")).toMatch(/min-height:\s*28px/);
    expect(rule(".filter-clear-all")).toMatch(/border-radius:\s*0/);
    expect(rule(".filter-clear-all")).toMatch(/min-height:\s*44px/);
  });

  it("marks the open state with a flat inset bar, never a dimension change", () => {
    const open = rule('.filter-disclosure[aria-expanded="true"]');
    expect(open).toContain("inset");
    expect(open).not.toMatch(/height|width|padding|margin/);
  });

  it("keeps the count box square rather than a rounded badge", () => {
    const block = rule(".filter-disclosure-count");
    expect(block).toMatch(/border-radius:\s*0/);
    expect(block).not.toMatch(/rounded/);
  });

  it("introduces no gradient, glow, blur or rounded corner in the whole block", () => {
    const start = CSS_RULES.indexOf(".filter-disclosure {");
    const end = CSS_RULES.indexOf("--age-thumb-w:");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = CSS_RULES.slice(start, end);

    for (const banned of ["gradient", "blur(", "@keyframes", "animation", "backdrop-filter"]) {
      expect(block, banned).not.toContain(banned);
    }
    const radii = block.match(/border-radius:[^;]+/g) ?? [];
    expect(radii.length).toBeGreaterThan(0);
    for (const radius of radii) expect(radius.trim()).toBe("border-radius: 0");
    // the only shadow is the flat inset open-state marker
    for (const shadow of block.match(/box-shadow:[^;]+/g) ?? []) {
      expect(shadow).toContain("inset");
    }
  });

  it("animates no layout property when a region opens", () => {
    // Disclosure content appears immediately. The rail's transitions are the
    // shared background/box-shadow pair; height, width and grid tracks are never
    // animated anywhere in the product (see motion.test.tsx for the global gate).
    const filterRules = (CSS_RULES.match(/transition-property:[^;]+;/g) ?? []).join(" ");
    for (const banned of ["height", "width", "grid-template", "padding", "margin"]) {
      expect(filterRules, banned).not.toContain(banned);
    }
    expect(CSS_RULES).toMatch(/\.filter-disclosure\s*\{[\s\S]*?\}/);
  });
});

describe("Filter column stickiness", () => {
  const block = /@media \(min-width: 1024px\) \{\s*\.filter-column \{[^}]*\}[\s\S]*?\}/.exec(
    CSS_RULES,
  )?.[0];

  it("is sticky only from the desktop breakpoint up", () => {
    expect(CSS_RULES).toMatch(/\.filter-column \{\s*position: static;\s*\}/);
    expect(block, "lg sticky block missing").toBeTruthy();
    expect(block).toMatch(/position:\s*sticky/);
    expect(block).toMatch(/top:\s*1rem/);
  });

  it("releases to normal flow while a rail region is showing", () => {
    // A sticky box taller than the scrollport pins its own overflow permanently
    // out of reach, and a nested rail scroller is explicitly not allowed — so the
    // expanded rail scrolls with the page instead.
    expect(block).toMatch(/\.filter-column:has\(\.filter-region:not\(\[hidden\]\)\)/);
    expect(block).toMatch(/position:\s*static/);
  });

  it("keys on region visibility, not on aria-expanded", () => {
    // A category header inside a CLOSED Advanced region legitimately reports
    // itself expanded while contributing no height, so keying on `aria-expanded`
    // would release stickiness on a default page load.
    expect(block).not.toContain("aria-expanded");
  });
});

// ---------------------------------------------------------------------------
// The age control fills the width it is given
// ---------------------------------------------------------------------------
describe("Age threshold control sizing", () => {
  it("lets the slider, the endpoints and the direction group all fill the item", () => {
    mount();
    // The shell is a block-level flex row and the input is w-full, so the rail
    // stretches to whatever the grid item is; nothing caps it.
    expect(CSS).toMatch(/\.age-slider-shell\s*\{[^}]*position:\s*relative/);
    expect(CSS).toMatch(/\.age-slider-rail\s*\{[^}]*inset-inline:\s*0/);
    expect(CSS).toMatch(/\.age-slider-input\s*\{[^}]*width:\s*100%/);
    // three equal, centred segments across the full width
    expect(CSS).toMatch(
      /\.age-direction-box\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(CSS).toMatch(/\.age-direction-action\s*\{[^}]*@apply[^;]*items-center justify-center/);
  });

  it("keeps the control itself shrinkable so a long value cannot force overflow", () => {
    mount();
    expect(screen.getByTestId("age-threshold-filter").className).toContain("min-w-0");
  });

  it("keeps Youth and Seasoned at the two ends of the scale", () => {
    mount();
    const youth = screen.getByText("Youth");
    const seasoned = screen.getByText("Seasoned");
    const row = youth.parentElement!;
    expect(row).toContainElement(seasoned);
    expect(row.className).toContain("justify-between");
  });
});

// ---------------------------------------------------------------------------
// Slider track and tick geometry
// ---------------------------------------------------------------------------
// The numbers are read out of the declared custom properties, so this fails if the
// track is thinned again or the ticks are allowed back outside it. The rendered
// bounding boxes are asserted in Chromium and WebKit by the e2e/cross-browser
// suites.
function cssVar(name: string): number {
  const match = new RegExp(`${name}:\\s*(-?[\\d.]+)px`).exec(CSS);
  expect(match, `${name} not declared`).not.toBeNull();
  return Number(match![1]);
}

describe("Age slider track and ticks", () => {
  const RAIL = 14;
  const BORDER = 1;
  const TICK_INSET = 3;

  it("uses a substantially thicker track than the original hairline rail", () => {
    expect(cssVar("--age-rail-h")).toBe(RAIL);
    // 12-14px is the sanctioned band, and it must be a real step up from 6px
    expect(cssVar("--age-rail-h")).toBeGreaterThanOrEqual(12);
    expect(cssVar("--age-rail-h")).toBeLessThanOrEqual(14);
    expect(cssVar("--age-rail-h")).toBeGreaterThan(6 * 1.5);
  });

  it("keeps every tick inside the track, touching neither border", () => {
    expect(cssVar("--age-tick-inset")).toBe(TICK_INSET);
    // border-box: the 14px rail contains a 1px border on each side
    const interior = RAIL - 2 * BORDER;
    const tickHeight = interior - 2 * TICK_INSET;
    expect(tickHeight).toBeGreaterThan(0);
    // strictly inset from both borders, so no tick edge can coincide with one
    expect(TICK_INSET).toBeGreaterThan(0);
    // a short, centred indicator: one third to one half of the track
    expect(tickHeight / RAIL).toBeGreaterThanOrEqual(1 / 3);
    expect(tickHeight / RAIL).toBeLessThanOrEqual(1 / 2);
  });

  it("positions ticks from the thumb's own travel formula, so the ends align", () => {
    // Both the fill and the ticks use `thumb-w / 2 + fraction * (100% - thumb-w)`,
    // which is exactly where the thumb centre sits at that fraction.
    const travel = /--age-thumb-w\) \/ 2 \+ var\(--age-stop-fraction\) \* \(100% - var\(--age-thumb-w\)\)/;
    expect(CSS).toMatch(travel);
    expect(CSS).toMatch(/\.age-slider-stop\s*\{[^}]*margin-left:\s*calc\(var\(--age-tick-w\) \/ -2\)/);
  });

  it("gives the thumb a larger footprint than the rail without rounding it", () => {
    expect(cssVar("--age-thumb-h")).toBeGreaterThan(RAIL);
    expect(cssVar("--age-thumb-w")).toBeGreaterThan(cssVar("--age-tick-w"));
    for (const pseudo of ["::-webkit-slider-thumb", "::-moz-range-thumb"]) {
      const block = new RegExp(`\\.age-slider-input${pseudo}\\s*\\{([^}]*)\\}`).exec(CSS)![1];
      expect(block, pseudo).toContain("border-radius: 0");
    }
  });

  it("keeps the shell a comfortable pointer target around the taller thumb", () => {
    expect(CSS).toMatch(/\.age-slider-shell\s*\{[^}]*height:\s*28px/);
    expect(CSS).toMatch(/\.age-slider-input\s*\{[^}]*height:\s*28px/);
    expect(28).toBeGreaterThanOrEqual(24);
    expect(28).toBeGreaterThanOrEqual(cssVar("--age-thumb-h"));
  });

  it("introduces no gradient, glow, radius, or animated travel", () => {
    // The control's own declaration span, comments excluded.
    const start = CSS_RULES.indexOf("--age-thumb-w:");
    const end = CSS_RULES.indexOf(".desk-analysis");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = CSS_RULES.slice(start, end);

    for (const banned of ["gradient", "blur(", "cubic-bezier", "@keyframes", "animation"]) {
      expect(block, banned).not.toContain(banned);
    }
    // every radius in the control is an explicit zero — no rounding anywhere
    const radii = block.match(/border-radius:[^;]+/g) ?? [];
    expect(radii.length).toBeGreaterThan(0);
    for (const radius of radii) expect(radius.trim()).toBe("border-radius: 0");
    // the only shadows are the flat inset state markers, never a soft glow
    for (const shadow of block.match(/box-shadow:[^;]+/g) ?? []) {
      expect(shadow).toContain("inset");
    }
  });
});

// ---------------------------------------------------------------------------
// Title-cased option copy
// ---------------------------------------------------------------------------
describe("Filter option copy", () => {
  it("title-cases the Position Group options while keeping their keys", () => {
    mount();
    const select = screen.getByTestId("position-group-filter") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => [o.value, o.text])).toEqual([
      ["", "All Positions"],
      ["ATT", "Attackers"],
      ["MID", "Midfielders"],
      ["DEF", "Defenders"],
      ["GK", "Goalkeepers"],
    ]);
  });

  it("title-cases the Role default option while keeping the empty key", () => {
    mount();
    const select = screen.getByTestId("role-filter") as HTMLSelectElement;
    expect([select.options[0].value, select.options[0].text]).toEqual(["", "Any Role (Best)"]);
    expect(screen.queryByRole("option", { name: "Any role (best)" })).not.toBeInTheDocument();
  });

  it("title-cases the Playstyle default option while keeping the empty key", () => {
    mount();
    const select = screen.getByTestId("playstyle-filter") as HTMLSelectElement;
    expect([select.options[0].value, select.options[0].text]).toEqual(["", ANY_PLAYSTYLE_LABEL]);
    expect(ANY_PLAYSTYLE_LABEL).toBe("Any Playstyle");
  });

  it("title-cases every Sort option while keeping the sort keys", () => {
    mount();
    const select = screen.getByTestId("sort-filter") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => [o.value, o.text])).toEqual([
      ["rolefit_desc", "RoleFit (High → Low)"],
      ["rolefit_asc", "RoleFit (Low → High)"],
      ["age_asc", "Age (Young → Old)"],
      ["value_desc", "Asking Price (High → Low)"],
      ["value_asc", "Asking Price (Low → High)"],
      ["name_asc", "Name (A → Z)"],
    ]);
  });

  it("title-cases every category name and field label", () => {
    mount();
    expect(ADVANCED_CATEGORIES.map((c) => c.label)).toEqual([
      "Context",
      "Evidence & Fit",
      "Market",
    ]);
    for (const label of [
      "League",
      "Club",
      "Nationality",
      "Minimum Minutes",
      "Minimum RoleFit",
      "Maximum RoleFit",
      "Playstyle",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // the market labels carry their unit, spelled out
    expect(screen.getByText("Minimum Expected Asking (€M)")).toBeInTheDocument();
    expect(screen.getByText("Maximum Expected Asking (€M)")).toBeInTheDocument();
  });

  it("uses All Ages, title-cased, for the no-age-filter option", () => {
    mount();
    expect(screen.getByTestId("age-direction-all").textContent).toBe("All Ages");
  });

  it("leaves no lower-cased first word in any visible option label", () => {
    // Audits the constants themselves, so a future option cannot slip through.
    const labels = [
      ...POSITION_GROUPS.map((p) => p.label),
      ...SORT_OPTIONS.map((s) => s.label),
      ...ADVANCED_CATEGORIES.map((c) => c.label),
      "Any Role (Best)",
      ANY_PLAYSTYLE_LABEL,
      "All Ages",
    ];
    for (const label of labels) {
      for (const word of label.split(/[\s(]+/).filter((w) => /^[a-zA-Z]/.test(w))) {
        expect(word[0], `"${label}" -> "${word}"`).toBe(word[0].toUpperCase());
      }
    }
  });

  it("keeps the query-parameter values untouched by the copy change", () => {
    expect(POSITION_GROUPS.map((p) => p.key)).toEqual(["", "ATT", "MID", "DEF", "GK"]);
    expect(SORT_OPTIONS.map((s) => s.key)).toEqual([
      "rolefit_desc",
      "rolefit_asc",
      "age_asc",
      "value_desc",
      "value_asc",
      "name_asc",
    ]);
    expect(ADVANCED_CATEGORIES.map((c) => c.key)).toEqual(["context", "evidence", "market"]);
  });
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------
describe("Clear All hands back the default request", () => {
  it("calls onChange with exactly the established default, not a patch", () => {
    const onChange = vi.fn();
    render(
      <PlayerSearchFilters
        filters={{ ...BASE, league: "Bundesliga", page: 3 }}
        onChange={onChange}
        playstyleOptions={PLAYSTYLES}
      />,
    );
    fireEvent.click(screen.getByTestId("clear-all-filters"));
    expect(onChange).toHaveBeenCalledWith({
      scope: "analyzed",
      sort: "rolefit_desc",
      page: 1,
      page_size: 12,
    });
  });
});
