import { expect, test } from "@playwright/test";

/**
 * Focused checks for the isolated dark-mode design pilot.
 *
 * The pilot is an approval artifact, so what has to hold is narrow and
 * specific: it renders, it announces itself, it survives every target width,
 * it stays out of primary navigation, and — most importantly — it does not
 * theme production. Production Discovery must still be the warm-paper light
 * theme with the pilot's route loaded in the same build.
 */

const PILOT = "/design-pilots/dark-mode";

/** `rgb(r, g, b)` -> relative luminance (WCAG). */
function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

test.describe("dark-mode pilot", () => {
  test("renders and is labelled for visual approval", async ({ page }) => {
    await page.goto(PILOT);

    await expect(page.getByTestId("dark-mode-pilot")).toBeVisible();
    const banner = page.getByTestId("pilot-approval-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Dark Mode Pilot - For Visual Approval");
    // It must also be unmistakably not-live-data.
    await expect(banner).toContainText("Not live data");

    // The canvas is genuinely dark, and not pure black.
    const canvas = await page
      .getByTestId("dark-mode-pilot")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const lum = luminance(canvas);
    expect(lum).toBeLessThan(0.05);
    expect(lum).toBeGreaterThan(0.005);
  });

  test("is excluded from search indexing", async ({ page }) => {
    await page.goto(PILOT);
    const robots = page.locator('head meta[name="robots"]');
    await expect(robots).toHaveCount(1);
    const content = (await robots.getAttribute("content")) ?? "";
    expect(content).toContain("noindex");
    expect(content).toContain("nofollow");
  });

  test("shows the representative content the approval needs", async ({ page }) => {
    await page.goto(PILOT);

    // navigation + saved-player counter
    await expect(page.getByText("My Favorites", { exact: false }).first()).toBeVisible();
    // filter rail
    await expect(page.getByTestId("pilot-filter-rail")).toBeVisible();
    // at least three ledger rows, covering all three market states
    await expect(page.getByTestId("pilot-ledger-row")).toHaveCount(4);
    for (const label of ["inflated", "high-risk", "fair"]) {
      await expect(page.locator(`[data-market-label="${label}"]`).first()).toBeVisible();
    }
    // recruitment desk excerpt, including the low-confidence disclosure
    await expect(page.getByTestId("pilot-role-territory")).toBeVisible();
    await expect(page.getByTestId("pilot-uncertainty-notice")).toBeVisible();
    await expect(page.getByTestId("pilot-evidence-row").first()).toBeVisible();
    // comparison excerpt
    await expect(
      page.getByRole("heading", { name: "No Shared Rated Role", exact: true }),
    ).toBeVisible();
    // honesty states: a missing score renders the sentinel, never zero
    await expect(page.getByTestId("pilot-unknown-score")).toHaveText("-");
  });

  test("keeps status legible without relying on colour", async ({ page }) => {
    await page.goto(PILOT);
    // Every market state carries its word, not just its hue.
    await expect(page.locator('[data-market-label="inflated"]').first()).toContainText("Inflated");
    await expect(page.locator('[data-market-label="high-risk"]').first()).toContainText("High-Risk");
    await expect(page.locator('[data-market-label="fair"]').first()).toContainText("Fair");
    // Coverage + confidence are two separately sourced facts in one described unit.
    const status = page.getByTestId("pilot-status-coverage").first().getByRole("group");
    await expect(status).toHaveAttribute(
      "aria-label",
      /Evidence coverage: .+\. RoleFit confidence: .+\./,
    );
  });

  for (const width of [1280, 640, 390, 320]) {
    test(`has no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(PILOT);
      await page.evaluate(() => document.fonts.ready);

      const metrics = await page.evaluate(() => {
        const pilot = document.querySelector(".dark-pilot") as HTMLElement;
        return {
          pilotScroll: pilot.scrollWidth,
          pilotClient: pilot.clientWidth,
          docScroll: document.documentElement.scrollWidth,
          docClient: document.documentElement.clientWidth,
        };
      });
      // The pilot owns the viewport as its own scroller, so both the document
      // and that scroller have to be free of horizontal overflow.
      expect(metrics.pilotScroll).toBeLessThanOrEqual(metrics.pilotClient);
      expect(metrics.docScroll).toBeLessThanOrEqual(metrics.docClient);
    });
  }

  test("keeps 44px action targets and equal halves on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PILOT);

    const rail = page.getByTestId("pilot-action-rail").first();
    const actions = rail.locator("button");
    await expect(actions).toHaveCount(2);

    const a = await actions.nth(0).boundingBox();
    const b = await actions.nth(1).boundingBox();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.height).toBeGreaterThanOrEqual(44);
    expect(b!.height).toBeGreaterThanOrEqual(44);
    // equal halves
    expect(Math.abs(a!.width - b!.width)).toBeLessThanOrEqual(1);
  });

  test("bounds every unselected control at the 3:1 non-text floor", async ({ page }) => {
    await page.goto(PILOT);

    // WCAG 1.4.11: a control's boundary must clear 3:1 against its background.
    // An unselected control is still a control, so the decorative hairline is
    // not good enough for it — this catches the easy mistake of reusing the
    // row-separator colour on a button.
    const samples = await page.evaluate(() => {
      const selectors = [
        ".pilot-scope-option",
        ".pilot-pill",
        ".pilot-role-tab",
        ".pilot-btn",
        ".pilot-input",
      ];
      return selectors.flatMap((sel) =>
        [...document.querySelectorAll<HTMLElement>(sel)]
          .filter(
            (el) =>
              el.getAttribute("aria-pressed") !== "true" &&
              el.getAttribute("aria-selected") !== "true",
          )
          .slice(0, 2)
          .map((el) => {
            const cs = getComputedStyle(el);
            // Controls sit on the panel or the canvas; both are opaque and set
            // on an ancestor, so walk up for the first non-transparent one.
            let bg = "rgba(0, 0, 0, 0)";
            let node: HTMLElement | null = el.parentElement;
            while (node && bg === "rgba(0, 0, 0, 0)") {
              bg = getComputedStyle(node).backgroundColor;
              node = node.parentElement;
            }
            return { sel, border: cs.borderTopColor, bg };
          }),
      );
    });

    expect(samples.length).toBeGreaterThan(4);
    for (const s of samples) {
      const l1 = luminance(s.border);
      const l2 = luminance(s.bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      expect(ratio, `${s.sel} border ${s.border} on ${s.bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  test("shows a visible focus ring on a pilot control", async ({ page }) => {
    await page.goto(PILOT);
    const button = page.getByTestId("pilot-filter-rail").locator("button").first();
    await button.focus();
    const outline = await button.evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.outlineWidth, style: s.outlineStyle };
    });
    expect(outline.style).toBe("solid");
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  });

  test("is not reachable from primary navigation", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav).toBeVisible();
    await expect(nav.locator('a[href*="design-pilot"]')).toHaveCount(0);
    // and nothing anywhere on Discovery links to it
    await expect(page.locator('a[href*="design-pilot"]')).toHaveCount(0);
  });

  test("leaves production Discovery in the unchanged light theme", async ({ page }) => {
    // Load the pilot first, so its stylesheet is in the same client session.
    await page.goto(PILOT);
    await page.goto("/");
    await page.waitForSelector('[data-testid="search-input"]');

    const body = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      const root = getComputedStyle(document.documentElement);
      return {
        background: cs.backgroundColor,
        color: cs.color,
        paper: root.getPropertyValue("--paper").trim(),
        ink: root.getPropertyValue("--ink").trim(),
        colorScheme: root.colorScheme,
      };
    });

    // Production tokens are untouched.
    expect(body.paper).toBe("#f4f2ea");
    expect(body.ink).toBe("#182219");
    expect(body.colorScheme).toBe("light");
    // And the page actually renders light: a bright background under dark text.
    expect(luminance(body.background)).toBeGreaterThan(0.7);
    expect(luminance(body.color)).toBeLessThan(0.05);
    // No pilot root exists on a production route.
    await expect(page.locator(".dark-pilot")).toHaveCount(0);
  });
});
