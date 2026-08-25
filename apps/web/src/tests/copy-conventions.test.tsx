import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Sitewide punctuation + title conventions
// ---------------------------------------------------------------------------
// Two guarantees, enforced at source level so they cannot regress into a route:
//   1. no U+2014 em dash appears in user-visible production copy; and
//   2. every route's browser title separates its parts with a plain " - ".
//
// Comments and JSDoc are deliberately exempt: the requirement is runtime
// presentation and active source-of-truth content, not the repository's prose. The
// runtime counterpart of (1) — which also covers API-generated copy the frontend
// renders — lives in `tests/e2e/copy-conventions.spec.ts`, where every production
// route is loaded and its rendered text is scanned.

const EM_DASH = "—";
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Tests are not shipped; the pilot route IS reachable and is therefore included. */
const EXCLUDED = ["tests"];

function productionFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(SRC, full);
    if (EXCLUDED.some((d) => rel === d || rel.startsWith(d + sep))) continue;
    if (entry.isDirectory()) out.push(...productionFiles(full));
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Blanks comments while preserving line structure, so reported lines stay real. */
function stripComments(source: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(?<!:)\/\/[^\n]*/g, blank);
}

describe("No em dash in user-visible production copy", () => {
  it("leaves no U+2014 in any production source file, comments excluded", () => {
    const offenders: string[] = [];
    for (const file of productionFiles()) {
      const raw = readFileSync(file, "utf8");
      const lines = raw.split("\n");
      stripComments(raw)
        .split("\n")
        .forEach((line, i) => {
          if (line.includes(EM_DASH)) offenders.push(`${relative(SRC, file)}:${i + 1}: ${lines[i].trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the missing-value sentinel a plain hyphen everywhere it is declared", () => {
    const formatters = readFileSync(join(SRC, "lib", "formatters", "index.ts"), "utf8");
    expect(formatters).toContain('if (value == null) return "-";');
    expect(formatters).toContain('if (score == null) return "-";');
    expect(stripComments(formatters)).not.toContain(EM_DASH);
  });

  it("preserves punctuation that is not an em dash", () => {
    // The market range keeps its en dash: only U+2014 was in scope, and a range
    // separator is not one.
    const market = stripComments(readFileSync(join(SRC, "lib", "market", "marketChart.ts"), "utf8"));
    expect(market).toContain("–");
    expect(market).not.toContain(EM_DASH);
  });
});

// ---------------------------------------------------------------------------
// Route titles
// ---------------------------------------------------------------------------
// Read as source rather than imported: the root layout pulls in global CSS and a
// font stylesheet, which a jsdom unit run has no reason to evaluate.
const TITLE_FILES: Array<[string, string]> = [
  ["app/layout.tsx", "ScoutBoy - Player Discovery"],
  ["app/not-found.tsx", "Page Not Found - ScoutBoy"],
  ["app/compare/layout.tsx", "Compare Players - ScoutBoy"],
  ["app/methodology/layout.tsx", "Methodology - ScoutBoy"],
  ["app/players/[playerId]/layout.tsx", "Player Dossier - ScoutBoy"],
  ["app/roles/[roleId]/layout.tsx", "Role Leaderboard - ScoutBoy"],
  ["app/shortlist/layout.tsx", "My Favorites - ScoutBoy"],
  ["app/saved/layout.tsx", "Saved - ScoutBoy"],
  ["app/design-pilots/dark-mode/page.tsx", "Dark Mode Pilot - ScoutBoy (for visual approval)"],
];

function declaredTitle(relPath: string): string {
  const source = readFileSync(join(SRC, relPath), "utf8");
  const match = /title:\s*"([^"]+)"/.exec(source);
  expect(match, `no metadata title found in ${relPath}`).not.toBeNull();
  return match![1];
}

describe("Production route titles", () => {
  it.each(TITLE_FILES)("%s declares %s", (relPath, expected) => {
    expect(declaredTitle(relPath)).toBe(expected);
  });

  it("uses a plain hyphen separator in every title and no em dash", () => {
    for (const [relPath] of TITLE_FILES) {
      const title = declaredTitle(relPath);
      expect(title, relPath).toContain(" - ");
      expect(title, relPath).not.toContain(EM_DASH);
    }
  });

  it("keeps every route title distinct, so no surface reports another's", () => {
    const titles = TITLE_FILES.map(([relPath]) => declaredTitle(relPath));
    expect(new Set(titles).size).toBe(titles.length);
  });
});


// ---------------------------------------------------------------------------
// Title Case action labels
//
// Every VISIBLE button and link label on the optional-account, saved-work and
// comparison-tray surfaces capitalizes each word. Descriptions, notices, error
// messages and headings are deliberately NOT covered: they are prose, and title
// casing them would be a different (and wrong) rule.
// ---------------------------------------------------------------------------

/** `file → the exact visible label strings it must render.` */
const TITLE_CASE_ACTIONS: Array<[string, string[]]> = [
  ["components/saved/SaveViewControl.tsx", ["Save View", "Saved View", "Rename View"]],
  [
    "components/saved/SaveComparisonControl.tsx",
    ["Save Comparison", "Saved Comparison", "Rename Comparison"],
  ],
  ["components/saved/ViewsPanel.tsx", ["Try Again", "Go To Discovery", "Rename View"]],
  [
    "components/saved/ComparisonsPanel.tsx",
    ["Try Again", "Go To Compare", "Rename Comparison"],
  ],
  ["components/saved/FavoritesPanel.tsx", ["Try Again", "Go To Discovery"]],
  ["components/account/AccountSuggestion.tsx", ["Create Account", "Sign In", "Not Now"]],
  ["components/common/NavBar.tsx", ["Sign In", "Sign Out"]],
  ["components/common/PlayerActions.tsx", ["Open Comparison"]],
  // Milestone 8.5 renamed these after the concepts they act on. They are visible
  // button/link labels, so they take the same Title Case rule.
  ["app/not-found.tsx", ["Back To Discovery", "Read The Methodology"]],
  ["app/players/[playerId]/page.tsx", ["Back To Discovery"]],
  ["components/player/RoleRatingsPanel.tsx", ["View Leaderboard"]],
];

/**
 * The lower-case spellings these labels used to carry.
 *
 * Asserted as ABSENT from rendered strings so a future edit cannot quietly
 * reintroduce one. Checked against comment-stripped source, because the prose
 * above a control legitimately discusses it in a sentence.
 */
const RETIRED_ACTION_SPELLINGS = [
  "Back to discover",
  "Read the methodology",
  "View leaderboard",
  "Save view",
  "Saved view",
  "Save comparison",
  "Saved comparison",
  "Rename view",
  "Rename comparison",
  "Try again",
  "Go to discovery",
  "Go to compare",
  "Create account",
  "Not now",
  "Open comparison",
];

/** Strips block and line comments so documentation prose is never scanned. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Title Case action labels", () => {
  it.each(TITLE_CASE_ACTIONS)("%s renders %s", (relPath, labels) => {
    const source = readFileSync(join(SRC, relPath), "utf8");
    for (const label of labels) {
      expect(source, `${relPath} must render "${label}"`).toContain(label);
    }
  });

  it("no longer carries any retired lower-case action spelling", () => {
    const offenders: string[] = [];
    for (const [relPath] of TITLE_CASE_ACTIONS) {
      const body = withoutComments(readFileSync(join(SRC, relPath), "utf8"));
      for (const retired of RETIRED_ACTION_SPELLINGS) {
        if (body.includes(retired)) offenders.push(`${relPath}: ${retired}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("leaves prose alone: a sentence is still a sentence", () => {
    // "Try again in a moment." is a message, not a control, and must stay in
    // sentence case. Title-casing it would be the over-application this rule
    // exists to avoid.
    const state = readFileSync(join(SRC, "lib/state/saved-work.tsx"), "utf8");
    expect(state).toContain("Try again in a moment.");
    expect(state).not.toContain("Try Again in a moment.");
  });

  it("keeps accepted one-word labels unchanged", () => {
    const panel = readFileSync(join(SRC, "components/saved/NamePanel.tsx"), "utf8");
    for (const single of ["Remove", "Confirm", "Cancel"]) {
      // The label on its own JSX text line. Matched per line rather than by exact
      // surrounding whitespace, because this checkout stores CRLF.
      expect(panel, `NamePanel must still render "${single}"`).toMatch(
        new RegExp(`^\\s*${single}\\s*$`, "m"),
      );
    }
    const nav = readFileSync(join(SRC, "components/common/NavBar.tsx"), "utf8");
    expect(nav).toContain('label: "Saved"');
    expect(nav).toContain("<span>Menu</span>");
  });
});

describe("Label in Name (WCAG 2.2 SC 2.5.3)", () => {
  /**
   * A control's accessible name must CONTAIN its visible label, so somebody
   * saying "Save View" out loud addresses the thing they can see. The two save
   * triggers failed this even before Title Case ("Save this Discovery view"
   * never contained "Save view"), so this locks in the corrected form.
   */
  it.each([
    ["components/saved/SaveViewControl.tsx", ["Save View:", "Saved View:"]],
    ["components/saved/SaveComparisonControl.tsx", ["Save Comparison:", "Saved Comparison:"]],
  ])("%s prefixes its accessible name with the visible label", (relPath, prefixes) => {
    const source = readFileSync(join(SRC, relPath), "utf8");
    for (const prefix of prefixes) {
      expect(source, `${relPath} accessible name must start with "${prefix}"`).toContain(prefix);
    }
  });

  it("names the confirm-remove Cancel action after its visible label", () => {
    const panel = readFileSync(join(SRC, "components/saved/NamePanel.tsx"), "utf8");
    expect(panel).toContain("Cancel removing ${what}");
    // The previous "Keep X" shared no words with the visible "Cancel".
    expect(panel).not.toContain("`Keep ${what}`");
  });
});
