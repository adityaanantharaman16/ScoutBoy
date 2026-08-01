import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  EmptyState,
  ErrorState,
  LedgerSkeleton,
  Notice,
  ScopeBanner,
} from "@/components/common";
import { NavBar } from "@/components/common/NavBar";
import {
  CompareTray,
  PlayerActionRail,
  PlayerActionRow,
  SavedPlayerActionRail,
} from "@/components/common/PlayerActions";
import { PlayerCompareTable } from "@/components/compare/PlayerCompareTable";
import { RoleSelector } from "@/components/player/RoleSelector";
import { RoleTerritory } from "@/components/player/RoleTerritory";
import { PlayerSearchFilters } from "@/components/search/PlayerSearchFilters";
import { ResultCard } from "@/components/search/PlayerSearchResults";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";
import type {
  AuditGroupView,
  CompareResponse,
  CompareSide,
  PlayerSearchCard,
  RoleRatingSummary,
} from "@/lib/api/types";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

// ---------------------------------------------------------------------------
// Source-level regression scan
//
// The production UI is literally 90 degrees. Rather than a blanket
// `* { border-radius: 0 !important }` — which would also flatten meaningful
// illustration geometry and the deferred dark-mode pilot — the rule is expressed
// as: shared primitives declare `border-radius: 0`, and NO other production
// source carries a positive rectangular radius. This test enforces that
// invariant so a future `rounded-lg` cannot quietly reappear.
//
// It deliberately:
//   * strips comments first, so prose like "~4 rounded ticks" is not a hit;
//   * skips `src/tests/**` and the deferred `src/app/design-pilots/**` pilot;
//   * looks only at radius declarations, so SVG `<circle r>` / arc `d` geometry
//     is never flagged;
//   * allows exactly one documented exception, `.rail-box-discovery`.
// ---------------------------------------------------------------------------

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const GLOBALS = join(SRC, "app", "globals.css");
const EXCLUDED_DIRS = ["tests", join("app", "design-pilots")];

function productionFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(SRC, full);
    if (EXCLUDED_DIRS.some((d) => rel === d || rel.startsWith(d + sep))) continue;
    if (entry.isDirectory()) out.push(...productionFiles(full));
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Remove block and line comments so documentation prose is never scanned. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    // `(^|[^:])` keeps protocol-relative and `http://` URLs intact.
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ZERO = /^0(px|rem|em|%)?$/;
/** A Tailwind radius utility token — `rounded`, `rounded-sm`, `rounded-[3px]`… */
const ROUNDED_TOKEN = /(?<![\w-])rounded(?:-[a-z0-9[\]().%/-]+)?(?![\w-])/g;

