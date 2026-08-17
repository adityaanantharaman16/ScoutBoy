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

  // The age threshold is the rail's own control in every engine: a native range
  // input plus plain buttons, so this also smoke-tests that the styled slider is
  // operable outside Chromium.
  const slider = page.locator('[data-testid="age-threshold-slider"]');
  await expect(slider).toBeVisible();
  await expect(slider).toHaveValue("25");

  await page.locator('[data-testid="age-direction-younger"]').click();
  await page.waitForLoadState("networkidle");
  expect(page.url()).toContain("age_max=25");
  await expect(page.locator('[data-testid="filter-column"]')).toBeVisible();
  // Since Phase 8.2 the ledger header COUNTS active narrowing criteria instead of
  // restating one of them; the age condition itself is reported by the rail's
  // active-criteria summary, which is what this asserts on every engine.
  await expect(page.locator('[data-testid="result-count"]')).toContainText(
    "1 active criterion",
  );
  await expect(page.locator('[data-testid="active-criteria-summary"]')).toContainText(
    "Age: 25 Years And Younger",
  );

  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveValue("22");
  await page.waitForLoadState("networkidle");
  expect(page.url()).toContain("age_max=22");
});

test("the ledger's ranking explanation discloses in every engine", async ({ page }) => {
  // Phase 8.3. The disclosure is a real <button> over a `hidden` region, so what
  // must hold on every engine is that pointer AND keyboard operation reveal the
  // backend's page-level explanation — its key sequence, tie-breaks and
  // limitation — and that the ledger keeps its width when they do.
  await page.goto("/");
  await page.waitForSelector('[data-testid="results-ledger"]');

  const toggle = page.locator('[data-testid="why-this-order-toggle"]');
  const region = page.locator('[data-testid="why-this-order-region"]');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(region).toBeHidden();
  await expect(page.locator('[data-testid="ranking-summary-collapsed"]')).toHaveText(
    "Ordered by RoleFit, highest first.",
  );

  const widthBefore = (await page.locator('[data-testid="results-ledger"]').boundingBox())!.width;

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(region).toBeVisible();
  expect(
    await page
      .locator('[data-testid="ranking-key"]')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-ranking-key"))),
  ).toEqual([
    "rated_first",
    "result_role_score",
    "result_role_confidence",
    "canonical_name",
    "player_id",
  ]);
  await expect(page.locator('[data-testid="ranking-tie-breakers"]')).toContainText(
    "Final tie-breakers, always applied last: Canonical Name, Player ID.",
  );
  await expect(page.locator('[data-testid="ranking-limitation"]')).toContainText(
    "ordering, not recruitment suitability",
  );
  // Page-level only: no engine may render a player-versus-player reason.
  expect(await region.textContent()).not.toMatch(/adjacent results|appears above/i);

  const widthAfter = (await page.locator('[data-testid="results-ledger"]').boundingBox())!.width;
  expect(Math.abs(widthAfter - widthBefore)).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

  // The platform's own button keyboard handling, on every engine.
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();
});

test("age slider track and ticks hold their geometry in every engine", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-testid="results-ledger"]')).toBeVisible();

  const geometry = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>(".age-slider-rail")!;
    const rr = rail.getBoundingClientRect();
    const cs = getComputedStyle(rail);
    return {
      rail: { top: rr.top, bottom: rr.bottom, height: rr.height, left: rr.left, width: rr.width },
      interior: {
        top: rr.top + parseFloat(cs.borderTopWidth),
        bottom: rr.bottom - parseFloat(cs.borderBottomWidth),
      },
      ticks: Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="age-slider-stop"]'),
      ).map((t) => {
        const b = t.getBoundingClientRect();
        return {
          stop: Number(t.dataset.ageStop),
          top: b.top,
          bottom: b.bottom,
          height: b.height,
          centre: b.left + b.width / 2,
        };
      }),
    };
  });

  // A real track, not a hairline.
  expect(geometry.rail.height).toBeGreaterThanOrEqual(12);
  expect(geometry.rail.height).toBeLessThanOrEqual(14);

  // Five stops, every one wholly inside the track and clear of both borders.
  expect(geometry.ticks.map((t) => t.stop)).toEqual([19, 22, 25, 28, 31]);
  for (const tick of geometry.ticks) {
    const where = `stop ${tick.stop}`;
    expect(tick.top, where).toBeGreaterThan(geometry.interior.top);
    expect(tick.bottom, where).toBeLessThan(geometry.interior.bottom);
    expect(tick.height / geometry.rail.height, where).toBeGreaterThanOrEqual(1 / 3);
    expect(tick.height / geometry.rail.height, where).toBeLessThanOrEqual(1 / 2);
  }

  // Evenly spaced, and the outer two aligned with the thumb's travel endpoints.
  const gaps = geometry.ticks.slice(1).map((t, i) => t.centre - geometry.ticks[i].centre);
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  const half = await page.evaluate(() =>
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--age-thumb-w"),
    ),
  );
  expect(Math.abs(geometry.ticks[0].centre - (geometry.rail.left + half / 2))).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      geometry.ticks[4].centre - (geometry.rail.left + geometry.rail.width - half / 2),
    ),
  ).toBeLessThanOrEqual(1);
});

test("leaderboard actions use the shared heart/Compare bar in every engine", async ({ page }) => {
  await page.goto("/roles/touchline_winger");
  // Both the desktop table and the mobile ledger are in the DOM; scope to the one
  // this viewport actually shows.
  const bar = page
    .locator('[data-testid="leaderboard-table"] [data-testid="card-action-bar"]')
    .first();
  await expect(bar).toBeVisible();
  await expect(bar.locator('[data-testid="compare-action"]')).toHaveText("Compare");
  await expect(bar.locator('[data-testid="favorite-heart"]')).toHaveAttribute(
    "data-filled",
    "false",
  );
  expect(await page.evaluate(() => document.body.innerText)).not.toMatch(
    /Shortlisted|Shortlist|Queued/,
  );

  await bar.locator('[data-testid="favorite-action"]').click();
  await expect(bar.locator('[data-testid="favorite-action"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(bar.locator('[data-testid="favorite-heart"]')).toHaveAttribute("data-filled", "true");
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
