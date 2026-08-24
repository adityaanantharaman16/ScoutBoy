import { expect, test, type Page } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";

/**
 * Milestone 8.4B corrective pass — the empty and error states are legible in
 * their FIRST PAINTED FRAME.
 *
 * Both states used to carry `pane-enter`, whose `sb-fade-in` starts at
 * `opacity: 0`. A browser composites that opacity into the text colour, so
 * mid-fade the ink really is a blend with the paper behind it — and this
 * palette has no room for that. `--ink-soft` on `--panel` rests at 5.39:1
 * against SC 1.4.3's 4.5:1, so the blend is non-conformant from roughly 93%
 * opacity downward; the error state's red on its warm wash fails below about
 * 83%. The full E2E suite caught it as a serious `color-contrast` violation on
 * `.pane-enter > span` — "Pick two players to compare." — whenever the axe scan
 * landed while the fade was still running.
 *
 * These tests therefore do NOT wait for animations to settle. Scanning after a
 * settle would only prove the resting state, which was never in doubt, and
 * would leave the defect the suite actually hit uncovered. Instead:
 *
 * - the axe scan runs as soon as the empty state exists, and
 * - a frame-by-frame probe, installed BEFORE any application script runs,
 *   records the effective contrast of the message from the frame it first
 *   appears.
 *
 * The probe is what makes this deterministic. An axe scan samples ONE moment, so
 * against a 180ms fade it is a coin toss - which is exactly how the defect
 * reached a release gate in the first place, passing locally and failing in the
 * full suite. The probe fails on any frame below AA, so a re-introduced fade is
 * caught every run rather than eventually. Verified by re-applying the removed
 * animation: the probe observed opacity 0 at 1.00:1 while the scan in the same
 * run happened to land after the fade and reported nothing.
 */

/** WCAG 2.2 SC 1.4.3 for normal-size text. */
const AA_NORMAL_TEXT = 4.5;

/** How many frames the probe watches after the state first appears. */
const PROBE_FRAMES = 40;

interface ContrastProbe {
  done: boolean;
  samples: number;
  minRatio: number;
  maxRatio: number;
  minOpacity: number;
  animationNames: string[];
}

/**
 * Watches a text-bearing pane from the frame it is inserted.
 *
 * Runs as an init script, so the sampling loop is already going before React
 * hydrates and the state mounts — there is no window in which the entrance
 * could happen unobserved.
 *
 * The blend model is the browser's own: a subtree with `opacity: o` is painted
 * to a layer and composited over what is behind it, so at a text pixel the
 * final colour is `page + o * (ink - page)` and at a neighbouring background
 * pixel it is `page + o * (panel - page)`. Contrast is measured between those
 * two, which is what an automated scan reports and what a reader actually sees.
 */
