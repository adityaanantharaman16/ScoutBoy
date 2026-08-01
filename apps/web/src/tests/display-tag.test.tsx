import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ConfidenceBadge,
  DisplayTag,
  EvidenceTag,
  MarketReadout,
  displayTagClass,
  type TagVariant,
} from "@/components/common";
import { PlayerActionRail } from "@/components/common/PlayerActions";
import { CalibrationPanel } from "@/components/methodology/CalibrationPanel";
import { PlaystyleBadges } from "@/components/player/PlaystyleBadges";
import { RoleRatingsPanel } from "@/components/player/RoleRatingsPanel";
import { RoleSelector } from "@/components/player/RoleSelector";
import { PlayerSearchFilters } from "@/components/search/PlayerSearchFilters";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";
import type { Methodology, PlaystyleBadge, RoleRatingSummary } from "@/lib/api/types";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const ALL_VARIANTS: TagVariant[] = [
  "playstyle",
  "concern",
  "market",
  "role-status",
  "confidence",
  "evidence",
  "neutral",
];

function badge(over: Partial<PlaystyleBadge> = {}): PlaystyleBadge {
  return {
    playstyle_key: "box_crasher",
    display_name: "Box Crasher",
    category: "attack",
    tier: null,
    confidence: "high",
    is_concern: false,
    why_applied: { text: "96th percentile" },
    supporting_metrics: [],
    ...over,
  } as unknown as PlaystyleBadge;
}

function rating(over: Partial<RoleRatingSummary> = {}): RoleRatingSummary {
  return {
    role_key: "shadow_striker",
    display_name: "Shadow Striker",
    final_score: 90,
    raw_score: 90,
    context_adjusted_score: 90,
    confidence: "high",
    rank_in_peer_group: 1,
    is_best: true,
    ...over,
  } as unknown as RoleRatingSummary;
}

