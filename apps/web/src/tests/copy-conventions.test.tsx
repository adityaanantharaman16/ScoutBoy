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
