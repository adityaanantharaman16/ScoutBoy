import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmptyState, ErrorState, LedgerSkeleton } from "@/components/common";
import { NavBar } from "@/components/common/NavBar";
import { CompareTray, PlayerActionRail } from "@/components/common/PlayerActions";
import { RecruitmentDesk } from "@/components/player/RecruitmentDesk";
import { RoleTerritory } from "@/components/player/RoleTerritory";
import type {
  AuditBreakdown,
  AuditGroupView,
  PlayerCard,
  PlayerSearchCard,
  RoleRatingDetail,
  RoleRatingSummary,
} from "@/lib/api/types";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";

import { setReducedMotion } from "./setup";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const GLOBALS = readFileSync(join(SRC, "app", "globals.css"), "utf8");

// Favourite and compare state is device-local, so it persists in localStorage
// across tests in this file. Each test starts from an empty desk.
beforeEach(() => {
  window.localStorage.clear();
});

/**
 * Strips block AND line comments, so prose about motion — of which this cadence
 * writes a great deal — is never mistaken for a declaration.
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const GLOBALS_CODE = stripComments(GLOBALS);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const PRODUCTION_FILES = walk(SRC).filter((f) => {
  const rel = f.slice(SRC.length + 1);
  // Tests describe motion in prose; the deferred dark-mode pilot is excluded from
  // production-wide passes by the same contract Cadence 4 established.
  return !rel.startsWith(`tests${sep}`) && !rel.startsWith(join("app", "design-pilots"));
});

// ---------------------------------------------------------------------------
// 1. Tokens
// ---------------------------------------------------------------------------

describe("Motion tokens", () => {
  const DURATIONS = {
    "--motion-feedback": 80,
    "--motion-state": 120,
    "--motion-enter": 180,
    "--motion-exit": 120,
  };
  const EASINGS = ["--motion-ease-out", "--motion-ease-in", "--motion-ease-standard"];

  it("declares exactly four duration tokens in :root", () => {
    for (const [token, ms] of Object.entries(DURATIONS)) {
      expect(GLOBALS_CODE).toContain(`${token}: ${ms}ms;`);
    }
    const declared = GLOBALS_CODE.match(/--motion-[a-z-]+:\s*\d+ms;/g) ?? [];
    expect(declared).toHaveLength(4);
  });

  it("declares exactly three easing tokens and no overshoot curve", () => {
    for (const token of EASINGS) {
      expect(GLOBALS_CODE).toContain(`${token}: cubic-bezier(`);
    }
    const declared = GLOBALS_CODE.match(/--motion-ease-[a-z-]+:\s*cubic-bezier\([^)]*\);/g) ?? [];
    expect(declared).toHaveLength(3);

    // An overshoot/elastic curve needs a control point outside [0, 1] on the
    // output axis (the 2nd and 4th numbers). Assert none exists, so bounce and
    // spring are unexpressible through the token set rather than merely unused.
    for (const decl of declared) {
      const [, y1, , y2] = decl
        .slice(decl.indexOf("(") + 1, decl.lastIndexOf(")"))
        .split(",")
        .map((n) => Number(n.trim()));
      expect(y1).toBeGreaterThanOrEqual(0);
      expect(y1).toBeLessThanOrEqual(1);
      expect(y2).toBeGreaterThanOrEqual(0);
      expect(y2).toBeLessThanOrEqual(1);
    }
  });

  it("keeps every duration at or below the 240ms production maximum", () => {
    for (const ms of Object.values(DURATIONS)) expect(ms).toBeLessThanOrEqual(240);
  });

  it("makes the exit strictly shorter than the matching entrance", () => {
    expect(DURATIONS["--motion-exit"]).toBeLessThan(DURATIONS["--motion-enter"]);
  });

  it("uses only tokens for durations and easings — no literal values in motion rules", () => {
    // Every transition-duration / animation shorthand must reference a token.
    const durationDecls = GLOBALS_CODE.match(/transition-duration:[^;]+;/g) ?? [];
    expect(durationDecls.length).toBeGreaterThan(0);
    for (const decl of durationDecls) expect(decl).toContain("var(--motion-");

    // `animation: none !important` in the reduce kill-switch is a suppression,
    // not a motion declaration, so it is excluded.
    const animations = (GLOBALS_CODE.match(/animation:[^;]+;/g) ?? []).filter(
      (decl) => !decl.includes("none"),
    );
    expect(animations.length).toBeGreaterThan(0);
    for (const decl of animations) {
      expect(decl).toContain("var(--motion-");
      expect(decl).not.toMatch(/\d+ms/);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Source-level motion contract
// ---------------------------------------------------------------------------

describe("Motion source contract", () => {
  it("never uses `transition: all` or a bare `transition` shorthand anywhere", () => {
    for (const file of PRODUCTION_FILES) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, file).not.toMatch(/transition:\s*all/);
      // The broad Tailwind `transition` utility is also gone: it animates a wide
      // property list (including transform, box-shadow and filter) that this
      // cadence replaced with explicit per-property control.
      expect(code, file).not.toMatch(/className="[^"]*\btransition\b(?!-)[^"]*"/);
      expect(code, file).not.toMatch(/`[^`]*\btransition\b(?!-)[^`]*`/);
    }
  });

  it("declares an explicit transition-property list for every transition", () => {
    const properties = GLOBALS_CODE.match(/transition-property:[^;]+;/g) ?? [];
    expect(properties.length).toBeGreaterThan(0);
    for (const decl of properties) {
      expect(decl).not.toContain("all");
      // Focus visibility must never be delayed, so `outline` is never animated.
      expect(decl).not.toContain("outline");
    }
    // Every transition-property has a matching duration and timing function.
    const durations = GLOBALS_CODE.match(/transition-duration:[^;]+;/g) ?? [];
    const timings = GLOBALS_CODE.match(/transition-timing-function:[^;]+;/g) ?? [];
    expect(durations).toHaveLength(properties.length);
    expect(timings).toHaveLength(properties.length);
  });

  it("animates no layout-triggering property", () => {
    const forbidden = [
      "width",
      "height",
      "top",
      "left",
      "right",
      "bottom",
      "margin",
      "padding",
      "grid-template-columns",
      "grid-template-rows",
      "inset",
      "flex",
      "font-size",
    ];

    const animated: string[] = [];
    for (const decl of GLOBALS_CODE.match(/transition-property:[^;]+;/g) ?? []) {
      animated.push(...decl.replace(/transition-property:|;/g, "").split(",").map((p) => p.trim()));
    }
    // Keyframes may only touch opacity and transform.
    for (const block of GLOBALS_CODE.match(/@keyframes[^{]+\{[\s\S]*?\n\}/g) ?? []) {
      for (const prop of block.match(/^\s{4}([a-z-]+):/gm) ?? []) {
        animated.push(prop.trim().replace(":", ""));
      }
    }

    expect(animated.length).toBeGreaterThan(0);
    for (const prop of animated) {
      expect(forbidden, `animated property: ${prop}`).not.toContain(prop);
    }
  });

  it("only animates opacity and transform inside keyframes", () => {
    const blocks = GLOBALS_CODE.match(/@keyframes[^{]+\{[\s\S]*?\n\}/g) ?? [];
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const props = (block.match(/^\s{4}([a-z-]+):/gm) ?? []).map((p) =>
        p.trim().replace(":", ""),
      );
      expect(props.length).toBeGreaterThan(0);
      for (const prop of props) expect(["opacity", "transform"]).toContain(prop);
    }
  });

  it("declares no infinite animation and no staged delay", () => {
    expect(GLOBALS_CODE).not.toContain("infinite");
    expect(GLOBALS_CODE).not.toMatch(/animation-iteration-count/);
    expect(GLOBALS_CODE).not.toMatch(/animation-delay/);
    expect(GLOBALS_CODE).not.toMatch(/transition-delay/);
    // No nth-child stagger anywhere: rows never cascade.
    expect(GLOBALS_CODE).not.toMatch(/nth-child[^{]*\{[^}]*animation/);
  });

  it("promotes no permanent compositor layer", () => {
    for (const file of PRODUCTION_FILES) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, file).not.toContain("will-change");
    }
  });

  it("puts every motion rule inside prefers-reduced-motion: no-preference", () => {
    // Split on the gate: any transition-property or `animation:` outside a
    // `no-preference` block would be motion the reduce path has to fight.
    const gateIndex = GLOBALS_CODE.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(gateIndex).toBeGreaterThan(-1);

    // Everything before the motion gate must be motion-free (the earlier
    // no-preference block only sets scroll-behavior).
    const before = GLOBALS_CODE.slice(0, gateIndex);
    expect(before).not.toContain("transition-property");
    expect(before).not.toMatch(/animation:/);
  });

  it("keeps the reduced-motion kill-switch intact as defence in depth", () => {
    expect(GLOBALS_CODE).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(GLOBALS_CODE).toContain("animation: none !important;");
    expect(GLOBALS_CODE).toContain("transition: none !important;");
    expect(GLOBALS_CODE).toMatch(/scroll-behavior:\s*auto/);
  });

  it("leaks no motion into the deferred dark-mode pilot", () => {
    const pilotDir = join(SRC, "app", "design-pilots", "dark-mode");
    for (const file of walk(pilotDir)) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, file).not.toMatch(/transition/);
      expect(code, file).not.toMatch(/animation/);
      expect(code, file).not.toMatch(/--motion-/);
    }
    // And the pilot uses none of the shared classes that now carry motion.
    const MOTION_CLASSES = [
      "pane-enter",
      "tray-enter",
      "tray-exit",
      "nav-menu-enter",
      "nav-menu-exit",
      "desk-analysis-enter",
      "tray-token-enter",
      "role-tab",
      "evidence-group",
      "territory-zone",
      "heart-fill",
      "nav-link",
    ];
    for (const file of walk(pilotDir).filter((f) => f.endsWith(".tsx"))) {
      const code = readFileSync(file, "utf8");
      for (const cls of MOTION_CLASSES) {
        expect(code, `${file} / ${cls}`).not.toMatch(new RegExp(`["'\\s]${cls}[["'\\s]`));
      }
    }
  });

  it("never transitions the skip link or the focus ring", () => {
    // Both are wayfinding for keyboard users and must land in the current frame.
    const skip = GLOBALS_CODE.slice(GLOBALS_CODE.indexOf(".skip-link"));
    const skipBlock = skip.slice(0, skip.indexOf("@media"));
    expect(skipBlock).not.toContain("transition");
    expect(skipBlock).not.toContain("animation");

    const focusBlock = GLOBALS_CODE.slice(
      GLOBALS_CODE.indexOf(":focus-visible {"),
      GLOBALS_CODE.indexOf(".card {"),
    );
    expect(focusBlock).not.toContain("transition");
  });

  it("declares data-scroll-behavior on the root html element", () => {
    // The CSS sets `scroll-behavior: smooth` under `no-preference`. Next.js only
    // suppresses that during non-hash route transitions if the document declares
    // it — otherwise navigating from a deeply scrolled page glides the whole
    // previous document to the top, which is the page-wide route transition this
    // cadence rejects. Asserted at source so removing the attribute fails here
    // rather than silently reintroducing the glide.
    const layout = readFileSync(join(SRC, "app", "layout.tsx"), "utf8");
    expect(layout).toMatch(/<html\b[^>]*\bdata-scroll-behavior="smooth"/);
    expect(layout).toMatch(/<html\b[^>]*\blang="en"/);
    // It stays a declaration only: no route animation or scroll JavaScript.
    expect(stripComments(layout)).not.toContain("startViewTransition");
    expect(stripComments(layout)).not.toContain("scrollTo");
  });
});

// ---------------------------------------------------------------------------
// Behaviour fixtures
// ---------------------------------------------------------------------------

function group(
  key: string,
  weight: number,
  score: number | null,
  metrics: AuditGroupView["metrics"] = [{ display: "Metric A", score, present: score != null }],
): AuditGroupView {
  return { key, weight, normalized_weight: weight, group_score: score, metrics };
}

const SS_GROUPS: AuditGroupView[] = [
  group("box_presence", 0.4, 94), // spatial + known → att_box
  group("shot_threat", 0.35, null), // spatial + UNKNOWN → hatched att_third zone
  group("possession_security", 0.25, 44), // non-spatial → never placed on the pitch
];
const IF_GROUPS: AuditGroupView[] = [
  group("box_presence", 0.6, 88),
  group("defensive_contribution", 0.4, 59),
];

function audit(role: string, groups: AuditGroupView[]): AuditBreakdown {
  return {
    role_key: role,
    metric_breakdown: { raw_score: 80, groups },
    context_breakdown: {},
    confidence_breakdown: { score: 0.92, level: "high" },
    penalties: { total: 0, items: [] },
    explanation_text: `Explanation for ${role}.`,
  } as unknown as AuditBreakdown;
}

function summary(
  role: string,
  display: string,
  score: number,
  isBest: boolean,
): RoleRatingSummary {
  return {
    role_key: role,
    display_name: display,
    final_score: score,
    confidence: "high",
    rank_in_peer_group: 1,
    is_best: isBest,
  } as unknown as RoleRatingSummary;
}

const CARD = {
  identity: {
    id: 6,
    canonical_name: "Anton Keller",
    club: "Stuttgart",
    league: "Bundesliga",
    age: 21,
    primary_position: "CF",
    secondary_positions: [],
    nationality: "Germany",
  },
  season: "2023/24",
  evidence_status: "high_coverage",
  has_rolefit_analysis: true,
  role_ratings: [
    summary("shadow_striker", "Shadow Striker", 90.0, true),
    summary("inside_forward", "Inside Forward", 72.3, false),
  ],
  context: { minutes: 1550, appearances: 20 },
  market: null,
} as unknown as PlayerCard;

const RATINGS = {
  player_id: 6,
  season: "2023/24",
  audits: [audit("shadow_striker", SS_GROUPS), audit("inside_forward", IF_GROUPS)],
} as unknown as RoleRatingDetail;

function renderDesk() {
  return render(
    <ScoutingStateProvider>
      <RecruitmentDesk card={CARD} ratings={RATINGS} />
    </ScoutingStateProvider>,
  );
}

const SEARCH_CARD = {
  id: 6,
  canonical_name: "Anton Keller",
  season: "2023/24",
  age: 21,
  club: "Stuttgart",
  league: "Bundesliga",
  primary_position: "CF",
  best_role_display: "Shadow Striker",
  best_role_score: 90,
  best_role_confidence: "high",
  // Unfiltered search: the result role context is the best role.
  result_role: "shadow_striker",
  result_role_display: "Shadow Striker",
  result_role_score: 90,
  result_role_confidence: "high",
  result_role_source: "best_role",
  confidence: "high",
  evidence_status: "high_coverage",
  has_rolefit_analysis: true,
  top_playstyles: ["Box Crasher"],
  minutes: 1550,
} as unknown as PlayerSearchCard;

// ---------------------------------------------------------------------------
// 3. Role changes
// ---------------------------------------------------------------------------

describe("Role change motion", () => {
  it("updates content and the live region immediately, not after an animation", () => {
    renderDesk();
    const live = screen.getByTestId("role-live-region");
    fireEvent.click(screen.getByTestId("role-tab-inside_forward"));
    // Synchronously after the click — no timers advanced, no animation awaited.
    expect(live).toHaveTextContent("Inside Forward");
    expect(screen.getByTestId("selected-role-summary")).toHaveTextContent("72.3");
    expect(screen.getByTestId("role-tab-inside_forward")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("cannot display stale analysis after rapid role selection", () => {
    renderDesk();
    const ss = screen.getByTestId("role-tab-shadow_striker");
    const iff = screen.getByTestId("role-tab-inside_forward");
    fireEvent.click(iff);
    fireEvent.click(ss);
    fireEvent.click(iff);

    const list = screen.getByTestId("role-evidence-list");
    // Inside Forward's groups only — Shadow Striker's own groups are gone.
    expect(within(list).getByTestId("evidence-group-defensive_contribution")).toBeInTheDocument();
    expect(
      within(list).queryByTestId("evidence-group-possession_security"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("role-live-region")).toHaveTextContent("Inside Forward");
  });

  it("keeps the selected-role score outside the settling region", () => {
    renderDesk();
    // The score must never fade: the summary carries no entrance animation.
    expect(screen.getByTestId("selected-role-summary").className).not.toContain(
      "desk-analysis-enter",
    );
    // While the role-specific analysis regions do.
    expect(screen.getByTestId("role-evidence-list").className).toContain(
      "desk-analysis-enter",
    );
  });

  it("leaves an unknown group's zone out of the highlight transition", () => {
    render(
      <RoleTerritory
        roleDisplayName="Shadow Striker"
        groups={SS_GROUPS}
        roleConfidence="high"
      />,
    );
    const zones = document.querySelectorAll("[data-zone-unknown]");
    expect(zones.length).toBeGreaterThan(0);
    for (const zone of zones) {
      const unknown = zone.getAttribute("data-zone-unknown") === "true";
      // An unknown zone must never carry the fill transition, so it can never
      // appear to interpolate toward a numeric state.
      expect(zone.className.includes("territory-zone")).toBe(!unknown);
    }
    // And at least one of each kind exists in this fixture.
    const flags = [...zones].map((z) => z.getAttribute("data-zone-unknown"));
    expect(flags).toContain("true");
    expect(flags).toContain("false");
  });

  it("keeps hover, keyboard focus and pin synchronized on one shared class", () => {
    render(
      <RoleTerritory roleDisplayName="Inside Forward" groups={IF_GROUPS} roleConfidence="high" />,
    );
    const row = screen.getByTestId("evidence-group-box_presence");
    expect(row.className).toContain("evidence-group");

    fireEvent.mouseEnter(row);
    expect(row.className).toContain("bg-paper-muted");
    fireEvent.mouseLeave(row);
    expect(row.className).not.toContain("bg-paper-muted");

    fireEvent.focus(row);
    expect(row.className).toContain("bg-paper-muted");
    fireEvent.blur(row);

    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(row.className).toContain("bg-paper-muted");
  });

  it("keeps arrow and Home/End selection immediate", () => {
    renderDesk();
    const first = screen.getByTestId("role-tab-shadow_striker");
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByTestId("role-tab-inside_forward")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(screen.getByTestId("role-tab-inside_forward"), { key: "Home" });
    expect(screen.getByTestId("role-tab-shadow_striker")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Favourite / compare
// ---------------------------------------------------------------------------

describe("Favourite and compare motion", () => {
  const rail = () =>
    render(
      <ScoutingStateProvider>
        <PlayerActionRail player={{ id: 6, name: "Anton Keller" }} />
      </ScoutingStateProvider>,
    );

  it("preserves labels, geometry and ARIA across a toggle", () => {
    rail();
    const favorite = screen.getByTestId("favorite-action");
    const compare = screen.getByTestId("compare-action");
    const beforeClasses = { favorite: favorite.className, compare: compare.className };

    expect(favorite).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(favorite);
    expect(favorite).toHaveAttribute("aria-pressed", "true");
    expect(favorite).toHaveAccessibleName("Remove Anton Keller from My Favorites");

    fireEvent.click(compare);
    expect(compare).toHaveAttribute("aria-pressed", "true");
    expect(compare).toHaveTextContent("Compare");

    // No dimension-affecting class was added by either state change.
    expect(favorite.className).toBe(beforeClasses.favorite);
    expect(compare.className).toBe(beforeClasses.compare);
  });

  it("transitions the heart via fill-opacity, never a non-interpolable fill", () => {
    rail();
    const path = () => document.querySelector("path.heart-fill")!;
    expect(path()).toHaveAttribute("fill", "currentColor");
    expect(path()).toHaveAttribute("fill-opacity", "0");
    fireEvent.click(screen.getByTestId("favorite-action"));
    expect(path()).toHaveAttribute("fill", "currentColor");
    expect(path()).toHaveAttribute("fill-opacity", "1");
  });

  it("stays deterministic under rapid toggling", () => {
    rail();
    const favorite = screen.getByTestId("favorite-action");
    for (let i = 0; i < 6; i += 1) fireEvent.click(favorite);
    // Even number of clicks → back to off, with no intermediate state retained.
    expect(favorite).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector("path.heart-fill")).toHaveAttribute("fill-opacity", "0");
  });
});

// ---------------------------------------------------------------------------
// 5. Compare tray presence
// ---------------------------------------------------------------------------

describe("Compare tray presence", () => {
  function renderTray() {
    return render(
      <ScoutingStateProvider>
        <PlayerActionRail player={{ id: 6, name: "Anton Keller" }} />
        <CompareTray />
      </ScoutingStateProvider>,
    );
  }

  it("enters from the bottom boundary and exits toward it", () => {
    vi.useFakeTimers();
    try {
      renderTray();
      expect(screen.queryByTestId("compare-tray")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("compare-action"));
      const tray = screen.getByTestId("compare-tray");
      expect(tray.className).toContain("tray-enter");
      expect(tray.className).not.toContain("tray-exit");

      // Emptying the queue starts the exit but does not remove the tray yet.
      fireEvent.click(screen.getByTestId("compare-action"));
      expect(screen.getByTestId("compare-tray").className).toContain("tray-exit");
      expect(screen.getByTestId("compare-tray")).toHaveAttribute("data-leaving", "true");

      act(() => void vi.advanceTimersByTime(120));
      expect(screen.queryByTestId("compare-tray")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cannot be stranded as a ghost tray by rapid add/remove", () => {
    vi.useFakeTimers();
    try {
      renderTray();
      const action = screen.getByTestId("compare-action");

      fireEvent.click(action); // add
      fireEvent.click(action); // remove → exit begins
      fireEvent.click(action); // re-add mid-exit → must cancel the pending unmount

      act(() => void vi.advanceTimersByTime(500));
      const tray = screen.getByTestId("compare-tray");
      expect(tray).toBeInTheDocument();
      expect(tray).toHaveAttribute("data-leaving", "false");
      expect(tray.className).toContain("tray-enter");
      expect(within(tray).getByText("Anton Keller")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears immediately and never leaves a stale queue behind", () => {
    vi.useFakeTimers();
    try {
      renderTray();
      fireEvent.click(screen.getByTestId("compare-action"));
      fireEvent.click(within(screen.getByTestId("compare-tray")).getByText("Clear"));
      // The queue is empty in the same commit; only the element's removal waits.
      expect(screen.getByTestId("compare-tray")).toHaveAttribute("data-leaving", "true");
      act(() => void vi.advanceTimersByTime(120));
      expect(screen.queryByTestId("compare-tray")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("mounts and unmounts in the same commit under reduced motion", () => {
    setReducedMotion(true);
    renderTray();
    fireEvent.click(screen.getByTestId("compare-action"));
    const tray = screen.getByTestId("compare-tray");
    // No exit class is ever applied, so no translation can remain.
    expect(tray).toHaveAttribute("data-leaving", "false");

    fireEvent.click(screen.getByTestId("compare-action"));
    // Gone with no timer advanced at all.
    expect(screen.queryByTestId("compare-tray")).not.toBeInTheDocument();
  });

  it("gives a newly queued token an opacity-only entrance", () => {
    renderTray();
    fireEvent.click(screen.getByTestId("compare-action"));
    const token = within(screen.getByTestId("compare-tray")).getByText("Anton Keller");
    expect(token.className).toContain("tray-token-enter");
  });
});

// ---------------------------------------------------------------------------
// 6. Mobile navigation
// ---------------------------------------------------------------------------

describe("Mobile navigation motion", () => {
  const renderNav = () =>
    render(
      <ScoutingStateProvider>
        <NavBar />
      </ScoutingStateProvider>,
    );

  it("keeps aria-expanded bound to the real state, not to the animation", () => {
    vi.useFakeTimers();
    try {
      renderNav();
      const toggle = screen.getByTestId("nav-menu-toggle");
      expect(toggle).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByTestId("nav-menu-panel").className).toContain("nav-menu-enter");

      fireEvent.click(toggle);
      // Announced closed immediately, even though the panel is still exiting.
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByTestId("nav-menu-panel").className).toContain("nav-menu-exit");

      act(() => void vi.advanceTimersByTime(120));
      expect(screen.getByTestId("nav-menu-panel").className).toContain("hidden");
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the destinations and the counter", () => {
    renderNav();
    fireEvent.click(screen.getByTestId("nav-menu-toggle"));
    expect(screen.getByTestId("nav-discover")).toHaveAttribute("href", "/");
    expect(screen.getByTestId("nav-shortlist")).toHaveAttribute("href", "/shortlist");
    expect(screen.getByTestId("favorites-counter")).toHaveTextContent("My Favorites");
  });

  it("opens immediately under reduced motion", () => {
    setReducedMotion(true);
    renderNav();
    fireEvent.click(screen.getByTestId("nav-menu-toggle"));
    const panel = screen.getByTestId("nav-menu-panel");
    expect(panel.className).toContain("flex");
    fireEvent.click(screen.getByTestId("nav-menu-toggle"));
    // Closed with no timer advanced and no exit class.
    expect(screen.getByTestId("nav-menu-panel").className).toContain("hidden");
    expect(screen.getByTestId("nav-menu-panel").className).not.toContain("nav-menu-exit");
  });
});

// ---------------------------------------------------------------------------
// 7. Content replacement
// ---------------------------------------------------------------------------

describe("Content replacement motion", () => {
  it("keeps the loading skeleton completely static", () => {
    const { container } = render(<LedgerSkeleton rows={4} label="Finding players…" />);
    const html = container.innerHTML;
    // No shimmer, pulse, gradient, or entrance on the in-progress state.
    expect(html).not.toContain("animate");
    expect(html).not.toContain("pane-enter");
    expect(html).not.toContain("gradient");
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it("settles the empty and error states with the same restrained pane treatment", () => {
    const { container: empty } = render(<EmptyState label="No players match these filters." />);
    expect(empty.firstElementChild!.className).toContain("pane-enter");
    expect(empty.querySelector('[role="status"]')).toBeInTheDocument();

    const { container: error } = render(<ErrorState message="Failed to load players." />);
    expect(error.firstElementChild!.className).toContain("pane-enter");
    // The alert is present at mount, so the announcement is never delayed.
    expect(error.querySelector('[role="alert"]')).toHaveTextContent("Failed to load players.");
  });

  it("settles the whole results ledger as one unit so count and rows cannot disagree", () => {
    // The count header and the rows share one animated ancestor.
    const source = readFileSync(
      join(SRC, "components", "search", "PlayerSearchResults.tsx"),
      "utf8",
    );
    const ledgerLine = source.slice(source.indexOf('data-testid="results-ledger"') - 400);
    expect(ledgerLine).toContain("pane-enter");
    // `result-count` is inside that same container.
    expect(source.indexOf('data-testid="result-count"')).toBeGreaterThan(
      source.indexOf('data-testid="results-ledger"'),
    );
  });
});

// ---------------------------------------------------------------------------
// 8. Disclosures
// ---------------------------------------------------------------------------

describe("Disclosure treatment", () => {
  it("keeps Evidence & Context a native, keyboard-operable <details> with no animation", () => {
    renderDesk();
    const rail = screen.getByTestId("evidence-context-rail");
    expect(rail.tagName).toBe("DETAILS");
    expect(rail).toHaveAttribute("open");
    expect(within(rail).getByText("Evidence & Context").tagName).toBe("SUMMARY");
    // One consistent treatment: immediate expansion, no content fade, no custom
    // indicator. A fade here would fire on page load, since this opens by
    // default — motion with no triggering action.
    expect(rail.className).not.toContain("pane-enter");
    expect(rail.className).not.toContain("desk-analysis-enter");
    expect(rail.innerHTML).not.toContain("-enter");
  });

  it("renders the ledger row without a broad transition utility", () => {
    render(
      <ScoutingStateProvider>
        <table>
          <tbody />
        </table>
      </ScoutingStateProvider>,
    );
    const source = readFileSync(join(SRC, "components", "common", "LedgerRow.tsx"), "utf8");
    expect(stripComments(source)).not.toMatch(/className="ledger-row[^"]*\btransition\b/);
    expect(source).toContain("ledger-row");
  });
});

// ---------------------------------------------------------------------------
// 9. Static surfaces
// ---------------------------------------------------------------------------

describe("Intentionally static surfaces", () => {
  it("never animates a score bar's fill", () => {
    // Score bars are data, not progress. `width` is set inline and is never in a
    // transition-property list (asserted globally above); here we confirm the
    // fill elements themselves carry no motion class, so no bar can grow or draw
    // itself on render.
    render(
      <RoleTerritory roleDisplayName="Inside Forward" groups={IF_GROUPS} roleConfidence="high" />,
    );
    const fills = document.querySelectorAll(".bg-track > div");
    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) {
      expect(fill.className).not.toContain("-enter");
      expect(fill.className).not.toContain("territory-zone");
      expect((fill as HTMLElement).style.width).not.toBe("");
    }
  });

  it("keeps the search row's ledger identity free of entrance motion", () => {
    render(
      <ScoutingStateProvider>
        <div>{/* rows themselves never animate; only the pane does */}</div>
      </ScoutingStateProvider>,
    );
    const source = readFileSync(
      join(SRC, "components", "search", "PlayerSearchResults.tsx"),
      "utf8",
    );
    const rowBlock = source.slice(
      source.indexOf("export function ResultCard"),
      source.indexOf("export function PlayerSearchResults"),
    );
    // No per-row entrance → no cascade, no stagger.
    expect(rowBlock).not.toContain("-enter");
  });

  it("does not animate the pitch field, markings, legend or disclosure", () => {
    const source = stripComments(
      readFileSync(join(SRC, "components", "player", "RoleTerritory.tsx"), "utf8"),
    );
    const pitchField = source.slice(
      source.indexOf("function PitchField"),
      source.indexOf("export interface TerritoryHighlight"),
    );
    expect(pitchField).not.toContain("-enter");
    expect(pitchField).not.toContain("transition");

    render(
      <RoleTerritory roleDisplayName="Inside Forward" groups={IF_GROUPS} roleConfidence="high" />,
    );
    expect(screen.getByTestId("territory-disclosure").className).not.toContain("-enter");
    expect(screen.getByTestId("territory-legend").className).not.toContain("-enter");
  });

  it("keeps the search card row and rail geometry unchanged", () => {
    render(
      <ScoutingStateProvider>
        <PlayerActionRail player={{ id: SEARCH_CARD.id, name: SEARCH_CARD.canonical_name }} />
      </ScoutingStateProvider>,
    );
    // The one sanctioned rectangular radius exception survives this cadence.
    expect(screen.getByTestId("action-rail-box").className).toContain("rail-box-discovery");
  });
});