function scanViolations(source: string, label: string): string[] {
  const found: string[] = [];
  const body = stripComments(source);

  for (const m of body.matchAll(/border-radius\s*:\s*([^;{}]+)/g)) {
    if (!ZERO.test(m[1].trim())) found.push(`${label}: border-radius: ${m[1].trim()}`);
  }
  for (const m of body.matchAll(/borderRadius\s*:\s*([^,\n}]+)/g)) {
    if (!ZERO.test(m[1].trim().replace(/["']/g, ""))) {
      found.push(`${label}: borderRadius: ${m[1].trim()}`);
    }
  }
  for (const m of body.matchAll(ROUNDED_TOKEN)) {
    if (m[0] !== "rounded-none") found.push(`${label}: ${m[0]}`);
  }
  return found;
}

/** The `.rail-box-discovery { … }` rule, lifted out so it can be asserted alone. */
function discoveryExceptionBlock(css: string): string | null {
  return /\.rail-box-discovery\s*\{[^}]*\}/.exec(css)?.[0] ?? null;
}

describe("Sharp-corner production system — source scan", () => {
  it("declares a zero radius on every shared production primitive", () => {
    const css = stripComments(readFileSync(GLOBALS, "utf8"));
    for (const selector of [
      ".card",
      ".display-tag",
      ".input",
      ".btn",
      ".table-shell",
      ".rail-box",
      ".territory-surface",
    ]) {
      const rule = new RegExp(`\\${selector}\\s*\\{[^}]*\\}`).exec(css)?.[0];
      expect(rule, `${selector} rule missing`).toBeTruthy();
      expect(rule, `${selector} must declare a zero radius`).toMatch(/border-radius:\s*0;/);
    }
  });

  it("carries no positive rectangular radius anywhere in production source", () => {
    const violations: string[] = [];
    for (const file of productionFiles()) {
      let source = readFileSync(file, "utf8");
      if (file === GLOBALS) {
        const block = discoveryExceptionBlock(source);
        // Asserted separately below; removed here so it is the ONLY thing that
        // can ever be excused from the scan.
        if (block) source = source.replace(block, "");
      }
      violations.push(...scanViolations(source, relative(SRC, file)));
    }
    expect(violations).toEqual([]);
  });

  it("documents the Discovery action rail as the single rectangular exception", () => {
    const css = readFileSync(GLOBALS, "utf8");
    const block = discoveryExceptionBlock(css);
    expect(block).toBeTruthy();
    expect(block).toMatch(/border-radius:\s*2px;/);

    // The modifier exists only on the Discovery rail — My Favorites shares the
    // component but not the exception.
    const users = productionFiles().filter(
      (f) => f !== GLOBALS && readFileSync(f, "utf8").includes("rail-box-discovery"),
    );
    expect(users.map((f) => relative(SRC, f))).toEqual([
      join("components", "common", "PlayerActions.tsx"),
    ]);
  });

  it("leaves the deferred dark-mode pilot out of the migration", () => {
    const pilotDir = join(SRC, "app", "design-pilots");
    expect(productionFiles().some((f) => f.startsWith(pilotDir))).toBe(false);
    // …and the pilot still exists, untouched by this pass.
    expect(readdirSync(pilotDir).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Rendered-DOM audit
// ---------------------------------------------------------------------------

const ROUNDED_CLASS = /(?:^|\s)rounded(?:-[a-z0-9[\]().%/-]+)?(?=\s|$)/;

/** Every element in the tree carrying a rounded utility or a positive radius. */
function roundedOffenders(root: HTMLElement): string[] {
  const out: string[] = [];
  for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
    const cls = el.getAttribute("class") ?? "";
    if (ROUNDED_CLASS.test(cls) && !cls.includes("rounded-none")) out.push(`class="${cls}"`);
    const inline = el.getAttribute("style") ?? "";
    const radius = /border-radius:\s*([^;]+)/.exec(inline);
    if (radius && !ZERO.test(radius[1].trim())) out.push(`style="${inline}"`);
  }
  return out;
}

function searchCard(over: Partial<PlayerSearchCard> = {}): PlayerSearchCard {
  return {
    id: 1,
    canonical_name: "Anton Keller",
    season: "2023/24",
    age: 21,
    club: "Stuttgart",
    league: "Bundesliga",
    primary_position: "CF",
    position_group: "ATT",
    best_role: "shadow_striker",
    best_role_display: "Shadow Striker",
    best_role_score: 88.4,
    confidence: "high",
    analysis_status: "analyzed",
    evidence_status: "high_coverage",
    has_rolefit_analysis: true,
    is_high_coverage: true,
    top_playstyles: ["Technical Carrier"],
    minutes: 1800,
    represented_minutes: 1800,
    market_label: "inflated",
    expected_asking_low_eur: 58_500_000,
    expected_asking_high_eur: 87_800_000,
    ...over,
  } as PlayerSearchCard;
}

function rating(role: string, display: string, score: number, isBest = false): RoleRatingSummary {
  return {
    role_key: role,
    display_name: display,
    final_score: score,
    raw_score: score,
    context_adjusted_score: score,
    confidence: "high",
    rank_in_peer_group: 1,
    is_best: isBest,
  } as unknown as RoleRatingSummary;
}

const GROUPS: AuditGroupView[] = [
  {
    key: "box_presence",
    weight: 0.3,
    normalized_weight: 0.3,
    group_score: 94,
    metrics: [{ display: "Touches in box", score: 94, present: true }],
  },
  {
    key: "finishing_confidence",
    weight: 0.1,
    normalized_weight: 0.1,
    group_score: null,
    metrics: [{ display: "Missing metric", score: null, present: false }],
  },
] as unknown as AuditGroupView[];

function compareSide(name: string, score: number): CompareSide {
  return {
    identity: { id: 1, canonical_name: name, club: "Club", league: "League", secondary_positions: [] },
    role_ratings: [rating("shadow_striker", "Shadow Striker", score, true)],
    substats: [],
    playstyles: [
      {
        playstyle_key: "box_crasher",
        display_name: "Box Crasher",
        category: "attack",
        tier: null,
        confidence: "high",
        is_concern: false,
        why_applied: {},
        supporting_metrics: [],
      },
    ],
    market: {
      label: "fair",
      expected_asking_low_eur: 1_000_000,
      expected_asking_high_eur: 2_000_000,
      confidence: "high",
      manual_review_required: false,
      explanation: {},
    },
    context: null,
    confidence: "low",
  } as unknown as CompareSide;
}

const COMPARE: CompareResponse = {
  season: "2023/24",
  role_key: "shadow_striker",
  role_display: "Shadow Striker",
  player_a: compareSide("Anton Keller", 88),
  player_b: compareSide("Jack Whitmore", 54),
  stat_rows: [
    {
      metric: "np_xg",
      display: "Non-penalty xG",
      unit: "per90",
      a_per90: 0.5,
      a_percentile: 0.9,
      a_score: 90,
      b_per90: 0.2,
      b_percentile: 0.4,
      b_score: 40,
    },
  ],
  role_comparison: {},
  why_higher: "Anton Keller rates higher as Shadow Striker.",
  confidence_warnings: ["Player 1 (Anton Keller) has low confidence — interpret with caution."],
} as unknown as CompareResponse;

function wrapped(ui: React.ReactNode) {
  return render(<ScoutingStateProvider>{ui}</ScoutingStateProvider>);
}

describe("Sharp-corner production system — rendered surfaces", () => {
  it("renders discovery filters, ledger rows and pagination with no rounded box", () => {
    const filters = wrapped(
      <PlayerSearchFilters
        filters={{ scope: "analyzed", age_band: "all", sort: "rolefit_desc", page: 1 }}
        onChange={() => {}}
      />,
    );
    expect(roundedOffenders(filters.container)).toEqual([]);

    const row = wrapped(<ResultCard p={searchCard()} />);
    expect(roundedOffenders(row.container)).toEqual([]);
  });

  it("renders empty, loading, error and banner states square", () => {
    for (const ui of [
      <ScopeBanner key="b" text="Prototype scope." />,
      <EmptyState key="e" label="No players match these filters." />,
      <ErrorState key="x" message="Failed to load players." />,
      <LedgerSkeleton key="s" rows={2} />,
      <Notice key="n" title="Confidence warning" tone="caution">
        Interpret with caution.
      </Notice>,
    ]) {
      const { container } = render(ui);
      expect(roundedOffenders(container)).toEqual([]);
    }
  });

  it("renders role-selector tabs and evidence-group buttons square", () => {
    const tabs = render(
      <RoleSelector
        ratings={[
          rating("shadow_striker", "Shadow Striker", 88, true),
          rating("inside_forward", "Inside Forward", 74),
        ]}
        selectedKey="shadow_striker"
        onSelect={() => {}}
        panelId="panel"
      />,
    );
    expect(roundedOffenders(tabs.container)).toEqual([]);

    const territory = render(
      <RoleTerritory roleDisplayName="Shadow Striker" groups={GROUPS} roleConfidence="high" />,
    );
    expect(roundedOffenders(territory.container)).toEqual([]);
  });

  it("keeps territory overlays and rectangular legend swatches square", () => {
    const { getByTestId } = render(
      <RoleTerritory roleDisplayName="Shadow Striker" groups={GROUPS} roleConfidence="high" />,
    );
    const pitch = getByTestId("role-territory");
    // the translucent highlight rectangles carry positioning, never a radius
    const overlays = Array.from(pitch.querySelectorAll<HTMLElement>("div[style*='left']"));
    expect(overlays.length).toBeGreaterThan(0);
    for (const o of overlays) expect(o.getAttribute("style")).not.toMatch(/border-radius/);
    expect(roundedOffenders(getByTestId("territory-legend"))).toEqual([]);
  });

  it("renders comparison panels, callouts and the compare tray square", () => {
    const table = render(<PlayerCompareTable data={COMPARE} />);
    expect(roundedOffenders(table.container)).toEqual([]);

    const tray = wrapped(
      <>
        <PlayerActionRow player={{ id: 1, name: "Anton Keller" }} />
        <CompareTray />
      </>,
    );
    // queue a player so the tray actually renders its labels
    fireEvent.click(tray.getByRole("button", { name: /compare queue/i }));
    expect(roundedOffenders(tray.container)).toEqual([]);
  });

  it("renders the My Favorites rail square — the Discovery exception is not shared", () => {
    const saved = wrapped(
      <SavedPlayerActionRail player={{ id: 1, name: "Anton Keller" }} onRemove={() => {}} />,
    );
    const box = saved.getByTestId("action-rail-box");
    expect(box.className).toContain("rail-box");
    expect(box.className).not.toContain("rail-box-discovery");
  });

  it("keeps the approved Discovery heart/Compare rail geometry", () => {
    const { getByTestId } = wrapped(<PlayerActionRail player={{ id: 1, name: "Anton Keller" }} />);
    const box = getByTestId("action-rail-box");
    expect(box.className).toContain("rail-box");
    expect(box.className).toContain("rail-box-discovery");
  });

  it("renders mobile navigation controls and menu items square", () => {
    const { container } = wrapped(<NavBar />);
    expect(roundedOffenders(container)).toEqual([]);
  });

  it("leaves genuinely curved shapes alone", () => {
    const { getByTestId } = wrapped(<PlayerActionRail player={{ id: 1, name: "Anton Keller" }} />);
    // the heart is an SVG path, never a squared rectangle
    const heart = getByTestId("favorite-heart");
    expect(heart.tagName.toLowerCase()).toBe("svg");
    expect(heart.querySelector("path")?.getAttribute("d")).toMatch(/^M12 20\.6/);

    const pitch = render(
      <RoleTerritory roleDisplayName="Shadow Striker" groups={GROUPS} roleConfidence="high" />,
    ).getByTestId("role-territory");
    // centre circle + penalty spots survive, and so do the penalty-area arcs
    expect(pitch.querySelectorAll("svg circle").length).toBeGreaterThanOrEqual(4);
    const arcs = Array.from(pitch.querySelectorAll("svg path")).filter((p) =>
      /A 46 46/.test(p.getAttribute("d") ?? ""),
    );
    expect(arcs.length).toBe(2);
  });
});
