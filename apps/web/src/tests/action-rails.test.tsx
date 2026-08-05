import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CardActionBar,
  PlayerActionRail,
  SavedPlayerActionRail,
} from "@/components/common/PlayerActions";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "app", "globals.css"),
  "utf8",
);

function wrapped(ui: React.ReactNode) {
  return render(<ScoutingStateProvider>{ui}</ScoutingStateProvider>);
}

beforeEach(() => window.localStorage.clear());

// ---------------------------------------------------------------------------
// Mirrored selected markers on the two ledger rails
// ---------------------------------------------------------------------------
// The marker itself is an inset box-shadow declared in globals.css, which jsdom
// applies no stylesheet for, so the class contract is asserted here and the painted
// result is asserted in `tests/e2e/cross-surface.spec.ts` and the visual baselines.
describe("Ledger rail selected markers", () => {
  it("declares a left marker for the base rail action and a right one for Compare", () => {
    expect(CSS).toContain('.rail-action[aria-pressed="true"]');
    expect(CSS).toMatch(/\.rail-action\[aria-pressed="true"\][\s\S]*?inset 3px 0 0 var\(--pitch\)/);
    expect(CSS).toMatch(
      /\.rail-action-compare\[aria-pressed="true"\][\s\S]*?inset -3px 0 0 var\(--pitch\)/,
    );
    // the compare override is declared after the base rule, so it wins at equal
    // specificity rather than relying on !important
    expect(CSS.indexOf(".rail-action-compare[aria-pressed=")).toBeGreaterThan(
      CSS.indexOf('.rail-action[aria-pressed="true"]'),
    );
  });

  it("paints the marker with a shadow only, never a border or size change", () => {
    const block = /\.rail-action-compare\[aria-pressed="true"\]\s*\{([^}]*)\}/.exec(CSS)![1];
    expect(block).toContain("box-shadow");
    for (const layoutProp of ["border-width", "border-left", "border-right", "padding", "margin", "width", "height"]) {
      expect(block).not.toContain(layoutProp);
    }
  });

  it.each([
    ["Discover", () => wrapped(<PlayerActionRail player={{ id: 1, name: "Anton Keller" }} />)],
    [
      "My Favorites",
      () =>
        wrapped(
          <SavedPlayerActionRail player={{ id: 1, name: "Anton Keller" }} onRemove={() => {}} />,
        ),
    ],
  ])("marks the %s Compare action on its right edge", (_label, mount) => {
    mount();
    const compare = screen.getByTestId("compare-action");
    expect(compare.className).toContain("rail-action-compare");
  });

  it.each([
    ["favourite", "favorite-action", () => wrapped(<PlayerActionRail player={{ id: 1, name: "Anton Keller" }} />)],
    [
      "remove",
      "remove-action",
      () =>
        wrapped(
          <SavedPlayerActionRail player={{ id: 1, name: "Anton Keller" }} onRemove={() => {}} />,
        ),
    ],
  ])("keeps the %s action on the left-marker treatment", (_label, testId, mount) => {
    mount();
    expect(screen.getByTestId(testId).className).not.toContain("rail-action-compare");
  });

  it("changes no class, and therefore no geometry, when Compare is toggled", () => {
    wrapped(<PlayerActionRail player={{ id: 1, name: "Anton Keller" }} />);
    const compare = screen.getByTestId("compare-action");
    const before = compare.className;
    fireEvent.click(compare);
    expect(compare).toHaveAttribute("aria-pressed", "true");
    expect(compare.className).toBe(before);
    fireEvent.click(compare);
    expect(compare).toHaveAttribute("aria-pressed", "false");
    expect(compare.className).toBe(before);
  });

  it("preserves the compare queue behaviour, accessible names and Compare copy", () => {
    wrapped(<PlayerActionRail player={{ id: 7, name: "Jack Whitmore" }} />);
    const compare = screen.getByTestId("compare-action");
    expect(compare.textContent).toBe("Compare");
    expect(compare).toHaveAccessibleName("Add Jack Whitmore to compare queue");
    fireEvent.click(compare);
    expect(compare).toHaveAccessibleName("Remove Jack Whitmore from compare queue");
    expect(compare.textContent).toBe("Compare");
  });

  it("preserves the heart fill and its pressed state on the favourite side", () => {
    wrapped(<PlayerActionRail player={{ id: 3, name: "Anton Keller" }} />);
    const favorite = screen.getByTestId("favorite-action");
    expect(document.querySelector("path.heart-fill")).toHaveAttribute("fill-opacity", "0");
    fireEvent.click(favorite);
    expect(favorite).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector("path.heart-fill")).toHaveAttribute("fill-opacity", "1");
  });
});

