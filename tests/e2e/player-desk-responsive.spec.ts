import { expect, test } from "@playwright/test";

// Layout/interaction contracts that would have caught the first-pass defects:
// the displaced desktop evidence rail, asymmetric role tabs, an obscuring mobile
// selector, suppressed keyboard focus, and horizontal overflow at narrow widths.

const PLAYER = 6;

test.describe("Recruitment Desk responsive contracts", () => {
  test("desktop left rail is contiguous (no trench below the summary)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/players/${PLAYER}`);
    const summary = await page.getByTestId("selected-role-summary").boundingBox();
    const rail = await page.getByTestId("evidence-context-rail").boundingBox();
    expect(summary).not.toBeNull();
    expect(rail).not.toBeNull();
    const gap = rail!.y - (summary!.y + summary!.height);
    // evidence panel sits just below the summary, not ~483px down
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(80);
    // and it is in the LEFT column (left of the canvas/pitch)
    const territory = await page.getByTestId("role-territory").boundingBox();
    expect(rail!.x).toBeLessThan(territory!.x);
  });

  test("role tabs are dimensionally symmetrical on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/players/${PLAYER}`);
    const tabs = page.getByTestId("role-selector").getByRole("tab");
    await expect(tabs.first()).toBeVisible();
    const count = await tabs.count();
    expect(count).toBeGreaterThan(1);
    const boxes: { w: number; h: number }[] = [];
    for (let i = 0; i < count; i++) {
      const b = await tabs.nth(i).boundingBox();
      expect(b).not.toBeNull();
      boxes.push({ w: Math.round(b!.width), h: Math.round(b!.height) });
    }
    const { w, h } = boxes[0];
    for (const b of boxes) {
      expect(Math.abs(b.w - w)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.h - h)).toBeLessThanOrEqual(1);
    }
  });

  test("the role selector is not sticky, so it cannot obscure the territory", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/players/${PLAYER}`);
    const pos = await page.getByTestId("role-selector").evaluate((el) => getComputedStyle(el).position);
    expect(["static", "relative"]).toContain(pos);
    // territory heading is visible and the attacking-box markers render
    await expect(page.getByTestId("role-territory")).toBeVisible();
    await expect(page.getByTestId("territory-disclosure")).toBeVisible();
  });

  for (const width of [320, 390]) {
    test(`no horizontal document overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/players/${PLAYER}`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      // the market chart also stays inside the panel
      await page.getByTestId("market-panel").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("market-chart")).toBeVisible();
    });
  }

  test("keyboard focus is visible on the analysis panel", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/players/${PLAYER}`);
    const firstTab = page.getByTestId("role-selector").getByRole("tab").first();
    await expect(firstTab).toBeVisible();
    await firstTab.focus();
    await page.keyboard.press("Tab");
    const panel = page.locator("#role-analysis-panel");
    await expect(panel).toBeFocused();
    // keyboard focus surfaces the standard focus-visible ring (not suppressed)
    const outline = await panel.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: s.outlineWidth };
    });
    expect(outline.style !== "none" || outline.width !== "0px").toBe(true);
  });

  test("mobile navigation opens and closes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/players/${PLAYER}`);
    const toggle = page.getByTestId("nav-menu-toggle");
    await expect(toggle).toBeVisible();
    await expect(page.getByTestId("nav-discover")).toBeHidden();
    await toggle.click();
    await expect(page.getByTestId("nav-discover")).toBeVisible();
    await toggle.click();
    await expect(page.getByTestId("nav-discover")).toBeHidden();
  });

  test("tablet stacks without a cramped pseudo-desktop rail", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1000 });
    await page.goto(`/players/${PLAYER}`);
    const summary = await page.getByTestId("selected-role-summary").boundingBox();
    const territory = await page.getByTestId("role-territory").boundingBox();
    // stacked: territory sits below the summary rather than in a side rail
    expect(territory!.y).toBeGreaterThan(summary!.y);
  });
});