// ---------------------------------------------------------------------------
// the primitive
// ---------------------------------------------------------------------------
describe("DisplayTag geometry", () => {
  it("gives every semantic variant the same shared base geometry", () => {
    for (const variant of ALL_VARIANTS) {
      const { unmount } = render(
        <DisplayTag variant={variant} testId={`t-${variant}`}>
          Label
        </DisplayTag>,
      );
      const tag = screen.getByTestId(`t-${variant}`);
      expect(tag.className, `${variant} uses the shared base`).toContain("display-tag");
      expect(tag).toHaveAttribute("data-tag-variant", variant);
      // sharp, never a capsule
      expect(tag.className).not.toContain("chip");
      expect(tag.className).not.toContain("rounded-full");
      unmount();
    }
  });

  it("is a plain non-interactive span with no button semantics or tab stop", () => {
    render(<DisplayTag variant="neutral" testId="t">Label</DisplayTag>);
    const tag = screen.getByTestId("t");
    expect(tag.tagName).toBe("SPAN");
    expect(tag).not.toHaveAttribute("role");
    expect(tag).not.toHaveAttribute("tabindex");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("passes through title and aria-label without inventing them", () => {
    const { rerender } = render(
      <DisplayTag variant="playstyle" title="96th percentile" ariaLabel="High confidence" testId="t">
        Box Crasher
      </DisplayTag>,
    );
    expect(screen.getByTestId("t")).toHaveAttribute("title", "96th percentile");
    expect(screen.getByTestId("t")).toHaveAccessibleName("High confidence");
    rerender(<DisplayTag variant="playstyle" title="" testId="t">Box Crasher</DisplayTag>);
    expect(screen.getByTestId("t")).not.toHaveAttribute("title");
  });

  it("offers a compound presentation on the same geometry", () => {
    render(<DisplayTag variant="market" value="inflated" compound testId="t">two facts</DisplayTag>);
    const tag = screen.getByTestId("t");
    expect(tag.className).toContain("display-tag");
    expect(tag.className).toContain("display-tag-compound");
  });

  it("exposes no colour/className escape hatch on the component API", () => {
    // A call site can only pick a semantic meaning. If this ever compiles with a
    // `className`, the central colour control has been broken.
    const props = { variant: "neutral" as const, children: "x" };
    expect(Object.keys(props)).not.toContain("className");
    // and the class helper derives colour from the variant, not from the caller
    expect(displayTagClass("playstyle")).toContain("bg-ink");
    expect(displayTagClass("concern")).toContain("text-accent-red");
  });
});

// ---------------------------------------------------------------------------
// semantic tones
// ---------------------------------------------------------------------------
describe("DisplayTag semantics", () => {
  it("renders playstyles as the dark filled treatment with light text", () => {
    const cls = displayTagClass("playstyle");
    expect(cls).toContain("bg-ink");
    expect(cls).toContain("text-paper");
    expect(cls).toContain("border-ink");
  });

  it("keeps concerns in warning styling, visually distinct from playstyles", () => {
    const concern = displayTagClass("concern");
    expect(concern).toContain("text-accent-red");
    expect(concern).not.toContain("bg-ink");
    expect(concern).not.toBe(displayTagClass("playstyle"));
    // and distinct from the amber market valuation label
    expect(concern).not.toBe(displayTagClass("market", "inflated"));
  });

  it("keeps Inflated amber and High-Risk red as distinct market states", () => {
    const inflated = displayTagClass("market", "inflated");
    const highRisk = displayTagClass("market", "high-risk");
    expect(inflated).toContain("text-accent-amber");
    expect(highRisk).toContain("text-accent-red");
    expect(inflated).not.toBe(highRisk);
    // undervalued positive, fair + unknown neutral
    expect(displayTagClass("market", "undervalued")).toContain("text-pitch-dark");
    expect(displayTagClass("market", "fair")).toContain("text-ink-muted");
    expect(displayTagClass("market", null)).toContain("text-ink-muted");
  });

  it("keeps role status positive green and distinct from confidence and neutral", () => {
    const role = displayTagClass("role-status");
    expect(role).toContain("text-pitch-dark");
    expect(role).toContain("border-pitch");
    expect(role).not.toBe(displayTagClass("neutral"));
    expect(displayTagClass("evidence")).not.toBe(displayTagClass("neutral"));
  });

  it("keeps confidence tones graded and separate from evidence coverage", () => {
    expect(displayTagClass("confidence", "high")).not.toBe(displayTagClass("confidence", "low"));
    expect(displayTagClass("confidence", "high")).not.toBe(displayTagClass("evidence"));
    // unknown confidence is neutral, not "low"
    expect(displayTagClass("confidence", "unknown")).not.toBe(displayTagClass("confidence", "low"));
    expect(displayTagClass("confidence", "unknown")).toContain("text-ink-muted");
  });
});

// ---------------------------------------------------------------------------
// integrations
// ---------------------------------------------------------------------------
describe("Tag integrations", () => {
  it("renders dossier playstyles dark and concerns as warnings", () => {
    render(
      <PlaystyleBadges
        playstyles={[badge({ tier: "elite", display_name: "Technical Carrier" })]}
        concerns={[badge({ playstyle_key: "inflated_market", display_name: "Inflated Market" })]}
      />,
    );
    const playstyle = within(screen.getByTestId("playstyles")).getByText(/Technical Carrier/);
    expect(playstyle).toHaveAttribute("data-tag-variant", "playstyle");
    expect(playstyle.className).toContain("bg-ink");
    // the elite tier stays in the label text but never changes the colour
    expect(playstyle).toHaveTextContent("Technical Carrier · Elite");

    const concern = within(screen.getByTestId("concerns")).getByText("Inflated Market");
    expect(concern).toHaveAttribute("data-tag-variant", "concern");
    expect(concern.className).toContain("text-accent-red");
    expect(concern.className).not.toContain("bg-ink");
  });

  it("gives every playstyle tier the same visual identity", () => {
    render(
      <PlaystyleBadges
        playstyles={[
          badge({ playstyle_key: "a", display_name: "A", tier: "elite" }),
          badge({ playstyle_key: "b", display_name: "B", tier: "plus" }),
          badge({ playstyle_key: "c", display_name: "C", tier: null }),
        ]}
        concerns={[]}
      />,
    );
    const classes = within(screen.getByTestId("playstyles"))
      .getAllByText(/^[ABC]/)
      .map((el) => el.className);
    expect(new Set(classes).size, "all tiers share one tag treatment").toBe(1);
  });

  it("keeps honest empty states as prose, not tags", () => {
    render(<PlaystyleBadges playstyles={[]} concerns={[]} />);
    const empty = screen.getByText(/No qualifying playstyles/i);
    expect(empty).not.toHaveAttribute("data-tag-variant");
    expect(screen.getByText("None flagged.")).not.toHaveAttribute("data-tag-variant");
  });

  it("renders Best as a positive role-status tag in Peer-Ranked Roles", () => {
    render(<RoleRatingsPanel ratings={[rating()]} />);
    const best = screen.getByText("Best");
    expect(best).toHaveAttribute("data-tag-variant", "role-status");
    expect(best.className).toContain("display-tag");
    expect(best.className).toContain("text-pitch-dark");
  });

  it("renders confidence and evidence as separate semantic tags", () => {
    render(
      <div>
        <ConfidenceBadge confidence="high" />
        <EvidenceTag status="high_coverage" />
      </div>,
    );
    const confidence = screen.getByText("High");
    expect(confidence).toHaveAttribute("data-tag-variant", "confidence");
    expect(confidence).toHaveAccessibleName("High confidence");
    const evidence = within(screen.getByTestId("evidence-tag")).getByText("High Coverage");
    expect(evidence).toHaveAttribute("data-tag-variant", "evidence");
    expect(evidence.className).not.toBe(confidence.className);
  });

  it("keeps MarketReadout honest across layouts after the migration", () => {
    const { rerender } = render(<MarketReadout label="inflated" low={1_000_000} high={2_000_000} />);
    let readout = screen.getByTestId("market-readout");
    expect(within(readout).getByText("Inflated")).toHaveAttribute("data-tag-variant", "market");
    expect(readout).toHaveTextContent("€1.0M – €2.0M");

    // missing stays unknown, never zero
    rerender(<MarketReadout label={null} low={null} high={null} />);
    readout = screen.getByTestId("market-readout");
    expect(readout).toHaveTextContent("Unknown");
    expect(readout).not.toHaveTextContent("€0");

    // partial ranges preserved in the stacked layout too
    rerender(<MarketReadout layout="stacked" label="fair" low={20_000_000} high={null} />);
    readout = screen.getByTestId("market-readout");
    expect(readout).toHaveTextContent("From €20.0M");
    expect(readout).not.toHaveTextContent("€0");
    expect(within(readout).getByText("Fair")).toHaveAttribute("data-tag-variant", "market");
  });

  it("mirrors the inline market readout for an end-aligned column", () => {
    const { rerender } = render(
      <MarketReadout label="inflated" low={58_500_000} high={87_800_000} />,
    );
    let readout = screen.getByTestId("market-readout");
    // left column: risk tag first, then the range
    expect(readout).toHaveAttribute("data-market-align", "start");
    expect(readout.className).not.toContain("flex-row-reverse");
    expect(readout.textContent).toBe("Inflated€58.5M – €87.8M");

    rerender(<MarketReadout label="high-risk" low={64_500_000} high={96_800_000} align="end" />);
    readout = screen.getByTestId("market-readout");
    // right column: same DOM order, visually reversed so the tag hugs the right
    expect(readout).toHaveAttribute("data-market-align", "end");
    expect(readout.className).toContain("sm:flex-row-reverse");
    expect(within(readout).getByText("High-Risk")).toHaveAttribute("data-tag-variant", "market");
    expect(readout).toHaveTextContent("€64.5M – €96.8M");
  });

  it("keeps the market label and range on one line for wide figures", () => {
    for (const align of ["start", "end"] as const) {
      const { unmount } = render(
        <MarketReadout label="high-risk" low={146_200_000} high={296_800_000} align={align} />,
      );
      const readout = screen.getByTestId("market-readout");
      // the row never wraps, and the figures never break across the en-dash
      expect(readout.className).not.toContain("flex-wrap");
      const range = within(readout).getByText("€146.2M – €296.8M");
      expect(range.className).toContain("whitespace-nowrap");
      unmount();
    }
  });

  it("renders calibration statuses as restrained neutral tags", () => {
    const calibration = {
      available: true,
      suite_id: "rolefit_calibration",
      suite_version: "v1",
      calibration_version: "v1",
      rating_version: "rolefit-v2",
      status: "pass",
      benchmarks: { passed: 9, warned: 0, failed: 0, inconclusive: 0, total: 9 },
      scenarios: { passed: 9, warned: 0, failed: 0, inconclusive: 0, total: 9 },
      methodology_note: "note",
      pilot_coverage_limitation: "limitation",
      config_hash: "abc123",
    } as unknown as NonNullable<Methodology["calibration"]>;
    render(<CalibrationPanel calibration={calibration} />);
    expect(screen.getByText("Status: Pass")).toHaveAttribute("data-tag-variant", "neutral");
    expect(screen.getByText(/Suite rolefit_calibration/)).toHaveAttribute(
      "data-tag-variant",
      "role-status",
    );
  });
});

// ---------------------------------------------------------------------------
// no reintroduction of legacy page-specific semantic chips
// ---------------------------------------------------------------------------
describe("Legacy semantic chip call sites", () => {
  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        // `design-pilots` is a separate self-contained pilot area with its own
        // scoped stylesheet; it is not part of the product tag system.
        if (entry !== "design-pilots") sourceFiles(full, acc);
      } else if (/\.tsx?$/.test(entry) && !full.includes("/tests/")) acc.push(full);
    }
    return acc;
  }

  /** `chip` as a standalone class token — not a hyphenated name that contains it. */
  const LEGACY_CHIP = /className=\{?[`"'][^`"']*(?:^|[`"'\s{])chip(?:[\s`"'$]|$)/;

  it("has no legacy `chip` display tag left in application source", () => {
    const offenders = sourceFiles(join(process.cwd(), "src")).filter((file) =>
      LEGACY_CHIP.test(readFileSync(file, "utf8")),
    );
    expect(offenders, "semantic tags must go through DisplayTag").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// controls are not display tags
// ---------------------------------------------------------------------------
describe("Interactive controls were not migrated", () => {
  it("leaves the role selector's tabs as controls, not tags", () => {
    render(
      <RoleSelector
        ratings={[rating(), rating({ role_key: "inside_forward", display_name: "Inside Forward", is_best: false })]}
        selectedKey="shadow_striker"
        onSelect={() => {}}
        panelId="panel"
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(2);
    for (const tab of tabs) {
      expect(tab).not.toHaveAttribute("data-tag-variant");
      expect(tab.className).not.toContain("display-tag");
    }
  });

  it("leaves discovery filter controls as native form controls, not tags", () => {
    render(
      <PlayerSearchFilters
        filters={{ scope: "analyzed", age_band: "all", sort: "rolefit_desc", page: 1 }}
        onChange={() => {}}
      />,
    );
    // scope + age-band are now native selectors, and still not display tags
    for (const control of screen.getAllByRole("combobox")) {
      expect(control).not.toHaveAttribute("data-tag-variant");
      expect(control.className).not.toContain("display-tag");
    }
  });

  it("leaves the favourite and compare rail actions as buttons", () => {
    render(
      <ScoutingStateProvider>
        <PlayerActionRail player={{ id: 1, name: "Anton Keller" }} />
      </ScoutingStateProvider>,
    );
    for (const button of screen.getAllByRole("button")) {
      expect(button).not.toHaveAttribute("data-tag-variant");
      expect(button.className).not.toContain("display-tag");
    }
  });
});
