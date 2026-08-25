import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Milestone 8.4B: saved Discovery views and saved comparison setups, end to end
 * against a production build.
 *
 * This is the layer the unit suites cannot reach: real navigation, a real
 * address bar, real browser history, real `localStorage`, and the real
 * production bundle. Everything here runs as a GUEST, because that is the
 * configuration the gates run in and because every 8.4B feature has to work
 * without an account.
 */

const VIEWS_STORAGE_ID = "scoutboy.savedViews.v1";
const COMPARISONS_STORAGE_ID = "scoutboy.savedComparisons.v1";

async function readCollection(page: Page, key: string) {
  return page.evaluate((k) => {
    const raw = window.localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  }, key);
}

/** Narrows Discovery through the rail, then saves the resulting cohort. */
async function saveCurrentView(page: Page, name: string) {
  await page.getByTestId("save-view-trigger").click();
  await page.getByTestId("save-view-panel-input").fill(name);
  await page.getByTestId("save-view-panel-submit").click();
  await expect(page.getByTestId("save-view-panel")).toBeHidden();
}

test.describe("Saved Discovery views", () => {
  test("saves the current cohort, and reopens it on page 1", async ({ page }) => {
    await page.goto("/?age_max=22");
    await page.waitForSelector('[data-testid="results-ledger"]');

    await saveCurrentView(page, "Under 22");

    const stored = await readCollection(page, VIEWS_STORAGE_ID);
    expect(stored.version).toBe(1);
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0].label).toBe("Under 22");
    // The page number is never part of a view.
    expect(stored.items[0].view).not.toHaveProperty("page");

    await page.goto("/saved?section=views");
    const open = page.getByTestId("saved-view-open");
    await expect(open).toHaveAttribute("href", "/?age_max=22");
    await open.click();

    await expect(page).toHaveURL(/\/\?age_max=22$/);
    await page.waitForSelector('[data-testid="results-ledger"]');
    await expect(page.getByTestId("result-count")).toContainText("page 1 of");
  });

  test("survives a hard load, a reload, and back/forward", async ({ page }) => {
    await page.goto("/?club=a");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await saveCurrentView(page, "Club filter");

    // Hard load of the hub.
    await page.goto("/saved?section=views");
    await expect(page.getByTestId("saved-view-label")).toHaveText("Club filter");

    // Reload.
    await page.reload();
    await expect(page.getByTestId("saved-view-label")).toHaveText("Club filter");
    await expect(page.getByTestId("saved-section-views")).toHaveAttribute("data-active", "true");

    // Section state is real navigation.
    await page.getByTestId("saved-section-comparisons").click();
    await expect(page).toHaveURL(/section=comparisons/);
    await page.goBack();
    await expect(page.getByTestId("saved-section-views")).toHaveAttribute("data-active", "true");
    await page.goForward();
    await expect(page.getByTestId("saved-section-comparisons")).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  test("saving the same cohort again renames it rather than duplicating it", async ({ page }) => {
    await page.goto("/?age_max=22");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await saveCurrentView(page, "First name");

    await expect(page.getByTestId("save-view-trigger")).toHaveAttribute("data-saved", "true");
    await saveCurrentView(page, "Second name");

    const stored = await readCollection(page, VIEWS_STORAGE_ID);
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0].label).toBe("Second name");
  });

  test("renames and removes from the hub, with a deliberate confirmation", async ({ page }) => {
    await page.goto("/?age_max=22");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await saveCurrentView(page, "Original");

    await page.goto("/saved?section=views");
    await page.getByTestId("saved-view-rename").click();
    await page.getByTestId("saved-view-rename-panel-input").fill("Renamed");
    await page.getByTestId("saved-view-rename-panel-submit").click();
    await expect(page.getByTestId("saved-view-label")).toHaveText("Renamed");

    // Removal takes two deliberate presses, and no native confirm() appears.
    let nativeDialog = false;
    page.on("dialog", () => {
      nativeDialog = true;
    });
    await page.getByTestId("saved-view-remove").click();
    await expect(page.getByTestId("saved-view-label")).toHaveText("Renamed");
    await page.getByTestId("saved-view-remove-confirm").click();

    await expect(page.getByTestId("saved-views-ledger")).toBeHidden();
    expect(nativeDialog).toBe(false);
  });

  test("recovers from corrupt, unversioned and unknown-version storage", async ({ page }) => {
    for (const corrupt of [
      "{not json",
      JSON.stringify([{ label: "bare array" }]),
      JSON.stringify({ version: 99, items: [{ label: "future" }] }),
      JSON.stringify({ version: 1, items: "not an array" }),
    ]) {
      await page.goto("/saved?section=views");
      await page.evaluate(
        ([k, v]) => window.localStorage.setItem(k, v),
        [VIEWS_STORAGE_ID, corrupt] as const,
      );
      await page.reload();
      // The surface renders its empty state rather than throwing.
      await expect(page.getByTestId("saved-sections")).toBeVisible();
      await expect(page.getByText(/No saved Discovery views yet/)).toBeVisible();
    }
  });

  test("keeps one bad record from taking its valid siblings", async ({ page }) => {
    await page.goto("/saved?section=views");
    await page.evaluate(
      ([k]) =>
        window.localStorage.setItem(
          k,
          JSON.stringify({
            version: 1,
            items: [
              {
                clientId: "0f8fad5b-d9cb-469f-a165-70867728950e",
                label: "Good one",
                view: { club: "a" },
                createdAt: 1,
                updatedAt: 1,
              },
              { label: "no client id" },
              null,
            ],
          }),
        ),
      [VIEWS_STORAGE_ID] as const,
    );
    await page.reload();
    await expect(page.getByTestId("saved-view-label")).toHaveText("Good one");
    await expect(page.getByTestId("saved-view-row")).toHaveCount(1);
  });

  test("reopens what is still valid when part of a view went stale", async ({ page }) => {
    await page.goto("/saved?section=views");
    await page.evaluate(
      ([k]) =>
        window.localStorage.setItem(
          k,
          JSON.stringify({
            version: 1,
            items: [
              {
                clientId: "0f8fad5b-d9cb-469f-a165-70867728950e",
                label: "Partly stale",
                view: { club: "a", age_max: 22, role: "a_retired_role" },
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          }),
        ),
      [VIEWS_STORAGE_ID] as const,
    );
    await page.reload();

    await expect(page.getByTestId("saved-view-unavailable")).toContainText("no longer supported");
    await expect(page.getByTestId("saved-view-open")).toHaveAttribute(
      "href",
      "/?club=a&age_max=22",
    );
    // Still fully manageable.
    await expect(page.getByTestId("saved-view-rename")).toBeEnabled();
    await expect(page.getByTestId("saved-view-remove")).toBeEnabled();
  });

  test("does not put saved-view management inside the filter rail", async ({ page }) => {
    await page.goto("/?age_max=22");
    await page.waitForSelector('[data-testid="results-ledger"]');
    const rail = page.getByTestId("filter-column");
    await expect(rail.getByTestId("save-view-trigger")).toHaveCount(0);
    await expect(rail.getByTestId("saved-view-row")).toHaveCount(0);
    // The action exists, at the results level.
    await expect(page.getByTestId("save-view-trigger")).toBeVisible();
  });
});

