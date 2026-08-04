import type { Page } from "@playwright/test";

/**
 * The production-surface inventory, in executable form.
 *
 * Phase 1 of the closeout enumerated every production surface with its landmark,
 * heading, keyboard entry point, readiness anchor and degraded variants. Rather
 * than keeping that list only in prose, it lives here so every audit suite
 * (accessibility, keyboard, reflow, resilience, visual) iterates the SAME set and
 * cannot silently drift out of sync with the documented inventory.
 */

export interface Surface {
  /** Stable id, also used in screenshot names. */
  id: string;
  /** Human label for failure messages and the closeout record. */
  label: string;
  path: string;
  /** Selector that proves the surface has finished rendering real data. */
  ready: string;
  /** The expected accessible page heading (h1) text, or null where the surface has none of its own. */
  heading?: string | RegExp;
  /** Extra interaction required to reach the state under audit. */
  setup?: (page: Page) => Promise<void>;
}

/** Every viewport the reflow / zoom audit iterates. */
export const VIEWPORTS = [
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "laptop-1024", width: 1024, height: 800 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "zoom-640", width: 640, height: 720 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "narrow-320", width: 320, height: 720 },
] as const;

/** Opens the first player's dossier; returns its href. */
export async function gotoFirstDossier(page: Page, ready = '[data-testid="role-selector"]') {
  await page.goto("/");
  await page.waitForSelector('[data-testid="player-result"]');
  const href = await page.locator('[data-testid="player-result"]').first().getAttribute("href");
  await page.goto(href ?? "/");
  await page.waitForSelector(ready);
  return href ?? "/";
}

/** Seeds two players into the compare queue and the favourites list. */
export async function seedDeviceState(page: Page) {
  await page.goto("/");
  await page.waitForSelector('[data-testid="result-row"]');
  await page.locator('[data-testid="favorite-action"]').first().click();
  await page.locator('[data-testid="favorite-action"]').nth(1).click();
  await page.locator('[data-testid="compare-action"]').first().click();
  await page.locator('[data-testid="compare-action"]').nth(1).click();
}

/**
 * The healthy production surfaces. Degraded/honesty variants live in
 * `resilience.spec.ts`, which owns their response interception.
 */
export const SURFACES: Surface[] = [
  {
    id: "discovery",
    label: "Discovery",
    path: "/",
    ready: '[data-testid="results-ledger"]',
    heading: "Discover players",
  },
  {
    id: "leaderboard",
    label: "Role leaderboard",
    path: "/roles/touchline_winger",
    ready: '[data-testid="leaderboard-table"], [data-testid="leaderboard-ledger"]',
  },
  {
    id: "compare-selection",
    label: "Compare selection",
    path: "/compare",
    ready: '[data-testid="compare-a"]',
  },
  {
    id: "favorites",
    label: "My Favorites",
    path: "/shortlist",
    ready: "h1",
  },
  {
    id: "methodology",
    label: "Methodology",
    path: "/methodology",
    ready: '[data-testid="methodology-contents"]',
  },
];
