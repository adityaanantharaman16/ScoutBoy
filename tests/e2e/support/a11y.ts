import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Centralized accessibility scanning for the Milestone 7 closeout.
 *
 * Automated scanning is necessary but NOT sufficient: axe-core detects roughly a
 * third of WCAG issues in practice, and says nothing about focus order, focus
 * obscuration, reflow, target size, or whether an accessible name is *correct*
 * rather than merely present. Those are covered by the dedicated suites in
 * `accessibility.spec.ts`, `resilience.spec.ts`, and `motion.spec.ts`.
 */

/** WCAG 2.2 Level A and AA — the formal audit target for this closeout. */
export const WCAG_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * A documented, reviewed exception. Every entry must name the rule, the WCAG
 * criterion it relates to, and why suppressing it here is correct rather than
 * convenient. An empty list is the goal; the array exists so that any future
 * exception has to be written down rather than quietly added as a `.disableRules`
 * call at a single call site.
 */
export interface A11yException {
  /** axe rule id */
  rule: string;
  /** Why this is not a real failure on this surface. */
  justification: string;
}

export const REVIEWED_EXCEPTIONS: A11yException[] = [
  // Intentionally empty. See the closeout record: no rule is globally disabled.
];

export interface ScanOptions {
  /** Restrict the scan to one region (avoids re-reporting global chrome). */
  include?: string | Locator;
  /**
   * Exclude a region. Used ONLY for the deferred dark-mode pilot route, never to
   * hide a production violation. The pilot is excluded by not scanning its route
   * at all; this option exists for scoped component scans.
   */
  exclude?: string;
  /** Additional reviewed exceptions for this scan only. */
  exceptions?: A11yException[];
}

export interface Violation {
  id: string;
  impact: string;
  help: string;
  helpUrl: string;
  nodes: { target: string; html: string }[];
}

/** Runs axe and returns violations in a compact, reportable shape. */
export async function scan(page: Page, options: ScanOptions = {}): Promise<Violation[]> {
  let builder = new AxeBuilder({ page }).withTags(WCAG_AA_TAGS);

  if (options.include) {
    builder = builder.include(
      typeof options.include === "string" ? options.include : options.include,
    );
  }
  if (options.exclude) builder = builder.exclude(options.exclude);

  const results = await builder.analyze();
  const excused = new Set(
    [...REVIEWED_EXCEPTIONS, ...(options.exceptions ?? [])].map((e) => e.rule),
  );

  return results.violations
    .filter((v) => !excused.has(v.id))
    .map((v) => ({
      id: v.id,
      impact: v.impact ?? "unknown",
      help: v.help,
      helpUrl: v.helpUrl,
      nodes: v.nodes.map((n) => ({
        target: n.target.join(" "),
        html: n.html.slice(0, 200),
      })),
    }));
}

function format(label: string, violations: Violation[]): string {
  return [
    `${violations.length} accessibility violation(s) on ${label}:`,
    ...violations.map(
      (v) =>
        `\n  [${v.impact}] ${v.id} — ${v.help}\n    ${v.helpUrl}\n` +
        v.nodes.map((n) => `      ${n.target}\n        ${n.html}`).join("\n"),
    ),
  ].join("\n");
}

/**
 * Fails on serious and critical violations, and on moderate ones too — the brief
 * treats moderate as a failure unless explicitly excused. `minor` is reported in
 * the message when something else already failed, but does not fail on its own:
 * axe's minor bucket is dominated by advisory best-practice noise that is not a
 * WCAG A/AA conformance failure.
 */
export async function expectNoA11yViolations(
  page: Page,
  label: string,
  options: ScanOptions = {},
) {
  const violations = await scan(page, options);
  const blocking = violations.filter((v) =>
    ["critical", "serious", "moderate"].includes(v.impact),
  );
  expect(blocking, format(label, violations)).toEqual([]);
}

/**
 * Waits for the surface to be genuinely stable before scanning.
 *
 * Three conditions, all of which caused real false positives during this audit:
 *
 * 1. the readiness anchor exists, so we are not scanning a skeleton;
 * 2. fonts are loaded, since text metrics affect some rules;
 * 3. **no animation is still running.** This one is subtle and worth stating: the
 *    Interaction & Motion cadence fades panes and menus in over 120–180ms. An
 *    element captured mid-fade has a *blended* computed colour — the mobile menu
 *    scanned at 35% of its entrance reported `#7c857c` on `#fcfbf6` (3.68:1),
 *    a colour that exists nowhere in the palette. Scanning before motion settles
 *    therefore invents contrast failures that no user can ever see, and would
 *    have sent this audit chasing a defect that did not exist.
 */
export async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document.getAnimations().map((a) => a.finished.catch(() => undefined)),
    );
  });
}

export async function readyForScan(page: Page, anchor: string) {
  await page.waitForSelector(anchor);
  await settle(page);
}