test.describe("The Compare URL contract", () => {
  test("keeps all three selectors in the URL, and restores them", async ({ page }) => {
    await page.goto("/compare");
    await page.waitForSelector('[data-testid="compare-a"]');

    const options = page.locator('[data-testid="compare-a"] option');
    const first = await options.nth(1).getAttribute("value");
    const second = await options.nth(2).getAttribute("value");

    await page.getByTestId("compare-a").selectOption(first!);
    await expect(page).toHaveURL(new RegExp(`a=${first}`));
    await page.getByTestId("compare-b").selectOption(second!);
    await expect(page).toHaveURL(new RegExp(`b=${second}`));
    await page.getByTestId("compare-role-select").selectOption("advanced_8");
    await expect(page).toHaveURL(/role=advanced_8/);

    await page.reload();
    await expect(page.getByTestId("compare-a")).toHaveValue(first!);
    await expect(page.getByTestId("compare-b")).toHaveValue(second!);
    await expect(page.getByTestId("compare-role-select")).toHaveValue("advanced_8");

    await page.goBack();
    await expect(page.getByTestId("compare-role-select")).toHaveValue("");
    await page.goForward();
    await expect(page.getByTestId("compare-role-select")).toHaveValue("advanced_8");
  });

  test("Automatic Role omits the parameter entirely", async ({ page }) => {
    await page.goto("/compare?a=1&b=2&role=advanced_8");
    await page.waitForSelector('[data-testid="compare-role-select"]');
    await page.getByTestId("compare-role-select").selectOption("");
    await expect(page).toHaveURL(/\/compare\?a=1&b=2$/);
  });

  test("reports an unusable link honestly", async ({ page }) => {
    await page.goto("/compare?a=abc&b=2&role=not_a_role");
    await expect(page.getByTestId("compare-url-notice")).toBeVisible();
    await expect(page.getByTestId("compare-a")).toHaveValue("");
    await expect(page.getByTestId("compare-role-select")).toHaveValue("");
  });

  test("the compare tray stays suppressed here and returns afterwards", async ({ page }) => {
    // The 8.4A behaviour, re-asserted because 8.4B changed this page.
    await page.goto("/");
    await page.waitForSelector('[data-testid="result-row"]');
    await page.locator('[data-testid="compare-action"]').first().click();
    await page.locator('[data-testid="compare-action"]').nth(1).click();
    await expect(page.getByTestId("compare-tray")).toBeVisible();

    await page.getByRole("link", { name: "Open Comparison" }).click();
    await expect(page).toHaveURL(/\/compare\?a=\d+&b=\d+/);
    await expect(page.getByTestId("compare-tray")).toBeHidden();

    // The queue is untouched: leaving brings it straight back.
    const queue = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("scoutboy.compareQueue.v1") ?? "[]"),
    );
    expect(queue).toHaveLength(2);
    await page.goto("/");
    await expect(page.getByTestId("compare-tray")).toBeVisible();
  });
});