async function installContrastProbe(page: Page, selector: string) {
  await page.addInitScript(
    ({ sel, frames }) => {
      const parse = (value: string): [number, number, number] => {
        const parts = (value.match(/[\d.]+/g) ?? ["0", "0", "0"]).map(Number);
        return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
      };
      const luminance = ([r, g, b]: [number, number, number]) => {
        const channel = (c: number) => {
          const s = c / 255;
          return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const ratio = (a: [number, number, number], b: [number, number, number]) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const over = (
        top: [number, number, number],
        under: [number, number, number],
        alpha: number,
      ): [number, number, number] => [
        under[0] + alpha * (top[0] - under[0]),
        under[1] + alpha * (top[1] - under[1]),
        under[2] + alpha * (top[2] - under[2]),
      ];

      const probe = {
        done: false,
        samples: 0,
        minRatio: Number.POSITIVE_INFINITY,
        maxRatio: 0,
        minOpacity: 1,
        animationNames: [] as string[],
      };
      (window as unknown as Record<string, unknown>).__contrastProbe = probe;

      let remaining = frames;
      const tick = () => {
        const pane = document.querySelector(sel);
        const text = pane?.querySelector("span");
        if (pane && text) {
          const paneStyle = getComputedStyle(pane);
          if (!probe.animationNames.includes(paneStyle.animationName)) {
            probe.animationNames.push(paneStyle.animationName);
          }

          // Every opacity between the text and the page multiplies.
          let alpha = 1;
          let node: HTMLElement | null = text as HTMLElement;
          while (node && node !== document.documentElement) {
            alpha *= parseFloat(getComputedStyle(node).opacity || "1");
            node = node.parentElement;
          }

          const page = parse(getComputedStyle(document.body).backgroundColor);
          const ink = parse(getComputedStyle(text).color);
          const panel = parse(paneStyle.backgroundColor);
          const value = ratio(over(ink, page, alpha), over(panel, page, alpha));

          probe.samples += 1;
          probe.minRatio = Math.min(probe.minRatio, value);
          probe.maxRatio = Math.max(probe.maxRatio, value);
          probe.minOpacity = Math.min(probe.minOpacity, alpha);
          remaining -= 1;
          if (remaining <= 0) {
            probe.done = true;
            return;
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { sel: selector, frames: PROBE_FRAMES },
  );
}

async function readProbe(page: Page): Promise<ContrastProbe> {
  await page.waitForFunction(
    () => (window as unknown as { __contrastProbe?: ContrastProbe }).__contrastProbe?.done === true,
  );
  return page.evaluate(
    () => (window as unknown as { __contrastProbe: ContrastProbe }).__contrastProbe,
  );
}

/** The computed presentation an approved resting state must still have. */
async function restingPresentation(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const pane = document.querySelector(sel) as HTMLElement;
    const text = pane.querySelector("span") as HTMLElement;
    const paneStyle = getComputedStyle(pane);
    const textStyle = getComputedStyle(text);
    return {
      classes: pane.className.split(/\s+/).filter(Boolean),
      color: textStyle.color,
      background: paneStyle.backgroundColor,
      borderRadius: paneStyle.borderRadius,
      borderWidth: paneStyle.borderTopWidth,
      textAlign: paneStyle.textAlign,
      fontSize: paneStyle.fontSize,
      padding: `${paneStyle.paddingTop} ${paneStyle.paddingLeft}`,
      opacity: paneStyle.opacity,
      animationName: paneStyle.animationName,
      role: pane.getAttribute("role"),
      text: (text.textContent ?? "").trim(),
    };
  }, selector);
}

/**
 * The id of the first real player the comparison selectors offer.
 *
 * Waits for the option list itself rather than for the `<select>` element: the
 * selectors render before the player index resolves, so reading them on
 * appearance returned an empty value on a fast machine.
 */
async function firstPlayerId(page: Page): Promise<string> {
  await page.goto("/compare");
  await page.waitForFunction(() => {
    const select = document.querySelector('[data-testid="compare-a"]') as HTMLSelectElement | null;
    return select !== null && select.options.length > 1;
  });
  const id = await page.evaluate(() => {
    const select = document.querySelector('[data-testid="compare-a"]') as HTMLSelectElement;
    return Array.from(select.options).find((option) => option.value !== "")?.value ?? "";
  });
  expect(id).not.toBe("");
  return id;
}

/** Waits only for text metrics — never for motion. */
async function fontsOnly(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

test.describe("The empty comparison state is legible from its first frame", () => {
  test("passes axe as soon as it exists, with no wait for an entrance", async ({ page }) => {
    await installContrastProbe(page, '[data-testid="empty-state"]');
    await page.goto("/compare");

    // The readiness condition is the state itself. Deliberately NO `settle()`,
    // no sleep and no animation wait: if an entrance can make this text
    // non-conformant, the scan must be able to catch it.
    await page.waitForSelector('[data-testid="empty-state"]');
    await fontsOnly(page);
    await expect(page.locator('[data-testid="empty-state"]')).toContainText(
      "Pick two players to compare.",
    );
    await expectNoA11yViolations(page, "empty comparison, scanned on arrival");
  });

  test("never dips below AA at any frame of its arrival", async ({ page }) => {
    await installContrastProbe(page, '[data-testid="empty-state"]');
    await page.goto("/compare");
    await page.waitForSelector('[data-testid="empty-state"]');

    const probe = await readProbe(page);
    expect(probe.samples).toBe(PROBE_FRAMES);
    // The message is never composited at partial opacity, so its contrast is a
    // constant rather than a curve — which is exactly what makes a scan at any
    // moment reliable.
    expect(probe.minOpacity).toBe(1);
    expect(probe.animationNames).toEqual(["none"]);
    expect(probe.minRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(probe.minRatio).toBeCloseTo(probe.maxRatio, 5);
  });

  test("keeps the approved resting presentation exactly as it was", async ({ page }) => {
    await page.goto("/compare");
    await page.waitForSelector('[data-testid="empty-state"]');
    const state = await restingPresentation(page, '[data-testid="empty-state"]');

    expect(state.text).toBe("Pick two players to compare.");
    expect(state.role).toBe("status");
    // `text-ink-soft` on `bg-paper-panel`, 14px, centred, 1px hairline border,
    // py-10 / px-4 — the audited appearance, unchanged.
    expect(state.color).toBe("rgb(95, 107, 97)");
    expect(state.background).toBe("rgb(252, 251, 246)");
    expect(state.fontSize).toBe("14px");
    expect(state.textAlign).toBe("center");
    expect(state.borderWidth).toBe("1px");
    expect(state.padding).toBe("40px 16px");
    // Sharp, rectangular, 90 degrees.
    expect(state.borderRadius).toBe("0px");
    expect(state.opacity).toBe("1");
    for (const cls of ["border-line", "bg-paper-panel", "text-ink-soft", "text-center"]) {
      expect(state.classes).toContain(cls);
    }
    expect(state.classes.join(" ")).not.toMatch(/rounded/);
  });

  test("is immediate and correct under prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installContrastProbe(page, '[data-testid="empty-state"]');
    await page.goto("/compare");
    await page.waitForSelector('[data-testid="empty-state"]');

    const probe = await readProbe(page);
    expect(probe.animationNames).toEqual(["none"]);
    expect(probe.minOpacity).toBe(1);
    expect(probe.minRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);

    // Identical to the normal-preference resting state: the correction removed
    // an entrance rather than adding a second appearance to maintain.
    const state = await restingPresentation(page, '[data-testid="empty-state"]');
    expect(state.color).toBe("rgb(95, 107, 97)");
    expect(state.background).toBe("rgb(252, 251, 246)");
    expect(state.borderRadius).toBe("0px");
    await fontsOnly(page);
    await expectNoA11yViolations(page, "empty comparison under reduced motion");
  });
});

test.describe("The comparison error state shares the correction", () => {
  test("passes axe on arrival and never fades its own text", async ({ page }) => {
    const id = await firstPlayerId(page);
    // Installed AFTER the lookup navigation and BEFORE the one under test, so the
    // probe starts on a fresh document and the error state is present from the
    // page's first render rather than arriving on a later interaction.
    await installContrastProbe(page, '[data-testid="error-state"]');
    await page.goto(`/compare?a=${id}&b=${id}`);
    await page.waitForSelector('[data-testid="error-state"]');

    const probe = await readProbe(page);
    expect(probe.animationNames).toEqual(["none"]);
    expect(probe.minOpacity).toBe(1);
    // Red on the warm caution wash rests at ~6.2:1 and fell below AA under about
    // 83% opacity, so the sibling state carried the identical defect.
    expect(probe.minRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(probe.minRatio).toBeCloseTo(probe.maxRatio, 5);

    await fontsOnly(page);
    await expectNoA11yViolations(page, "comparison error, scanned on arrival");
  });

  test("keeps its approved resting presentation and square geometry", async ({ page }) => {
    const id = await firstPlayerId(page);
    await page.goto(`/compare?a=${id}&b=${id}`);
    await page.waitForSelector('[data-testid="error-state"]');
    const state = await restingPresentation(page, '[data-testid="error-state"]');
    expect(state.role).toBe("alert");
    expect(state.background).toBe("rgb(244, 232, 227)");
    expect(state.color).toBe("rgb(156, 46, 34)");
    expect(state.borderRadius).toBe("0px");
    expect(state.opacity).toBe("1");
    expect(state.classes.join(" ")).not.toMatch(/rounded/);
    await expect(page.locator('[data-testid="error-state"]')).toContainText(
      "Choose two different players.",
    );
  });
});

test.describe("Neither state disturbs the layout at the narrowest supported width", () => {
  const overflow = (page: Page) =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

  test("the empty comparison adds no horizontal overflow at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/compare");
    await page.waitForSelector('[data-testid="empty-state"]');
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });

  test("the comparison error adds no horizontal overflow at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    const id = await firstPlayerId(page);
    await page.goto(`/compare?a=${id}&b=${id}`);
    await page.waitForSelector('[data-testid="error-state"]');
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });

  test("the Discovery empty state is square and legible on arrival too", async ({ page }) => {
    // The same shared component, reached through a different surface: whatever is
    // true of the comparison message has to be true wherever it is used.
    await page.route("**/api/players?**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 12, total_pages: 1 }),
      }),
    );
    await installContrastProbe(page, '[data-testid="empty-state"]');
    await page.goto("/");
    await page.waitForSelector('[data-testid="empty-state"]');

    const probe = await readProbe(page);
    expect(probe.animationNames).toEqual(["none"]);
    expect(probe.minRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);

    const state = await restingPresentation(page, '[data-testid="empty-state"]');
    expect(state.borderRadius).toBe("0px");
    await fontsOnly(page);
    await expectNoA11yViolations(page, "Discovery empty state, scanned on arrival");
  });
});