// ---------------------------------------------------------------------------
// The right-edge marker is the one Compare treatment, everywhere
// ---------------------------------------------------------------------------
// It used to be scoped to the Discover / My Favorites ledger rails. It is now
// carried by `CompareRailButton` itself, so the leaderboard and the dossier's
// comparable-player cards select exactly the way the home page does.
describe("Compare marker consistency", () => {
  it("reaches the card action bar the leaderboard and the dossier share", () => {
    wrapped(<CardActionBar player={{ id: 1, name: "Anton Keller" }} />);
    expect(screen.getByTestId("compare-action").className).toContain("rail-action-compare");
    // and it still shares the rail box treatment, without the Discovery radius exception
    const bar = screen.getByTestId("card-action-bar");
    expect(bar.className).toContain("rail-box");
    expect(bar.className).toContain("rail-box-inline");
    expect(bar.className).not.toContain("rail-box-discovery");
  });

  it("keeps the favourite side on the mirrored left marker in the card bar too", () => {
    wrapped(<CardActionBar player={{ id: 1, name: "Anton Keller" }} />);
    expect(screen.getByTestId("favorite-action").className).not.toContain("rail-action-compare");
  });

  it("is carried by the shared button, so no call site can opt out", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "components", "common", "PlayerActions.tsx"),
      "utf8",
    );
    // one unconditional class on the shared component...
    expect(source).toContain('className="rail-action rail-action-compare"');
    // ...and no per-call-site marker switch left to get out of step
    expect(source).not.toMatch(/marker\s*[=:]/);
  });

  it.each([
    ["Discover", () => wrapped(<PlayerActionRail player={{ id: 1, name: "Anton Keller" }} />)],
    [
      "My Favorites",
      () =>
        wrapped(
          <SavedPlayerActionRail player={{ id: 1, name: "Anton Keller" }} onRemove={() => {}} />,
        ),
    ],
    ["card bar", () => wrapped(<CardActionBar player={{ id: 1, name: "Anton Keller" }} />)],
  ])("gives %s the identical Compare class list", (_label, mount) => {
    mount();
    expect(screen.getByTestId("compare-action").className).toBe(
      "rail-action rail-action-compare",
    );
  });
});

// ---------------------------------------------------------------------------
// Compact label variant
// ---------------------------------------------------------------------------
describe("Card action bar compact variant", () => {
  it("opts in only when asked, and changes type scale rather than geometry", () => {
    const plain = wrapped(<CardActionBar player={{ id: 1, name: "Anton Keller" }} />);
    expect(plain.getByTestId("card-action-bar").className).not.toContain("rail-box-compact");
    plain.unmount();

    wrapped(<CardActionBar player={{ id: 1, name: "Anton Keller" }} compact />);
    const bar = screen.getByTestId("card-action-bar");
    expect(bar.className).toContain("rail-box-compact");
    // still the same box and the same two actions
    expect(bar.className).toContain("rail-box");
    expect(bar.className).toContain("rail-box-inline");
    expect(bar.children).toHaveLength(2);
    // the modifier touches the label only: no dimension utility rides along
    expect(bar.className).not.toMatch(/\b(?:h-|w-|p-|px-|py-|m-|gap-)/);
  });

  it("declares the compact rule as type scale only, leaving targets intact", () => {
    const block = /\.rail-box-compact \.rail-action\s*\{([^}]*)\}/.exec(CSS)![1];
    // The declared property set is exactly the two type-scale properties, so no
    // dimension can have slipped in alongside them.
    const properties = block
      .split(";")
      .map((d) => d.split(":")[0].trim())
      .filter(Boolean)
      .sort();
    expect(properties).toEqual(["font-size", "line-height"]);
    // and the shared 44px minimum target is untouched
    expect(CSS).toMatch(/\.rail-action\s*\{[^}]*min-height:\s*44px/);
  });
});