test.describe("Saved comparison setups", () => {
  async function saveComparison(page: Page, name: string) {
    await page.getByTestId("save-comparison-trigger").click();
    await page.getByTestId("save-comparison-panel-input").fill(name);
    await page.getByTestId("save-comparison-panel-submit").click();
    await expect(page.getByTestId("save-comparison-panel")).toBeHidden();
  }

  test("saves the ordered pair and the selected role, and reopens it", async ({ page }) => {
    await page.goto("/compare");
    await page.waitForSelector('[data-testid="compare-a"]');
    const options = page.locator('[data-testid="compare-a"] option');
    const a = await options.nth(1).getAttribute("value");
    const b = await options.nth(2).getAttribute("value");

    await page.getByTestId("compare-a").selectOption(a!);
    await page.getByTestId("compare-b").selectOption(b!);
    await page.getByTestId("compare-role-select").selectOption("advanced_8");
    await saveComparison(page, "Midfield duel");

    const stored = await readCollection(page, COMPARISONS_STORAGE_ID);
    expect(stored.version).toBe(1);
    expect(stored.items[0].playerA.playerId).toBe(Number(a));
    expect(stored.items[0].playerB.playerId).toBe(Number(b));
    expect(stored.items[0].roleKey).toBe("advanced_8");
    // A setup, never a result.
    expect(JSON.stringify(stored).toLowerCase()).not.toContain("score");

    await page.goto("/saved?section=comparisons");
    await expect(page.getByTestId("saved-comparison-open")).toHaveAttribute(
      "href",
      `/compare?a=${a}&b=${b}&role=advanced_8`,
    );
    await page.getByTestId("saved-comparison-open").click();
    await expect(page.getByTestId("compare-role-select")).toHaveValue("advanced_8");
  });

  test("Automatic Role saves as an omitted role", async ({ page }) => {
    await page.goto("/compare");
    await page.waitForSelector('[data-testid="compare-a"]');
    const options = page.locator('[data-testid="compare-a"] option');
    const a = await options.nth(1).getAttribute("value");
    const b = await options.nth(2).getAttribute("value");
    await page.getByTestId("compare-a").selectOption(a!);
    await page.getByTestId("compare-b").selectOption(b!);
    await saveComparison(page, "Automatic");

    const stored = await readCollection(page, COMPARISONS_STORAGE_ID);
    expect(stored.items[0].roleKey).toBeNull();
    await page.goto("/saved?section=comparisons");
    await expect(page.getByTestId("saved-comparison-open")).toHaveAttribute(
      "href",
      `/compare?a=${a}&b=${b}`,
    );
  });

  test("the reversed pair is a different saved setup", async ({ page }) => {
    await page.goto("/compare");
    await page.waitForSelector('[data-testid="compare-a"]');
    const options = page.locator('[data-testid="compare-a"] option');
    const a = await options.nth(1).getAttribute("value");
    const b = await options.nth(2).getAttribute("value");

    await page.getByTestId("compare-a").selectOption(a!);
    await page.getByTestId("compare-b").selectOption(b!);
    await saveComparison(page, "A then B");

    await page.getByTestId("compare-a").selectOption(b!);
    await page.getByTestId("compare-b").selectOption(a!);
    await saveComparison(page, "B then A");

    const stored = await readCollection(page, COMPARISONS_STORAGE_ID);
    expect(stored.items).toHaveLength(2);
  });
});

