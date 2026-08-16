import { expect, test, type Page } from "@playwright/test";

// The literal 90-degree production system, audited against COMPUTED styles
// rather than class names, plus the Discovery filter/ledger composition that
// motivated the pass. Shapes whose meaning is a curve (the heart icon, the pitch
// circles/arcs) are asserted to survive.

/**
 * Every rectangular box on the page whose computed radius is not 0, excluding
 * the one sanctioned exception. SVG geometry is skipped: a `<circle>` has no
 * border-radius, and squaring illustration paths is explicitly not the goal.
 */
async function roundedBoxes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (el instanceof SVGElement) continue;
      // the approved Discovery heart/Compare rail keeps its 2px geometry
      if (el.closest(".rail-box-discovery")) continue;
      const s = getComputedStyle(el);
      const corners = [
        s.borderTopLeftRadius,
        s.borderTopRightRadius,
        s.borderBottomRightRadius,
        s.borderBottomLeftRadius,
      ];
      if (corners.some((c) => c !== "" && parseFloat(c) > 0)) {
        const id = el.dataset.testid ? `[${el.dataset.testid}]` : "";
        offenders.push(`${el.tagName.toLowerCase()}${id}.${el.className} → ${corners.join(" ")}`);
      }
    }
    return offenders;
  });
}

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

const SURFACES: Array<{ name: string; path: string; ready: string }> = [
  { name: "discovery", path: "/", ready: '[data-testid="results-ledger"]' },
  { name: "leaderboard", path: "/roles/touchline_winger", ready: 'table[data-testid="leaderboard-table"]' },
  { name: "compare", path: "/compare", ready: '[data-testid="compare-a"]' },
  { name: "favorites", path: "/shortlist", ready: "text=No players saved yet" },
  { name: "methodology", path: "/methodology", ready: '[data-testid="methodology-contents"]' },
];

test.describe("Sharp-corner production system", () => {
  for (const { name, path, ready } of SURFACES) {
    test(`${name}: every rectangular box computes to a 0px radius`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(path);
      await page.locator(ready).first().waitFor();
      expect(await roundedBoxes(page), `rounded boxes on ${path}`).toEqual([]);
    });
  }

  test("player dossier: header, selector, territory, evidence and panels are square", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.getByTestId("player-result").first().click();
    await page.getByTestId("player-card").waitFor();
    await page.getByTestId("role-selector").waitFor();

    // the surfaces the pass specifically targets are present before we audit
    for (const id of [
      "role-selector",
      "selected-role-summary",
      "evidence-context-rail",
      "role-territory",
      "role-evidence-list",
      "market-panel",
    ]) {
      await expect(page.getByTestId(id).first()).toBeVisible();
    }
    expect(await roundedBoxes(page)).toEqual([]);
  });

  test("shared primitives compute to 0px on a real page", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    // Phase 8.2 rebuilt the Discovery rail as a hairline-divided panel rather
    // than a `.card`, so the panel and every control the new rail introduced are
    // probed here alongside the primitives that were already covered. `.card`
    // itself is still asserted, on the dossier, in the surface sweep above and in
    // the dedicated probe below.
    const radii = await page.evaluate(() => {
      const read = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).borderRadius : null;
      };
      return {
        rail: read('[data-testid="filter-rail"]'),
        disclosure: read(".filter-disclosure"),
        categoryHeader: read(".filter-disclosure-sub"),
        input: read(".input"),
        select: read("select.input"),
        button: read(".btn"),
        tag: read(".display-tag"),
        ledger: read('[data-testid="results-ledger"]'),
      };
    });
    for (const [key, value] of Object.entries(radii)) {
      expect(value, `${key} radius`).toBe("0px");
    }
  });

  test("the .card primitive still computes to 0px where it is used", async ({ page }) => {
    await page.goto("/methodology");
    await page.getByTestId("methodology-contents").waitFor();
    const card = await page.evaluate(() => {
      const el = document.querySelector(".card");
      return el ? getComputedStyle(el).borderRadius : null;
    });
    expect(card, "no .card found to probe").not.toBeNull();
    expect(card).toBe("0px");
  });

  test("every Phase 8.2 disclosure surface computes square, open and closed", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // a compound URL, so the active-criteria rows and every count box render
    await page.goto("/?q=a&league=e&rolefit_max=95&value_min=1000000");
    await page.getByTestId("results-ledger").waitFor();
    expect(await roundedBoxes(page), "collapsed").toEqual([]);

    await page.getByTestId("active-criteria-toggle").click();
    // Idempotent: this URL already opened Advanced Filters onto its own first
    // active category, so a blind click would close the region under audit.
    const advanced = page.getByTestId("advanced-filters-toggle");
    if ((await advanced.getAttribute("aria-expanded")) !== "true") await advanced.click();
    for (const category of ["context", "evidence", "market"]) {
      const header = page.getByTestId(`advanced-category-toggle-${category}`);
      if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
      await expect(page.getByTestId(`advanced-category-fields-${category}`)).toBeVisible();
      expect(await roundedBoxes(page), `${category} expanded`).toEqual([]);
    }

    // ...and the new controls are genuinely present in that scan
    await expect(page.getByTestId("active-criterion").first()).toBeVisible();
    await expect(page.getByTestId("advanced-filters-toggle-count")).toBeVisible();
  });

  test("the Discovery heart/Compare rail keeps its approved geometry", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const rail = page.getByTestId("result-row").first().getByTestId("action-rail-box");
    await expect(rail).toBeVisible();
    await expect(rail).toHaveClass(/rail-box-discovery/);
    await expect(rail).toHaveCSS("border-radius", "2px");

    // My Favorites reuses the component without the exception
    await page.getByTestId("result-row").first().getByTestId("favorite-action").click();
    await page.goto("/shortlist");
    const saved = page.getByTestId("shortlist-record").first().getByTestId("action-rail-box");
    await expect(saved).toBeVisible();
    await expect(saved).not.toHaveClass(/rail-box-discovery/);
    await expect(saved).toHaveCSS("border-radius", "0px");
  });

  test("meaningful curves survive: the heart icon and the pitch markings", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("favorite-heart").first()).toBeVisible();
    const heartPath = await page
      .getByTestId("favorite-heart")
      .first()
      .locator("path")
      .getAttribute("d");
    expect(heartPath).toMatch(/a4\.85 4\.85 0/);

    await page.getByTestId("player-result").first().click();
    await page.getByTestId("role-territory").waitFor();
    const pitch = page.getByTestId("role-territory");
    // centre circle, penalty spots and both penalty-area arcs are still drawn
    expect(await pitch.locator("svg circle").count()).toBeGreaterThanOrEqual(4);
    expect(await pitch.locator('svg path[d*="A 46 46"]').count()).toBe(2);
  });
});

