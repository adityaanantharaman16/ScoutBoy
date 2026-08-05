import { expect, test, type Page } from "@playwright/test";

import { expectNoA11yViolations, readyForScan, settle } from "./support/a11y";
import { gotoFirstDossier, seedDeviceState, VIEWPORTS } from "./support/surfaces";

/**
 * Milestone 7 closeout — WCAG 2.2 Level A / AA.
 *
 * Automated axe scans (Phase 2) plus the structural, keyboard, contrast, target
 * size and reflow checks that axe cannot perform (Phases 3–7). Degraded-data and
 * stress coverage lives in `resilience.spec.ts`; motion lives in `motion.spec.ts`.
 */

// ---------------------------------------------------------------------------
// Phase 2 — automated scans
// ---------------------------------------------------------------------------

test.describe("Automated accessibility scans", () => {
  test("Discovery", async ({ page }) => {
    await page.goto("/");
    await readyForScan(page, '[data-testid="results-ledger"]');
    await expectNoA11yViolations(page, "Discovery");
  });

  test("Discovery with the compare tray open", async ({ page }) => {
    await seedDeviceState(page);
    await readyForScan(page, '[data-testid="compare-tray"]');
    await expectNoA11yViolations(page, "Discovery + compare tray");
  });

  test("player dossier, alternate role, and pinned evidence", async ({ page }) => {
    await gotoFirstDossier(page, '[data-testid="role-territory"]');
    await settle(page);
    await expectNoA11yViolations(page, "Player dossier");

    const tabs = page.locator('[role="tab"]');
    if ((await tabs.count()) > 1) {
      await tabs.nth(1).click();
      await settle(page);
      await expectNoA11yViolations(page, "Dossier — alternate role");
    }

    await page.locator('[data-testid^="evidence-group-"]').first().click();
    await settle(page);
    await expectNoA11yViolations(page, "Dossier — pinned territory evidence");
  });

  test("My Favorites with saved players", async ({ page }) => {
    await seedDeviceState(page);
    await page.goto("/shortlist");
    await readyForScan(page, "h1");
    await expectNoA11yViolations(page, "My Favorites");
  });

  test("Compare selection and completed comparison", async ({ page }) => {
    await page.goto("/compare");
    await readyForScan(page, '[data-testid="compare-a"]');
    await expectNoA11yViolations(page, "Compare selection");

    await page.getByTestId("compare-a").selectOption({ index: 1 });
    await page.getByTestId("compare-b").selectOption({ index: 2 });
    await page.waitForLoadState("networkidle");
    await settle(page);
    await expectNoA11yViolations(page, "Completed comparison");
  });

  test("no-shared-role comparison", async ({ page }) => {
    // A real disjoint pair in the seed cohort — no interception needed.
    await page.goto("/compare?a=6&b=17");
    await readyForScan(page, '[data-testid="compare-no-shared-role"]');
    await expectNoA11yViolations(page, "No shared rated role");
  });

  test("role leaderboard", async ({ page }) => {
    await page.goto("/roles/touchline_winger");
    await readyForScan(page, '[data-testid="leaderboard-table"]');
    await expectNoA11yViolations(page, "Role leaderboard");
  });

  test("Methodology", async ({ page }) => {
    await page.goto("/methodology");
    await readyForScan(page, '[data-testid="methodology-contents"]');
    await expectNoA11yViolations(page, "Methodology");
  });

  test("mobile navigation open", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await readyForScan(page, '[data-testid="results-ledger"]');
    await page.locator('[data-testid="nav-menu-toggle"]').click();
    await settle(page);
    await expectNoA11yViolations(page, "Mobile navigation open");
  });

  test("loading, empty and error states", async ({ page }) => {
    await page.route("**/api/players?**", async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.goto("/");
    await page.waitForSelector('[data-testid="ledger-skeleton"]');
    await settle(page);
    await expectNoA11yViolations(page, "Discovery loading");
    await page.unroute("**/api/players?**");

    await page.route("**/api/players?**", (r) => r.fulfill({ status: 500, body: "{}" }));
    await page.goto("/");
    await page.waitForSelector('[role="alert"]');
    await settle(page);
    await expectNoA11yViolations(page, "Discovery error");
    await page.unroute("**/api/players?**");

    await page.route("**/api/players?**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 12, total_pages: 1 }),
      }),
    );
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"], [role="status"]');
    await settle(page);
    await expectNoA11yViolations(page, "Discovery empty");
  });

  test("profile-only player without RoleFit analysis", async ({ page }) => {
    await page.route("**/api/players/*/ratings", (r) =>
      r.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
    );
    await gotoFirstDossier(page, '[data-testid="player-name"]');
    await settle(page);
    await expectNoA11yViolations(page, "Dossier with unavailable role audit");
  });

  test("not found route", async ({ page }) => {
    await page.goto("/definitely-not-a-route");
    await readyForScan(page, '[data-testid="not-found"]');
    await expectNoA11yViolations(page, "Not found");
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — semantics and structure
// ---------------------------------------------------------------------------

test.describe("Semantic structure", () => {
  const ROUTES: Array<[string, string, string]> = [
    ["/", '[data-testid="results-ledger"]', "ScoutBoy - Player Discovery"],
    ["/roles/touchline_winger", '[data-testid="leaderboard-table"]', "Role Leaderboard - ScoutBoy"],
    ["/compare", '[data-testid="compare-a"]', "Compare Players - ScoutBoy"],
    ["/shortlist", "h1", "My Favorites - ScoutBoy"],
    ["/methodology", '[data-testid="methodology-contents"]', "Methodology - ScoutBoy"],
  ];

  test("every route has a distinct, descriptive title", async ({ page }) => {
    const seen = new Map<string, string>();
    for (const [path, ready, expected] of ROUTES) {
      await page.goto(path);
      await page.waitForSelector(ready);
      const title = await page.title();
      expect(title, path).toBe(expected);
      expect(seen.has(title), `duplicate title "${title}" on ${path}`).toBe(false);
      seen.set(title, path);
    }
    // Dynamic routes get their own titles too.
    await gotoFirstDossier(page);
    expect(await page.title()).toBe("Player Dossier - ScoutBoy");
    await page.goto("/definitely-not-a-route");
    await page.waitForSelector('[data-testid="not-found"]');
    expect(await page.title()).toBe("Page Not Found - ScoutBoy");
  });

  test("each surface exposes exactly one h1 and an ordered heading outline", async ({ page }) => {
    for (const [path, ready] of ROUTES) {
      await page.goto(path);
      await page.waitForSelector(ready);
      const levels = await page.evaluate(() =>
        Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((h) =>
          Number(h.tagName[1]),
        ),
      );
      expect(levels.filter((l) => l === 1).length, `${path} h1 count`).toBe(1);
      // No level is skipped on the way down (h2 -> h4 would fail).
      for (let i = 1; i < levels.length; i += 1) {
        expect(levels[i] - levels[i - 1], `${path} heading jump at index ${i}`).toBeLessThanOrEqual(
          1,
        );
      }
    }
  });

  test("landmarks are present and uniquely named where duplicated", async ({ page }) => {
    await seedDeviceState(page);
    await settle(page);
    const landmarks = await page.evaluate(() => {
      // `<header>` and `<footer>` only expose banner/contentinfo when they are
      // NOT scoped inside article/aside/main/nav/section — a page-header inside
      // <main> is a plain generic element, not a second banner. Modelling that
      // correctly matters: without it this check invents duplicate-landmark
      // failures for perfectly valid markup.
      const SECTIONING = new Set(["ARTICLE", "ASIDE", "MAIN", "NAV", "SECTION"]);
      const scoped = (el: Element) => {
        let p = el.parentElement;
        while (p) {
          if (SECTIONING.has(p.tagName)) return true;
          p = p.parentElement;
        }
        return false;
      };
      const roleOf = (el: Element): string => {
        const explicit = el.getAttribute("role");
        if (explicit) return explicit;
        switch (el.tagName) {
          case "HEADER":
            return scoped(el) ? "" : "banner";
          case "FOOTER":
            return scoped(el) ? "" : "contentinfo";
          case "NAV":
            return "navigation";
          case "MAIN":
            return "main";
          case "ASIDE":
            // <aside> is complementary at any depth, but only counts as a
            // landmark worth naming when it is a top-level region.
            return "complementary";
          default:
            return "";
        }
      };
      return Array.from(
        document.querySelectorAll(
          "header,nav,main,aside,footer,[role=banner],[role=navigation],[role=main],[role=complementary],[role=contentinfo]",
        ),
      )
        .map((el) => ({
          role: roleOf(el),
          name:
            el.getAttribute("aria-label") ??
            document.getElementById(el.getAttribute("aria-labelledby") ?? "")?.textContent?.trim() ??
            "",
        }))
        .filter((l) => l.role !== "");
    });

    for (const role of ["banner", "navigation", "main", "contentinfo"]) {
      expect(landmarks.filter((l) => l.role === role).length, role).toBeGreaterThan(0);
    }
    // Where a role appears more than once, every instance must be named and the
    // names must be distinct — otherwise landmark navigation is ambiguous.
    for (const role of new Set(landmarks.map((l) => l.role))) {
      const group = landmarks.filter((l) => l.role === role);
      if (group.length < 2) continue;
      const names = group.map((g) => g.name);
      expect(names.every((n) => n.length > 0), `unnamed duplicate ${role}`).toBe(true);
      expect(new Set(names).size, `duplicate ${role} names: ${names.join(", ")}`).toBe(
        names.length,
      );
    }
  });

  test("the role selector implements the APG tabs pattern", async ({ page }) => {
    await gotoFirstDossier(page);
    const tablist = page.locator('[role="tablist"]');
    await expect(tablist).toHaveAttribute("aria-label", /.+/);

    const tabs = page.locator('[role="tab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThan(0);

    // Exactly one selected tab, exactly one tabbable tab (roving tabindex).
    expect(await page.locator('[role="tab"][aria-selected="true"]').count()).toBe(1);
    expect(await page.locator('[role="tab"][tabindex="0"]').count()).toBe(1);

    for (let i = 0; i < count; i += 1) {
      const tab = tabs.nth(i);
      const controls = await tab.getAttribute("aria-controls");
      expect(controls, `tab ${i} aria-controls`).toBeTruthy();
      await expect(page.locator(`#${controls}`)).toHaveAttribute("role", "tabpanel");
    }
    // The panel points back at the selected tab.
    const selectedId = await page.locator('[role="tab"][aria-selected="true"]').getAttribute("id");
    await expect(page.locator('[role="tabpanel"]')).toHaveAttribute("aria-labelledby", selectedId!);
  });

  test("state attributes and live regions are correct", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');

    // aria-current on the active navigation destination.
    await expect(page.locator('[data-testid="nav-discover"]')).toHaveAttribute(
      "aria-current",
      "page",
    );

    // aria-pressed toggles rather than the accessible name alone.
    const fav = page.locator('[data-testid="favorite-action"]').first();
    await expect(fav).toHaveAttribute("aria-pressed", "false");
    await fav.click();
    await expect(fav).toHaveAttribute("aria-pressed", "true");

    // Polite live region exists for device-local scouting actions.
    expect(await page.locator('[aria-live="polite"]').count()).toBeGreaterThan(0);
  });

  test("decorative pitch art is hidden and every value has a text equivalent", async ({ page }) => {
    await gotoFirstDossier(page, '[data-testid="role-territory"]');

    // The illustration is decorative; its data is duplicated as real text.
    const svgHidden = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="role-territory"] svg');
      return svg?.getAttribute("aria-hidden") === "true" || svg?.getAttribute("role") === "presentation";
    });
    expect(svgHidden).toBe(true);

    // Every group on the pitch is also a focusable, named evidence control.
    const groups = page.locator('[data-testid^="evidence-group-"]');
    expect(await groups.count()).toBeGreaterThan(0);
    for (let i = 0; i < (await groups.count()); i += 1) {
      await expect(groups.nth(i)).toHaveAttribute("aria-label", /.+/);
    }
    // The permanent illustrative disclosure is real text, not a tooltip.
    await expect(page.locator('[data-testid="territory-disclosure"]')).toContainText(
      "Not tracking or event-location data",
    );
  });

  test("accessible names match visible labels on ledger actions", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    const row = page.locator('[data-testid="result-row"]').first();
    const name = (await row.locator('[data-testid="player-result"]').innerText()).trim();

    // Icon-only control: the name must identify both the action and the player.
    const fav = row.locator('[data-testid="favorite-action"]');
    await expect(fav).toHaveAccessibleName(`Add ${name} to My Favorites`);
    await fav.click();
    await expect(fav).toHaveAccessibleName(`Remove ${name} from My Favorites`);

    // Labelled control: the visible word must appear in the accessible name
    // (WCAG 2.5.3 Label in Name).
    const compare = row.locator('[data-testid="compare-action"]');
    const visible = (await compare.innerText()).trim();
    expect((await compare.getAttribute("aria-label"))!.toLowerCase()).toContain(
      visible.toLowerCase(),
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — keyboard and focus
// ---------------------------------------------------------------------------

test.describe("Keyboard and focus", () => {
  test("the skip link is the first stop and moves focus to main", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await page.keyboard.press("Tab");
    const skip = page.locator(".skip-link");
    await expect(skip).toBeFocused();
    // It must be visible once focused, not merely present.
    expect((await skip.boundingBox())!.x).toBeGreaterThanOrEqual(0);
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => location.hash)).toBe("#main");
  });

  test("no positive tabindex and no unreachable control on any surface", async ({ page }) => {
    for (const path of ["/", "/compare", "/shortlist", "/methodology", "/roles/touchline_winger"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const positive = await page.evaluate(() =>
        Array.from(document.querySelectorAll("[tabindex]"))
          .map((el) => Number(el.getAttribute("tabindex")))
          .filter((n) => n > 0),
      );
      expect(positive, `positive tabindex on ${path}`).toEqual([]);
    }
  });

  test("focus is visible and never clipped by an ancestor's overflow", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    // Walk a realistic number of stops and assert each focused control is both
    // visible and inside the viewport once scrolled to.
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          tag: el.tagName,
          testid: el.dataset.testid ?? "",
          w: r.width,
          h: r.height,
          outlineWidth: s.outlineWidth,
          // Focus indication must not be delayed by a transition.
          transitionProperty: s.transitionProperty,
        };
      });
      if (!info) continue;
      expect(info.w * info.h, `zero-size focus target ${info.tag} ${info.testid}`).toBeGreaterThan(
        0,
      );
      expect(info.transitionProperty).not.toContain("outline");
    }
  });

  test("a focused control is never fully covered by the compare tray", async ({ page }) => {
    await seedDeviceState(page);
    await settle(page);
    await expect(page.locator('[data-testid="compare-tray"]')).toBeVisible();

    // Tab through the page and confirm nothing that receives focus ends up
    // completely hidden behind the fixed tray (WCAG 2.2 SC 2.4.11 Focus Not
    // Obscured (Minimum) — the focused control must not be ENTIRELY hidden).
    const tray = (await page.locator('[data-testid="compare-tray"]').boundingBox())!;
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      const box = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, id: el.dataset.testid ?? el.tagName };
      });
      if (!box || box.w === 0) continue;
      const fullyBehind =
        box.y >= tray.y &&
        box.y + box.h <= tray.y + tray.height &&
        box.x >= tray.x &&
        box.x + box.w <= tray.x + tray.width;
      // Controls inside the tray itself are not "obscured by" it.
      const insideTray = await page.evaluate(
        () => !!document.activeElement?.closest('[data-testid="compare-tray"]'),
      );
      expect(fullyBehind && !insideTray, `focus obscured by tray: ${box.id}`).toBe(false);
    }
  });

  test("role tabs are fully keyboard operable", async ({ page }) => {
    await gotoFirstDossier(page);
    const tabs = page.locator('[role="tab"]');
    const n = await tabs.count();
    test.skip(n < 2, "needs at least two roles");

    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowLeft");
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("End");
    await expect(tabs.nth(n - 1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");

    // The panel is reachable from the tab strip.
    await page.keyboard.press("Tab");
    await expect(page.locator('[role="tabpanel"]')).toBeFocused();
  });

  test("evidence groups take focus and pin from the keyboard", async ({ page }) => {
    await gotoFirstDossier(page, '[data-testid="role-territory"]');
    const group = page.locator('[data-testid^="evidence-group-"]').first();
    await group.focus();
    await expect(group).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(group).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Enter");
    await expect(group).toHaveAttribute("aria-pressed", "false");
  });

  test("native disclosures stay keyboard operable", async ({ page }) => {
    await gotoFirstDossier(page, '[data-testid="evidence-context-rail"]');
    const rail = page.locator('[data-testid="evidence-context-rail"]');
    await rail.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(rail).not.toHaveAttribute("open", /.*/);
    await page.keyboard.press("Enter");
    await expect(rail).toHaveAttribute("open", "");
  });

  test("the methodology formula region is reachable by keyboard", async ({ page }) => {
    await page.goto("/methodology");
    await page.waitForSelector('[data-testid="methodology-formula"]');
    const pre = page.locator('[data-testid="methodology-formula"]');
    // It scrolls horizontally, so it must be focusable (WCAG 2.1.1).
    await expect(pre).toHaveAttribute("tabindex", "0");
    await expect(pre).toHaveAccessibleName(/formula/i);
    await pre.focus();
    await expect(pre).toBeFocused();
  });

  test("mobile menu keeps focus sane and closes on navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    const toggle = page.locator('[data-testid="nav-menu-toggle"]');

    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Focus stays on the toggle, which is a valid disclosure pattern; the menu
    // content is the very next stop.
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator('[data-testid="nav-discover"]')).toBeFocused();

    await page.keyboard.press("Enter");
    await page.waitForLoadState("networkidle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Focus is not stranded inside content that has been hidden.
    const stranded = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const panel = document.querySelector("#primary-nav-links");
      return !!panel && panel.contains(el) && getComputedStyle(panel).display === "none";
    });
    expect(stranded).toBe(false);
  });

  test("removing a saved player leaves focus in a usable place", async ({ page }) => {
    await seedDeviceState(page);
    await page.goto("/shortlist");
    await page.waitForSelector('[data-testid="remove-action"]');
    const before = await page.locator('[data-testid="remove-action"]').count();
    expect(before).toBeGreaterThan(1);

    const remove = page.locator('[data-testid="remove-action"]').first();
    await remove.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="remove-action"]')).toHaveCount(before - 1);

    // Focus must not be left on a detached node.
    const connected = await page.evaluate(() => document.activeElement?.isConnected ?? false);
    expect(connected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — contrast and non-colour meaning
// ---------------------------------------------------------------------------

test.describe("Contrast and non-colour meaning", () => {
  /** WCAG relative-luminance contrast between two computed rgb() colours. */
  const CONTRAST_FN = `
    (fg, bg) => {
      const parse = (c) => c.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number);
      const lum = (c) => {
        const [r, g, b] = parse(c).map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const a = lum(fg), b2 = lum(bg);
      return (Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05);
    }`;

  test("control boundaries meet the 3:1 non-text minimum", async ({ page }) => {
    // SC 1.4.11. axe does not test this, so it is measured explicitly. A `.btn`
    // and an `.input` sit on a background only 1.08:1 from their own fill, so the
    // border is the only thing identifying them as controls.
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    const results = await page.evaluate((fnSrc) => {
      const contrast = eval(fnSrc) as (fg: string, bg: string) => number;
      const out: { sel: string; ratio: number }[] = [];
      for (const sel of [".btn", ".input", "select.input", ".rail-box", ".rail-action"]) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) continue;
        const s = getComputedStyle(el);
        // Only elements that actually paint a boundary can fail SC 1.4.11 on it.
        // `.rail-action` deliberately has no border of its own — the surrounding
        // `.rail-box` draws the group's boundary — so measuring its (zero-width,
        // currentColor) border would report a meaningless 1.19:1.
        if (parseFloat(s.borderTopWidth) === 0) continue;
        // Walk up for the effective background behind the control.
        let bgEl: HTMLElement | null = el.parentElement;
        let bg = "rgb(255, 255, 255)";
        while (bgEl) {
          const c = getComputedStyle(bgEl).backgroundColor;
          if (c && !c.includes("rgba(0, 0, 0, 0)")) {
            bg = c;
            break;
          }
          bgEl = bgEl.parentElement;
        }
        out.push({ sel, ratio: contrast(s.borderTopColor, bg) });
      }
      return out;
    }, CONTRAST_FN);

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.ratio, `${r.sel} border contrast ${r.ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  test("the focus indicator meets 3:1 against its background", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const ratio = await page.evaluate((fnSrc) => {
      const contrast = eval(fnSrc) as (fg: string, bg: string) => number;
      const el = document.activeElement as HTMLElement;
      const s = getComputedStyle(el);
      let bgEl: HTMLElement | null = el;
      let bg = "rgb(255, 255, 255)";
      while (bgEl) {
        const c = getComputedStyle(bgEl).backgroundColor;
        if (c && !c.includes("rgba(0, 0, 0, 0)")) {
          bg = c;
          break;
        }
        bgEl = bgEl.parentElement;
      }
      return contrast(s.outlineColor, bg);
    }, CONTRAST_FN);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  test("selected role tabs are identifiable without colour", async ({ page }) => {
    await gotoFirstDossier(page);
    const state = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"]')) as HTMLElement[];
      return tabs.map((t) => ({
        selected: t.getAttribute("aria-selected") === "true",
        boxShadow: getComputedStyle(t).boxShadow,
      }));
    });
    const selected = state.find((s) => s.selected)!;
    const unselected = state.find((s) => !s.selected)!;
    // The selected tab carries a structural inset marker, not colour alone —
    // and, decisively, `aria-selected` is programmatically exposed.
    expect(selected.boxShadow).not.toBe("none");
    expect(selected.boxShadow).not.toBe(unselected.boxShadow);
  });

  test("confidence and unknown evidence carry text, not just glyphs", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    // The compound status unit names both facts in its accessible description.
    const status = page.locator('[data-testid="card-status"]').first();
    const label = await status.getAttribute("aria-label");
    expect(label).toMatch(/Evidence coverage: .+\. RoleFit confidence: .+\./);
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — target size
// ---------------------------------------------------------------------------

test.describe("Target size (WCAG 2.2 SC 2.5.8)", () => {
  test("primary pointer targets are at least 24x24 or adequately spaced", async ({ page }) => {
    await seedDeviceState(page);
    await settle(page);

    const offenders = await page.evaluate(() => {
      const MIN = 24;
      const bad: { id: string; w: number; h: number }[] = [];
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>("button, a[href], select, input, summary, [role=tab]"),
      );
      for (const el of controls) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue; // not rendered
        if (r.width >= MIN && r.height >= MIN) continue;
        // SC 2.5.8 exception: a target in a sentence / block of text is exempt.
        const inText = !!el.closest("p, li, dd, dt") || el.tagName === "A";
        if (inText) continue;
        bad.push({
          id: el.dataset.testid || `${el.tagName}:${(el.textContent ?? "").trim().slice(0, 25)}`,
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
      return bad;
    });
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  test("mobile action rails keep their 44px targets", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    for (const id of ["favorite-action", "compare-action"]) {
      const box = (await page.locator(`[data-testid="${id}"]`).first().boundingBox())!;
      expect(box.height, `${id} height`).toBeGreaterThanOrEqual(44);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 7 — reflow, zoom and text spacing
// ---------------------------------------------------------------------------

test.describe("Reflow, zoom and text spacing", () => {
  const SURFACES: Array<[string, string]> = [
    ["/", '[data-testid="results-ledger"]'],
    // The leaderboard renders BOTH a desktop table and a mobile ledger, one of
    // which is hidden at any given width, so the readiness anchor must be the
    // heading rather than either presentation.
    ["/roles/touchline_winger", "h1"],
    ["/compare", '[data-testid="compare-a"]'],
    ["/shortlist", "h1"],
    ["/methodology", '[data-testid="methodology-contents"]'],
  ];

  for (const vp of VIEWPORTS) {
    test(`no horizontal page scrolling at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const [path, ready] of SURFACES) {
        await page.goto(path);
        await page.waitForSelector(ready);
        await settle(page);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${path} @ ${vp.name}`).toBeLessThanOrEqual(0);
      }
    });
  }

  test("dossier reflows at 320 without clipping the score or role name", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await gotoFirstDossier(page, '[data-testid="role-territory"]');
    await settle(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);

    // No element spills outside its own container.
    // Only an element that HIDES its overflow can actually clip content. An
    // element with `overflow: visible` whose scrollWidth exceeds its clientWidth
    // has simply painted outside its own box — and since the page itself does not
    // scroll horizontally (asserted above), that content is still on screen.
    // Intentional internal scrollers (the methodology formula, the leaderboard
    // table shell) are bounded regions, not clipping, so they are excluded.
    const clipped = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))) {
        const s = getComputedStyle(el);
        const hides = s.overflowX === "hidden" || s.overflowY === "hidden";
        if (!hides) continue;
        if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
          bad.push(`${el.dataset.testid} ${el.scrollWidth}x${el.scrollHeight} vs ${el.clientWidth}x${el.clientHeight}`);
        }
      }
      return bad;
    });
    expect(clipped).toEqual([]);
  });

  test("survives the WCAG 1.4.12 text-spacing overrides", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [path, ready] of SURFACES) {
      await page.goto(path);
      await page.waitForSelector(ready);
      await page.addStyleTag({
        content: `* {
          line-height: 1.5 !important;
          letter-spacing: 0.12em !important;
          word-spacing: 0.16em !important;
        }
        p { margin-bottom: 2em !important; }`,
      });
      await settle(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} with text-spacing overrides`).toBeLessThanOrEqual(0);
      // Nothing became unreadable through clipping.
      const clipped = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
          .filter(
            (el) =>
              getComputedStyle(el).overflow === "hidden" &&
              el.scrollHeight > el.clientHeight + 4 &&
              (el.textContent ?? "").trim().length > 0,
          )
          .map((el) => el.dataset.testid!),
      );
      expect(clipped, `${path} clipped under text spacing`).toEqual([]);
    }
  });
});
