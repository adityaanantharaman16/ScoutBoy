import { expect, test, type Page } from "@playwright/test";

// The Interaction & Motion cadence, audited against COMPUTED styles rather than
// class names, and against final state / stable geometry rather than sleeps.
//
// Two modes are covered: normal motion (durations, easings, origins, budgets) and
// `reducedMotion: "reduce"`, where every duration must be zero and every
// interaction must complete without waiting on an animation.

const BUDGET_MS = 240;

/** Computed transition/animation durations of an element, in milliseconds. */
async function timings(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    const ms = (value: string) =>
      value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => (v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000));
    return {
      transitionProperty: s.transitionProperty,
      transitionDuration: ms(s.transitionDuration),
      transitionTimingFunction: s.transitionTimingFunction,
      animationName: s.animationName,
      animationDuration: ms(s.animationDuration),
      animationIterationCount: s.animationIterationCount,
      animationTimingFunction: s.animationTimingFunction,
    };
  }, selector);
}

async function tokenValues(page: Page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const read = (name: string) => root.getPropertyValue(name).trim();
    return {
      feedback: read("--motion-feedback"),
      state: read("--motion-state"),
      enter: read("--motion-enter"),
      exit: read("--motion-exit"),
      easeOut: read("--motion-ease-out"),
      easeIn: read("--motion-ease-in"),
      easeStandard: read("--motion-ease-standard"),
    };
  });
}

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** Opens the first player's dossier and waits for the desk to be interactive. */
async function gotoFirstDossier(page: Page, ready = '[data-testid="role-selector"]') {
  await page.goto("/");
  await page.waitForSelector('[data-testid="player-result"]');
  const href = await page.locator('[data-testid="player-result"]').first().getAttribute("href");
  await page.goto(href ?? "/");
  await page.waitForSelector(ready);
}

// ---------------------------------------------------------------------------
// Normal motion
// ---------------------------------------------------------------------------