test.describe("Discovery filter rail & ledger alignment", () => {
  test("the filter panel and the results ledger share a top edge on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();

    const rail = (await page.getByTestId("filter-rail").boundingBox())!;
    const ledger = (await page.getByTestId("results-ledger").boundingBox())!;
    expect(Math.abs(rail.y - ledger.y)).toBeLessThanOrEqual(1);

    // …and the summary is the ledger's own header row, inside the border
    const summary = (await page.getByTestId("result-count").boundingBox())!;
    expect(summary.y).toBeGreaterThanOrEqual(ledger.y);
    const firstRow = (await page.getByTestId("result-row").first().boundingBox())!;
    expect(summary.y + summary.height).toBeLessThanOrEqual(firstRow.y + 1);
  });

  test("the compact rail is sticky at desktop and stays inside a laptop viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();

    const column = page.getByTestId("filter-column");
    await expect(column).toHaveCSS("position", "sticky");

    // materially shorter than the viewport, so the sticky panel can be wholly
    // visible once its offset engages — no nested scroller needed
    const rail = page.getByTestId("filter-rail");
    const before = (await rail.boundingBox())!;
    expect(before.height).toBeLessThanOrEqual(720 - 16);

    // it follows the page while the ledger scrolls, then pins…
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(300);
    const stuck = (await rail.boundingBox())!;
    expect(stuck.y).toBeGreaterThan(before.y - 1200);
    // …fully inside the viewport: no control is trapped below the fold
    expect(stuck.y).toBeGreaterThanOrEqual(0);
    expect(stuck.y + stuck.height).toBeLessThanOrEqual(720);
    await expect(page.getByTestId("search-input")).toBeInViewport();
    await expect(page.getByLabel("Sort")).toBeInViewport();
    await expect(page.getByTestId("advanced-filters-toggle")).toBeInViewport();
  });

  test("the collapsed Phase 8.2 rail is shorter than an all-fields rail would be", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();

    const height = async () => (await page.getByTestId("filter-rail").boundingBox())!.height;
    const collapsed = await height();

    // Expanding Advanced Filters and one category is what an "everything visible
    // at once" rail would look like permanently. The collapsed default has to be
    // materially shorter than that, or progressive disclosure bought nothing.
    await page.getByTestId("advanced-filters-toggle").click();
    await page.getByTestId("advanced-category-toggle-evidence").click();
    const expanded = await height();
    expect(collapsed).toBeLessThan(expanded);
    expect(collapsed).toBeLessThan(expanded * 0.75);

    // ...and collapsing puts it back exactly, with no residual height
    await page.getByTestId("advanced-filters-toggle").click();
    expect(await height()).toBe(collapsed);
  });

  test("the expanded rail releases stickiness so nothing is pinned out of reach", async ({
    page,
  }) => {
    // A sticky box taller than the scrollport keeps its overflow permanently
    // below the fold; the alternative (a nested rail scroller) is not allowed. So
    // an expanded rail returns to normal document flow and scrolls with the page.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    await expect(page.getByTestId("filter-column")).toHaveCSS("position", "sticky");

    await page.getByTestId("advanced-filters-toggle").click();
    await page.getByTestId("advanced-category-toggle-evidence").click();
    await expect(page.getByTestId("filter-column")).toHaveCSS("position", "static");

    // the last control in the rail really is reachable by ordinary page scrolling
    const last = page.getByTestId("advanced-category-toggle-market");
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();

    // and closing it restores the approved sticky behaviour
    await page.getByTestId("advanced-filters-toggle").click();
    await expect(page.getByTestId("filter-column")).toHaveCSS("position", "sticky");
  });

  test("the rail adds no nested scrolling region, open or closed", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/?league=Bundesliga&rolefit_max=80");
    await page.getByTestId("results-ledger").waitFor();
    await page.getByTestId("active-criteria-toggle").click();

    const scrollers = await page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>('[data-testid="filter-rail"]')!;
      return Array.from(rail.querySelectorAll<HTMLElement>("*"))
        .concat(rail)
        .filter((el) => {
          const s = getComputedStyle(el);
          const scrolls = /auto|scroll/.test(s.overflowY) || /auto|scroll/.test(s.overflowX);
          return scrolls && el.scrollHeight > el.clientHeight + 1;
        })
        .map((el) => el.dataset.testid ?? el.className);
    });
    expect(scrollers).toEqual([]);
  });

  test("the rail is not sticky below the desktop breakpoint", async ({ page }) => {
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");
      await page.getByTestId("results-ledger").waitFor();
      await expect(page.getByTestId("filter-column")).toHaveCSS("position", "static");
      // normal document flow: the rail sits above the ledger
      const rail = (await page.getByTestId("filter-rail").boundingBox())!;
      const ledger = (await page.getByTestId("results-ledger").boundingBox())!;
      expect(rail.y + rail.height).toBeLessThanOrEqual(ledger.y + 1);
    }
  });

  test("the retired Analysis scope selector is gone from the rail", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();

    await expect(page.getByTestId("scope-filter")).toHaveCount(0);
    await expect(page.getByTestId("scope-description")).toHaveCount(0);
    await expect(page.getByTestId("age-band-filter")).toHaveCount(0);
    await expect(page.getByTestId("filter-rail")).not.toContainText(/analysis scope/i);
    // the global scope/evidence banner is a different thing and stays
    await expect(page.getByTestId("scope-banner")).toBeVisible();
  });

  test("the age threshold control is a native range with URL-backed state", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();

    const slider = page.getByTestId("age-threshold-slider");
    await expect(slider).toHaveJSProperty("tagName", "INPUT");
    await expect(slider).toHaveJSProperty("type", "range");
    await expect(page.getByTestId("age-slider-stop")).toHaveCount(5);

    // page off the first page first, so the reset is actually observable
    const next = page.getByRole("button", { name: "Next" });
    if (await next.isEnabled()) {
      await next.click();
      await expect(page).toHaveURL(/page=2/);
    }

    await page.getByTestId("age-direction-younger").click();
    await expect(page).toHaveURL(/age_max=25/);
    await expect(page).not.toHaveURL(/page=/);
    await expect(slider).toHaveValue("25");
    await expect(page.getByTestId("age-direction-younger")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  for (const [label, width] of [["320px", 320], ["390px", 390], ["tablet", 768], ["desktop", 1280]] as const) {
    test(`no horizontal overflow and no rounded box at ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.getByTestId("results-ledger").waitFor();
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
      expect(await roundedBoxes(page)).toEqual([]);
    });
  }
});

test.describe("Comparison copy", () => {
  test("shared compare actions read exactly Compare", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    const action = page.getByTestId("compare-action").first();
    await expect(action).toHaveText("Compare");

    await page.getByTestId("player-result").first().click();
    await page.getByTestId("player-card").waitFor();
    const profileCompare = page.getByRole("button", { name: /to compare queue$/ }).first();
    await expect(profileCompare).toHaveText("Compare");
    await expect(page.locator("body")).not.toContainText("vs Compare");
  });

  test("the compare surface reads Player 1 / Player 2 and keeps its a / b params", async ({ page }) => {
    await page.goto("/compare");
    await expect(page.getByText("Player 1")).toBeVisible();
    await expect(page.getByText("Player 2")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/Player [AB]\b/);
    await expect(page.getByTestId("compare-a")).toBeVisible();
    await expect(page.getByTestId("compare-b")).toBeVisible();

    await page.getByTestId("compare-a").selectOption({ index: 1 });
    await page.getByTestId("compare-b").selectOption({ index: 2 });
    await page.getByTestId("compare-table").waitFor();
    await expect(page.locator("body")).not.toContainText(/Player [AB]\b/);
    expect(await roundedBoxes(page)).toEqual([]);
  });
});
