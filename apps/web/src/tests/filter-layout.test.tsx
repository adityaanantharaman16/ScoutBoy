import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlayerSearchFilters } from "@/components/search/PlayerSearchFilters";
import { POSITION_GROUPS, SORT_OPTIONS } from "@/lib/constants";

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

function mount() {
  return render(<PlayerSearchFilters filters={BASE} onChange={vi.fn()} />);
}

/** The filter grid's direct children, in DOM order, with a readable name each. */
function gridItems(): Array<{ name: string; el: HTMLElement }> {
  const grid = screen.getByTestId("filter-grid");
  return Array.from(grid.children).map((child) => {
    const el = child as HTMLElement;
    const name =
      el.dataset.testid ??
      el.querySelector(".label")?.textContent?.trim() ??
      el.tagName.toLowerCase();
    return { name, el };
  });
}

// ---------------------------------------------------------------------------
// Responsive composition
// ---------------------------------------------------------------------------
// jsdom applies no stylesheet, so this file asserts the STRUCTURE and the class
// contract that produce the layout. The measured geometry at real widths — column
// counts, full-width rail, no overflow at 320px — is asserted in
// `tests/e2e/filters-and-cards.spec.ts`, where a real engine lays it out.
describe("Discovery filter rail composition", () => {
  it("is one grid of exactly six items, in the required logical order", () => {
    mount();
    expect(gridItems().map((i) => i.name)).toEqual([
      "Search",
      "age-threshold-filter",
      "Position group",
      "threshold-pair",
      "Role",
      "Sort",
    ]);
  });

  it("spans Search and the whole age control across both columns below lg", () => {
    mount();
    const items = gridItems();
    for (const name of ["Search", "age-threshold-filter"]) {
      const el = items.find((i) => i.name === name)!.el;
      expect(el.className, name).toContain("sm:col-span-2");
      // ...and back to the single narrow column on desktop
      expect(el.className, name).toContain("lg:col-span-1");
    }
  });

  it("leaves the four remaining controls at their natural single-column span", () => {
    mount();
    const items = gridItems();
    for (const name of ["Position group", "threshold-pair", "Role", "Sort"]) {
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

  it("keeps the numeric helper inside the threshold item, not in a cell of its own", () => {
    mount();
    const pair = screen.getByTestId("threshold-pair");
    const helper = document.getElementById("filter-threshold-help")!;
    expect(pair).toContainElement(helper);
    // both inputs point at it, and it is not a grid child
    expect(within(pair).getByLabelText("Min minutes")).toHaveAttribute(
      "aria-describedby",
      "filter-threshold-help",
    );
    expect(within(pair).getByLabelText("Min RoleFit")).toHaveAttribute(
      "aria-describedby",
      "filter-threshold-help",
    );
    expect(gridItems().some((i) => i.el === helper)).toBe(false);
  });

  it("reorders nothing, so tab order is the visual order at every width", () => {
    // No `order-*` utility and no grid-area placement anywhere in the rail: the two
    // spanning items plus DOM order are the whole layout mechanism, which is what
    // keeps focus order truthful (WCAG 2.2 SC 1.3.2 / 2.4.3).
    const source = withoutComments(
      readFileSync(join(SRC, "..", "components", "search", "PlayerSearchFilters.tsx"), "utf8"),
    );
    expect(source).not.toMatch(/(?:^|[\s"'`:])(?:(?:sm|md|lg|xl|2xl):)?order-\d/);
    expect(source).not.toMatch(/grid-(?:template-)?areas?\b/);
    expect(source).not.toMatch(/grid-area/);
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

  it("uses All Ages, title-cased, for the no-age-filter option", () => {
    mount();
    expect(screen.getByTestId("age-direction-all").textContent).toBe("All Ages");
  });

  it("leaves no lower-cased first word in any visible option label", () => {
    // Audits the constants themselves, so a future option cannot slip through.
    const labels = [
      ...POSITION_GROUPS.map((p) => p.label),
      ...SORT_OPTIONS.map((s) => s.label),
      "Any Role (Best)",
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
  });
});