test.describe("Motion — normal preference", () => {
  test("exposes exactly the four duration and three easing tokens", async ({ page }) => {
    await page.goto("/");
    const t = await tokenValues(page);
    expect(t.feedback).toBe("80ms");
    expect(t.state).toBe("120ms");
    expect(t.enter).toBe("180ms");
    expect(t.exit).toBe("120ms");
    for (const ease of [t.easeOut, t.easeIn, t.easeStandard]) {
      expect(ease).toMatch(/^cubic-bezier\(/);
    }
    // Exits are shorter than their matching entrances.
    expect(parseFloat(t.exit)).toBeLessThan(parseFloat(t.enter));
    // Nothing exceeds the production ceiling.
    for (const d of [t.feedback, t.state, t.enter, t.exit]) {
      expect(parseFloat(d)).toBeLessThanOrEqual(BUDGET_MS);
    }
  });

  test("interactive feedback is explicit, bounded, and never animates outline", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');

    for (const selector of [".btn", ".ledger-row", ".input"]) {
      const t = await timings(page, selector);
      expect(t, selector).not.toBeNull();
      expect(t!.transitionProperty, selector).not.toBe("all");
      expect(t!.transitionProperty, selector).not.toContain("outline");
      expect(t!.transitionDuration.length, selector).toBeGreaterThan(0);
      for (const d of t!.transitionDuration) {
        expect(d, selector).toBeGreaterThan(0);
        expect(d, selector).toBeLessThanOrEqual(BUDGET_MS);
      }
    }
  });

  test("role tabs and evidence rows share one finite state transition", async ({ page }) => {
    await gotoFirstDossier(page);

    const tab = await timings(page, '[role="tab"]');
    expect(tab!.transitionProperty).toContain("background-color");
    expect(tab!.transitionProperty).toContain("box-shadow");
    expect(tab!.transitionProperty).not.toBe("all");
    for (const d of tab!.transitionDuration) {
      expect(d).toBe(120);
    }

    const evidence = await timings(page, '[data-testid^="evidence-group-"]');
    expect(evidence!.transitionProperty).toContain("background-color");
    expect(evidence!.transitionProperty).toContain("border-color");
    for (const d of evidence!.transitionDuration) expect(d).toBe(120);

    // The pitch zone moves on the same clock — that shared timing IS the link.
    const zone = await timings(page, ".territory-zone");
    expect(zone!.transitionProperty).toContain("background-color");
    for (const d of zone!.transitionDuration) expect(d).toBe(120);
  });

  test("no production animation is infinite and every one is within budget", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    const offenders = await page.evaluate((budget) => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const s = getComputedStyle(el);
        if (s.animationName && s.animationName !== "none") {
          if (s.animationIterationCount !== "1") {
            bad.push(`${el.className} iterations=${s.animationIterationCount}`);
          }
          for (const raw of s.animationDuration.split(",")) {
            const v = raw.trim();
            const ms = v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000;
            if (ms > budget) bad.push(`${el.className} duration=${v}`);
          }
        }
        for (const raw of s.transitionDuration.split(",")) {
          const v = raw.trim();
          if (!v) continue;
          const ms = v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000;
          if (ms > budget) bad.push(`${el.className} transition=${v}`);
        }
      }
      return bad;
    }, BUDGET_MS);
    expect(offenders).toEqual([]);
  });

  test("the role score never counts and the score bar never grows", async ({ page }) => {
    await gotoFirstDossier(page, '[data-testid="selected-role-summary"]');

    // The summary carries no animation at all: the figure is authoritative and
    // must be readable in the frame it changes.
    const summary = await timings(page, '[data-testid="selected-role-summary"]');
    expect(summary!.animationName).toBe("none");

    const tabs = page.locator('[role="tab"]');
    if ((await tabs.count()) > 1) {
      const before = await page
        .locator('[data-testid="selected-role-summary"]')
        .innerText();
      await tabs.nth(1).click();
      const after = await page.locator('[data-testid="selected-role-summary"]').innerText();
      expect(after).not.toBe(before);
      // No intermediate numeric state: the very next read is already final.
      const settled = await page.locator('[data-testid="selected-role-summary"]').innerText();
      expect(settled).toBe(after);
    }

    // Bars are data: width is inline, never transitioned.
    const bar = await timings(page, ".bg-track > div");
    if (bar) {
      expect(bar.transitionProperty).not.toContain("width");
      expect(bar.animationName).toBe("none");
    }
  });

  test("rapid role switching leaves no stale analysis and no queued animation", async ({
    page,
  }) => {
    await gotoFirstDossier(page);

    const tabs = page.locator('[role="tab"]');
    const count = await tabs.count();
    test.skip(count < 2, "needs at least two roles");

    // Hammer the selector faster than the 120ms settle.
    for (let i = 0; i < 8; i += 1) await tabs.nth(i % count).click({ delay: 0 });
    const lastIndex = 7 % count;
    const expected = (await tabs.nth(lastIndex).getAttribute("data-testid"))!;
    await expect(page.locator(`[data-testid="${expected}"]`)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // The live region reports the final role, not an earlier one.
    const roleName = (await tabs.nth(lastIndex).innerText()).split("\n")[0].trim();
    await expect(page.locator('[data-testid="role-live-region"]')).toContainText(roleName);

    // Exactly one selected tab.
    expect(await page.locator('[role="tab"][aria-selected="true"]').count()).toBe(1);
  });

  test("selected and pressed transitions keep bounding boxes stable", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');

    const favorite = page.locator('[data-testid="favorite-action"]').first();
    const compare = page.locator('[data-testid="compare-action"]').first();
    const before = { fav: await favorite.boundingBox(), cmp: await compare.boundingBox() };

    await favorite.click();
    await compare.click();
    const after = { fav: await favorite.boundingBox(), cmp: await compare.boundingBox() };

    expect(after.fav!.width).toBeCloseTo(before.fav!.width, 0);
    expect(after.fav!.height).toBeCloseTo(before.fav!.height, 0);
    expect(after.cmp!.width).toBeCloseTo(before.cmp!.width, 0);
    expect(after.cmp!.height).toBeCloseTo(before.cmp!.height, 0);

    // The heart transitions fill-opacity, never the non-interpolable `fill`.
    const heartFill = await timings(page, "path.heart-fill");
    expect(heartFill!.transitionProperty).toContain("fill-opacity");
    expect(heartFill!.transitionProperty).not.toMatch(/(^|[ ,])fill([ ,]|$)/);
  });

  test("the compare tray rises from the viewport bottom and exits faster", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await page.locator('[data-testid="compare-action"]').first().click();

    const tray = page.locator('[data-testid="compare-tray"]');
    await expect(tray).toBeVisible();

    const enter = await timings(page, '[data-testid="compare-tray"]');
    expect(enter!.animationName).toBe("sb-rise-in");
    expect(enter!.animationDuration[0]).toBe(180);
    expect(enter!.animationIterationCount).toBe("1");

    // The entrance keyframe starts below its resting position — i.e. from the
    // bottom boundary the tray is anchored to.
    const origin = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="compare-tray"]')!;
      const rules: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let list: CSSRuleList;
        try {
          list = sheet.cssRules;
        } catch {
          continue;
        }
        const walk = (rl: CSSRuleList) => {
          for (const rule of Array.from(rl)) {
            if (rule instanceof CSSKeyframesRule && rule.name === "sb-rise-in") {
              for (const kf of Array.from(rule.cssRules)) rules.push(kf.cssText);
            }
            const nested = (rule as CSSGroupingRule).cssRules;
            if (nested) walk(nested);
          }
        };
        walk(list);
      }
      void el;
      return rules.join(" ");
    });
    expect(origin).toContain("translateY(8px)");

    // Rests at its natural position — the tray must sit on the bottom edge.
    const box = (await tray.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(viewport.height - (box.y + box.height)).toBeLessThan(40);

    // Emptying the queue plays the shorter exit, then removes the tray.
    await page.locator('[data-testid="compare-action"]').first().click();
    const exit = await timings(page, '[data-testid="compare-tray"]');
    if (exit) {
      expect(exit.animationName).toBe("sb-rise-out");
      expect(exit.animationDuration[0]).toBe(120);
      expect(exit.animationDuration[0]).toBeLessThan(180);
    }
    await expect(tray).toHaveCount(0);
  });

  test("rapid compare add/remove cannot strand a ghost tray", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    const action = page.locator('[data-testid="compare-action"]').first();

    for (let i = 0; i < 7; i += 1) await action.click({ delay: 0 });
    // Odd number of clicks → queued → exactly one tray, not leaving.
    await expect(page.locator('[data-testid="compare-tray"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="compare-tray"]')).toHaveAttribute(
      "data-leaving",
      "false",
    );

    await action.click(); // back to empty
    await expect(page.locator('[data-testid="compare-tray"]')).toHaveCount(0);
  });

  test("the mobile menu drops from its header trigger and exits faster", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const toggle = page.locator('[data-testid="nav-menu-toggle"]');
    const panel = page.locator('[data-testid="nav-menu-panel"]');

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const enter = await timings(page, '[data-testid="nav-menu-panel"]');
    expect(enter!.animationName).toBe("sb-drop-in");
    expect(enter!.animationDuration[0]).toBe(180);

    // The panel settles downward out of the trigger sitting above it.
    const toggleBox = (await toggle.boundingBox())!;
    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.y).toBeGreaterThanOrEqual(toggleBox.y);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const exit = await timings(page, '[data-testid="nav-menu-panel"]');
    if (exit && exit.animationName !== "none") {
      expect(exit.animationName).toBe("sb-drop-out");
      expect(exit.animationDuration[0]).toBe(120);
      expect(exit.animationDuration[0]).toBeLessThan(180);
    }
  });

  test("the desktop navigation carries no menu motion", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const panel = await timings(page, '[data-testid="nav-menu-panel"]');
    // The motion classes are scoped below lg, so the always-present desktop nav
    // resolves to no animation at all.
    expect(panel!.animationName).toBe("none");
  });

  test("results replace as one pane and the skeleton stays static", async ({ page }) => {
    await page.route("**/api/players?**", async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await page.goto("/");

    const skeleton = page.locator('[data-testid="ledger-skeleton"]');
    await expect(skeleton).toBeVisible();
    const skeletonTiming = await timings(page, '[data-testid="ledger-skeleton"]');
    // The in-progress state is a single honest signal: no shimmer, no pulse.
    expect(skeletonTiming!.animationName).toBe("none");
    const innerAnimated = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="ledger-skeleton"]')!;
      return Array.from(root.querySelectorAll("*")).filter(
        (el) => getComputedStyle(el).animationName !== "none",
      ).length;
    });
    expect(innerAnimated).toBe(0);

    await expect(page.locator('[data-testid="results-ledger"]')).toBeVisible({ timeout: 15000 });
    const pane = await timings(page, '[data-testid="results-ledger"]');
    expect(pane!.animationName).toBe("sb-fade-in");
    expect(pane!.animationDuration[0]).toBe(180);

    // Rows carry no entrance of their own → no cascade, no stagger.
    const rowAnimations = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="result-row"]')).map(
        (el) => getComputedStyle(el).animationName,
      ),
    );
    expect(new Set(rowAnimations)).toEqual(new Set(["none"]));
  });

  test("the reported count and the visible rows never disagree", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    const readPair = async () => {
      const summary = await page.locator('[data-testid="result-count"]').innerText();
      const rows = await page.locator('[data-testid="result-row"]').count();
      return { summary, rows };
    };
    const first = await readPair();
    expect(first.rows).toBeGreaterThan(0);
    expect(first.summary).toContain("page 1");

    // Paginate: the count header and the rows share one animated ancestor, so
    // they are always committed together. Poll the *pair* rather than sleeping —
    // the invariant is that a page-2 header is never observed next to zero rows
    // (or vice versa) at any point during the replacement.
    const next = page.getByRole("button", { name: "Next" });
    if (await next.isEnabled()) {
      await next.click();
      await expect
        .poll(async () => {
          const { summary, rows } = await readPair();
          const page2 = summary.includes("page 2");
          // Any observation must be internally consistent.
          expect(rows).toBeGreaterThan(0);
          return page2;
        })
        .toBe(true);
      expect((await readPair()).rows).toBeGreaterThan(0);
    }
  });

  test("disclosures stay native and keyboard-operable with no height animation", async ({
    page,
  }) => {
    await gotoFirstDossier(page, '[data-testid="evidence-context-rail"]');

    const rail = page.locator('[data-testid="evidence-context-rail"]');
    await expect(rail).toBeVisible();
    expect(await rail.evaluate((el) => el.tagName)).toBe("DETAILS");

    const t = await timings(page, '[data-testid="evidence-context-rail"]');
    expect(t!.animationName).toBe("none");
    expect(t!.transitionProperty).not.toContain("height");

    // Native toggling still works from the keyboard.
    const summary = rail.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(rail).not.toHaveAttribute("open", /.*/);
    await page.keyboard.press("Enter");
    await expect(rail).toHaveAttribute("open", "");
  });

  test("an unknown group's zone stays hatched and never joins the fill transition", async ({
    page,
  }) => {
    // The sample cohort contains no null `group_score`, so the hatched-zone state
    // is only reachable by lightly editing the real response shape — the same
    // interception pattern the earlier cadences use for rare honesty states.
    // Without this, the "unknown zones are excluded from the transition" rule is
    // only covered by component fixtures, never by computed style on a real page.
    await page.route("**/api/players/*/ratings", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      for (const audit of body.audits ?? []) {
        const groups = audit.metric_breakdown?.groups ?? [];
        // Null the score of one spatial group, leaving the others measured, so a
        // single page carries both an unknown and a known zone.
        const spatial = groups.find((g: { key: string }) =>
          ["box_presence", "shot_threat", "progression", "defensive_contribution"].includes(g.key),
        );
        if (spatial) {
          spatial.group_score = null;
          for (const m of spatial.metrics ?? []) {
            m.present = false;
            m.score = null;
          }
        }
      }
      await route.fulfill({ response, json: body });
    });

    await gotoFirstDossier(page);
    await page.waitForSelector('[data-zone-unknown="true"]');

    const zones = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-zone-unknown]")).map((el) => {
        const s = getComputedStyle(el);
        return {
          unknown: el.dataset.zoneUnknown === "true",
          transitionProperty: s.transitionProperty,
          transitionDuration: s.transitionDuration,
          backgroundImage: s.backgroundImage,
          borderStyle: s.borderTopStyle,
          text: el.textContent ?? "",
        };
      }),
    );

    const unknown = zones.filter((z) => z.unknown);
    const known = zones.filter((z) => !z.unknown);
    expect(unknown.length).toBeGreaterThan(0);
    expect(known.length).toBeGreaterThan(0);

    for (const zone of unknown) {
      // No transition at all, so it can never appear to interpolate toward a
      // numeric fill on hover or on a role change.
      expect(zone.transitionDuration).toMatch(/^0s(, 0s)*$/);
      // It stays visibly unknown: hatched gradient, dashed border, and the word.
      expect(zone.backgroundImage).toContain("gradient");
      expect(zone.borderStyle).toBe("dashed");
      expect(zone.text.toLowerCase()).toContain("unknown");
      expect(zone.text).toContain("?");
    }
    for (const zone of known) {
      expect(zone.transitionProperty).toContain("background-color");
      expect(zone.transitionDuration).toContain("0.12s");
    }
  });

  test("route navigation snaps to the top instead of gliding the previous page", async ({
    page,
  }) => {
    await gotoFirstDossier(page, '[data-testid="role-territory"]');

    // 1 + 2: the declaration is present and the resting CSS is still smooth.
    expect(await page.evaluate(() => document.documentElement.dataset.scrollBehavior)).toBe(
      "smooth",
    );
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
    ).toBe("smooth");

    // 3: scroll substantially down a long dossier.
    const scrolled = await page.evaluate(() => {
      window.scrollTo({ top: 2000, behavior: "instant" as ScrollBehavior });
      return { y: window.scrollY, height: document.documentElement.scrollHeight };
    });
    expect(scrolled.height).toBeGreaterThan(3000);
    expect(scrolled.y).toBeGreaterThan(1000);

    // 4: a real SPA transition through ScoutBoy's own Discover link.
    await page.locator('[data-testid="nav-discover"]').click();
    await page.waitForURL((url) => url.pathname === "/");
    await page.waitForSelector('[data-testid="results-ledger"]');

    // 5: Discovery is at its intended top position — not stranded partway through
    // a smooth document scroll.
    //
    // Deliberately NOT asserting `scrollY === 0`. Next.js has two legitimate
    // resting outcomes here: a fresh push scrolls to the top of the document,
    // while a route already in the router cache restores its previous offset
    // (which puts the changed segment's own top at the viewport top, since the
    // navigation bar is a preserved layout). Both are settled positions; pinning
    // one would make this test brittle without testing anything more.
    //
    // What actually distinguishes "snapped" from "gliding" is that the position
    // has SETTLED and the new page's top content is on screen.
    const readState = () =>
      page.evaluate(() => ({
        y: window.scrollY,
        segmentTop:
          document.querySelector("#main")?.firstElementChild?.getBoundingClientRect().top ?? NaN,
      }));

    await expect
      .poll(async () => {
        const a = await readState();
        const b = await readState();
        // Stable between two reads, and the page's first content is at the top of
        // the viewport (allowing for the preserved header above it).
        return a.y === b.y && b.segmentTop >= -2 && b.segmentTop <= 120;
      })
      .toBe(true);

    // And nowhere near the 2000px we navigated away from.
    expect((await readState()).y).toBeLessThan(scrolled.y / 2);

    // 6: the resting behaviour is restored, so in-page anchors stay smooth.
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
    ).toBe("smooth");
    expect(await page.evaluate(() => document.documentElement.dataset.scrollBehavior)).toBe(
      "smooth",
    );
  });

  test("no horizontal overflow at 1280, 768, 390 and 320", async ({ page }) => {
    for (const width of [1280, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await page.waitForSelector('[data-testid="results-ledger"]');
      // With the tray present, which is the widest fixed element on the page.
      await page.locator('[data-testid="compare-action"]').first().click();
      await expect(page.locator('[data-testid="compare-tray"]')).toBeVisible();
      expect(await pageOverflow(page), `discovery @ ${width}`).toBeLessThanOrEqual(0);

      if (width < 1024) {
        await page.locator('[data-testid="nav-menu-toggle"]').click();
        expect(await pageOverflow(page), `menu open @ ${width}`).toBeLessThanOrEqual(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

test.describe("Motion — reduced preference", () => {
  // `test.use({ reducedMotion })` at describe level is not applied in this
  // setup, so the preference is emulated explicitly before every navigation —
  // exactly the API the cadence brief specifies.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("computes every duration to zero across the product", async ({ page }) => {
    for (const path of ["/", "/shortlist", "/compare", "/methodology"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const offenders = await page.evaluate(() => {
        const bad: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          const s = getComputedStyle(el);
          for (const raw of s.transitionDuration.split(",")) {
            const v = raw.trim();
            if (v && parseFloat(v) !== 0) bad.push(`${el.className} transition=${v}`);
          }
          if (s.animationName !== "none") bad.push(`${el.className} animation=${s.animationName}`);
          for (const raw of s.animationDuration.split(",")) {
            const v = raw.trim();
            if (v && parseFloat(v) !== 0) bad.push(`${el.className} animDuration=${v}`);
          }
        }
        return bad;
      });
      expect(offenders, path).toEqual([]);
    }
  });

  test("uses auto scroll behaviour, declaration notwithstanding", async ({ page }) => {
    await page.goto("/");
    // The `data-scroll-behavior` declaration is static markup, so it is present
    // here too — but it must not make the document scroll smoothly. The CSS is
    // gated on `no-preference`, so `reduce` still computes to `auto`.
    expect(await page.evaluate(() => document.documentElement.dataset.scrollBehavior)).toBe(
      "smooth",
    );
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
    ).toBe("auto");

    // And it stays `auto` after a route transition.
    await page.waitForSelector('[data-testid="results-ledger"]');
    await page.locator('[data-testid="nav-methodology"]').click();
    await page.waitForURL((url) => url.pathname === "/methodology");
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
    ).toBe("auto");
  });

  test("changes role immediately with a correct live region", async ({ page }) => {
    await gotoFirstDossier(page);

    const tabs = page.locator('[role="tab"]');
    test.skip((await tabs.count()) < 2, "needs at least two roles");

    const roleName = (await tabs.nth(1).innerText()).split("\n")[0].trim();
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-testid="role-live-region"]')).toContainText(roleName);

    // The analysis region resolves to no animation, so content is final at once.
    const evidence = await timings(page, '[data-testid="role-evidence-list"]');
    expect(evidence!.animationName).toBe("none");
  });

  test("highlights territory evidence immediately", async ({ page }) => {
    await gotoFirstDossier(page);
    const row = page.locator('[data-testid^="evidence-group-"]').first();
    await row.hover();
    // Non-motion state distinctions survive: the highlight is a class/colour
    // change, not an animation.
    await expect(row).toHaveClass(/bg-paper-muted/);
    const t = await timings(page, '[data-testid^="evidence-group-"]');
    for (const d of t!.transitionDuration) expect(d).toBe(0);
  });

  test("mounts and unmounts the compare tray with no translation", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    const action = page.locator('[data-testid="compare-action"]').first();
    const tray = page.locator('[data-testid="compare-tray"]');

    await action.click();
    await expect(tray).toBeVisible();
    // No exit class is ever applied under `reduce`.
    await expect(tray).toHaveAttribute("data-leaving", "false");
    const t = await timings(page, '[data-testid="compare-tray"]');
    expect(t!.animationName).toBe("none");
    expect(
      await tray.evaluate((el) => getComputedStyle(el).transform),
    ).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);

    // Removal is immediate — nothing waits on an animation event.
    await action.click();
    await expect(tray).toHaveCount(0);
  });

  test("opens and closes the mobile menu immediately", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const toggle = page.locator('[data-testid="nav-menu-toggle"]');
    const panel = page.locator('[data-testid="nav-menu-panel"]');

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Hidden in the same commit, with no exit class left behind.
    await expect(panel).toBeHidden();
    await expect(panel).not.toHaveClass(/nav-menu-exit/);
  });

  test("replaces results immediately and keeps focus behaviour correct", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    const pane = await timings(page, '[data-testid="results-ledger"]');
    expect(pane!.animationName).toBe("none");

    // Focus is never moved or delayed by motion logic: tabbing still reaches the
    // skip link first and the focus ring is present without a transition.
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.className ?? "");
    expect(focused).toContain("skip-link");
    expect(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        return getComputedStyle(el).transitionDuration;
      }),
    ).toMatch(/^0s(, 0s)*$/);
  });
});