test.describe("The Saved Work hub", () => {
  test("replaces My Favorites with one Saved entry, and keeps /shortlist alive", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await expect(page.getByTestId("nav-saved")).toHaveAttribute("href", "/saved");
    await expect(page.getByTestId("nav-shortlist")).toHaveCount(0);
    // No second top-level entry was added for the new collections.
    await expect(page.getByTestId("nav-views")).toHaveCount(0);
    await expect(page.getByTestId("nav-comparisons")).toHaveCount(0);

    // The legacy bookmark still works, and is not a 404.
    const response = await page.goto("/shortlist");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("h1")).toHaveText("My Favorites");
  });

  test("opens one section at a time and defaults to My Favorites", async ({ page }) => {
    await page.goto("/saved");
    await expect(page.getByTestId("saved-section-favorites")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(page.getByTestId("saved-views-ledger")).toHaveCount(0);
    await expect(page.getByTestId("saved-comparisons-ledger")).toHaveCount(0);
  });

  test("falls back to Favorites for a malformed section", async ({ page }) => {
    await page.goto("/saved?section=nope");
    await expect(page.getByTestId("saved-section-favorites")).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  test("stores a script-shaped label as inert text", async ({ page }) => {
    const label = "<img src=x onerror=window.__xss=1>";
    await page.goto("/?age_max=22");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await saveCurrentView(page, label);

    await page.goto("/saved?section=views");
    await expect(page.getByTestId("saved-view-label")).toHaveText(label);
    // No element was created and no handler ran.
    expect(await page.locator("img").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });
});

test.describe("Saved Work accessibility and geometry", () => {
  const SECTIONS = ["favorites", "views", "comparisons"] as const;

  test.beforeEach(async ({ page }) => {
    // One saved item of each kind, so the audits see POPULATED rows rather than
    // three empty states.
    //
    // Seeded straight into storage rather than driven through the UI: what these
    // audits examine is the rendered Saved Work surface, and re-performing a
    // Discovery search and a Compare selection before each of a dozen viewport
    // permutations spends minutes proving something the functional tests above
    // already prove. `addInitScript` runs before any page script, so the first
    // render already has the collections.
    await page.addInitScript(
      ([viewsKey, comparisonsKey]) => {
        window.localStorage.setItem(
          viewsKey,
          JSON.stringify({
            version: 1,
            items: [
              {
                clientId: "0f8fad5b-d9cb-469f-a165-70867728950e",
                label: "Audited view",
                view: { club: "a", age_max: 22, rolefit_min: 60 },
                createdAt: 1735689600000,
                updatedAt: 1735689600000,
              },
            ],
          }),
        );
        window.localStorage.setItem(
          comparisonsKey,
          JSON.stringify({
            version: 1,
            items: [
              {
                clientId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
                label: "Audited comparison",
                playerA: { playerId: 7, name: "Anton Keller" },
                playerB: { playerId: 5, name: "Luca Moretti" },
                roleKey: "advanced_8",
                createdAt: 1735689600000,
                updatedAt: 1735689600000,
              },
            ],
          }),
        );
        // A favourite too, so the Favorites section is populated as well.
        window.localStorage.setItem("scoutboy.shortlist.v1", JSON.stringify([7]));
      },
      [VIEWS_STORAGE_ID, COMPARISONS_STORAGE_ID] as const,
    );
  });

  for (const section of SECTIONS) {
    test(`has no axe violations in the ${section} section`, async ({ page }) => {
      await page.goto(`/saved?section=${section}`);
      await page.waitForSelector('[data-testid="saved-sections"]');
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });

    test(`renders every rectangle at 90 degrees in the ${section} section`, async ({ page }) => {
      await page.goto(`/saved?section=${section}`);
      await page.waitForSelector('[data-testid="saved-sections"]');
      const offenders = await page.evaluate(() =>
        Array.from(document.querySelectorAll("*"))
          .filter((element) => {
            if (element instanceof SVGElement) return false;
            const style = getComputedStyle(element);
            return [
              style.borderTopLeftRadius,
              style.borderTopRightRadius,
              style.borderBottomLeftRadius,
              style.borderBottomRightRadius,
            ].some((radius) => radius !== "0px");
          })
          .map((element) => `${element.tagName}.${element.className}`),
      );
      expect(offenders).toEqual([]);
    });
  }

  test("the naming panel is fully keyboard-operable, and returns focus", async ({ page }) => {
    await page.goto("/saved?section=views");
    await page.waitForSelector('[data-testid="saved-view-row"]');

    await page.getByTestId("saved-view-rename").focus();
    await page.keyboard.press("Enter");
    // Focus lands in the field, with the existing name selected.
    await expect(page.getByTestId("saved-view-rename-panel-input")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("saved-view-rename-panel")).toBeHidden();
    await expect(page.getByTestId("saved-view-rename")).toBeFocused();
  });

  test("an OPEN naming panel stays inside the viewport at every width", async ({ page }) => {
    // A closed panel cannot overflow, so an overflow check alone never sees this.
    // A panel anchored to the wrong side hangs off the LEFT edge, which does not
    // grow `scrollWidth` either - it just clips the field being typed into. So
    // this measures the panel's own box against the viewport.
    for (const width of [1280, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/saved?section=views");
      await page.waitForSelector('[data-testid="saved-view-row"]');
      await page.getByTestId("saved-view-rename").click();

      const box = (await page.getByTestId("saved-view-rename-panel").boundingBox())!;
      expect(box.x, `left edge at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `right edge at ${width}px`).toBeLessThanOrEqual(width);
      // And the field inside it is genuinely reachable.
      await expect(page.getByTestId("saved-view-rename-panel-input")).toBeVisible();
    }
  });

  test("every action meets the 24px minimum target size", async ({ page }) => {
    await page.goto("/saved?section=views");
    await page.waitForSelector('[data-testid="saved-view-row"]');
    for (const id of ["saved-view-open", "saved-view-rename", "saved-view-remove"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box!.width, id).toBeGreaterThanOrEqual(24);
      expect(box!.height, id).toBeGreaterThanOrEqual(24);
    }
  });

  test.describe("reflow", () => {
    for (const width of [1440, 1280, 1024, 768, 640, 390, 320]) {
      test(`has no horizontal overflow at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        for (const section of SECTIONS) {
          await page.goto(`/saved?section=${section}`);
          await page.waitForSelector('[data-testid="saved-sections"]');
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow, `${section} at ${width}px`).toBeLessThanOrEqual(0);
        }
      });
    }
  });
});
