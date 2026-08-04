import { expect, test } from "@playwright/test";

/**
 * Milestone 7 closeout — Phase 11, the cross-browser functional matrix.
 *
 * Deliberately a SMOKE suite, not the whole E2E suite multiplied by three
 * engines: the default suite already proves behaviour in depth on Chromium, and
 * what this matrix must answer is narrower — does each mandatory flow still
 * function on a different engine? Running it via `playwright.cross-browser.config.ts`
 * keeps the default `make e2e` gate fast while making engine coverage explicit.
 *
 * Run: pnpm e2e:cross-browser
 */

async function firstDossier(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForSelector('[data-testid="player-result"]');
  const href = await page.locator('[data-testid="player-result"]').first().getAttribute("href");
  await page.goto(href!);
  return href!;
}

test("discovery loads and filters", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-testid="results-ledger"]')).toBeVisible();
  expect(await page.locator('[data-testid="result-row"]').count()).toBeGreaterThan(0);

  await page.selectOption("#filter-scope", { index: 1 });
  await page.waitForLoadState("networkidle");
  expect(page.url()).toContain("scope=");
  await expect(page.locator('[data-testid="filter-column"]')).toBeVisible();
});

test("player dossier renders with role switching and evidence pinning", async ({ page }) => {
  await firstDossier(page);
  await expect(page.locator('[data-testid="role-territory"]')).toBeVisible();

  const tabs = page.locator('[role="tab"]');
  const n = await tabs.count();
  expect(n).toBeGreaterThan(0);
  if (n > 1) {
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    expect(await page.locator('[role="tab"][aria-selected="true"]').count()).toBe(1);
  }

  const group = page.locator('[data-testid^="evidence-group-"]').first();
  await group.click();
  await expect(group).toHaveAttribute("aria-pressed", "true");
});

test("favorites persist across navigation and reload", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector('[data-testid="result-row"]');
  await page.locator('[data-testid="favorite-action"]').first().click();
  await expect(page.locator('[data-testid="favorite-action"]').first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.goto("/shortlist");
  await expect(page.locator('[data-testid="remove-action"]')).toHaveCount(1);

  await page.reload();
  await expect(page.locator('[data-testid="remove-action"]')).toHaveCount(1);
});

test("compare queue drives a completed comparison", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector('[data-testid="result-row"]');
  await page.locator('[data-testid="compare-action"]').nth(0).click();
  await page.locator('[data-testid="compare-action"]').nth(1).click();

  const tray = page.locator('[data-testid="compare-tray"]');
  await expect(tray).toBeVisible();
  await tray.getByRole("link", { name: /Open comparison/ }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[data-testid="compare-a"]')).toBeVisible();
});

test("mobile navigation opens and navigates", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForSelector('[data-testid="results-ledger"]');

  const toggle = page.locator('[data-testid="nav-menu-toggle"]');
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.locator('[data-testid="nav-methodology"]').click();
  await page.waitForURL((u) => u.pathname === "/methodology");
  await expect(page.locator('[data-testid="methodology-contents"]')).toBeVisible();
});

test("native disclosures toggle", async ({ page }) => {
  await firstDossier(page);
  const rail = page.locator('[data-testid="evidence-context-rail"]');
  await expect(rail).toBeVisible();
  expect(await rail.evaluate((el) => el.tagName)).toBe("DETAILS");
  await rail.locator("summary").click();
  await expect(rail).not.toHaveAttribute("open", /.*/);
  await rail.locator("summary").click();
  await expect(rail).toHaveAttribute("open", "");
});

test("keyboard focus reaches the skip link and shows an indicator", async ({
  page,
  browserName,
}) => {
  await page.goto("/");
  await page.waitForSelector('[data-testid="results-ledger"]');
  const skip = page.locator(".skip-link");

  if (browserName === "webkit") {
    // Safari/WebKit excludes links from sequential Tab order unless the user
    // enables full keyboard access (System Settings › Keyboard, or Option+Tab).
    // That is a documented platform preference, NOT a ScoutBoy defect, so
    // asserting Tab lands on the skip link here would be testing Safari's
    // default rather than our markup. What must hold on every engine is that the
    // skip link is genuinely focusable and reveals itself when focused.
    await skip.focus();
    await expect(skip).toBeFocused();
    expect((await skip.boundingBox())!.x).toBeGreaterThanOrEqual(0);
  } else {
    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
  }

  // Whatever receives focus next must carry a visible indicator. Engines report
  // the ring differently, so this asserts that SOME indicator resolves.
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    return { width: parseFloat(s.outlineWidth || "0"), style: s.outlineStyle };
  });
  expect(outline.width > 0 || outline.style !== "none").toBe(true);
});

test("reduced motion removes all animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForSelector('[data-testid="results-ledger"]');

  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
  ).toBe("auto");

  const animated = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll("body *")).filter(
        (el) => getComputedStyle(el).animationName !== "none",
      ).length,
  );
  expect(animated).toBe(0);

  // The tray still mounts and unmounts, immediately.
  await page.locator('[data-testid="compare-action"]').first().click();
  await expect(page.locator('[data-testid="compare-tray"]')).toHaveCount(1);
  await page.locator('[data-testid="compare-action"]').first().click();
  await expect(page.locator('[data-testid="compare-tray"]')).toHaveCount(0);
});

test("no horizontal overflow at 320", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  for (const [path, ready] of [
    ["/", '[data-testid="results-ledger"]'],
    ["/shortlist", "h1"],
    ["/methodology", '[data-testid="methodology-contents"]'],
  ] as const) {
    await page.goto(path);
    await page.waitForSelector(ready);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} @320`).toBeLessThanOrEqual(0);
  }
});
