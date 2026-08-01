import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PageHeader, ScoreReadout, Section } from "@/components/common";
import { LedgerIdentity, LedgerRoleFitHero } from "@/components/common/LedgerRow";
import { NavBar } from "@/components/common/NavBar";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

// Class-level guards for the unified sans migration. The *computed* family is
// asserted in `tests/e2e/typography.spec.ts`, where the real stylesheet and the
// self-hosted font file are actually loaded; jsdom applies no Tailwind CSS.

/** Every class on the element and its descendants. */
function classesIn(root: HTMLElement): string[] {
  return [root, ...root.querySelectorAll<HTMLElement>("*")].flatMap((el) =>
    el.className && typeof el.className === "string" ? el.className.split(/\s+/) : [],
  );
}

describe("Unified sans typography", () => {
  it("leaves no serif class on the shared heading primitives", () => {
    const { container } = render(<PageHeader eyebrow="Player discovery" title="Discover players" />);
    const classes = classesIn(container.firstElementChild as HTMLElement);
    expect(classes).not.toContain("font-serif");
    expect(classes).not.toContain("serif");
    // heading size and weight are preserved, tightened for Inter
    const heading = screen.getByRole("heading", { name: "Discover players" });
    expect(heading.className).toContain("text-3xl");
    expect(heading.className).toContain("sm:text-4xl");
    expect(heading.className).toContain("font-bold");
    expect(heading.className).toContain("tracking-tight");
  });

  it("keeps the section heading scale without a serif face", () => {
    render(<Section title="Saved Players">body</Section>);
    const heading = screen.getByRole("heading", { name: "Saved Players" });
    expect(heading.className).not.toContain("font-serif");
    expect(heading.className).toContain("text-2xl");
    expect(heading.className).toContain("font-bold");
  });

  it("renders the wordmark typographically with weight and tight tracking", () => {
    const { container } = render(
      <ScoutingStateProvider>
        <NavBar />
      </ScoutingStateProvider>,
    );
    const brand = screen.getByRole("link", { name: /ScoutBoy/ });
    expect(brand.className).not.toContain("font-serif");
    expect(brand.className).toContain("font-extrabold");
    expect(brand.className).toContain("tracking-[-0.03em]");
    // no image/logo asset was introduced
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    // the eyebrow keeps its uppercase tracked treatment
    const eyebrow = screen.getByText("Recruitment");
    expect(eyebrow.className).toContain("uppercase");
    expect(eyebrow.className).toContain("tracking-[0.12em]");
  });

  it("keeps ledger player names prominent without a serif face", () => {
    render(
      <LedgerIdentity href="/players/6" name="Anton Keller" nameTestId="player-result" />,
    );
    const name = screen.getByText("Anton Keller");
    expect(name.className).not.toContain("font-serif");
    expect(name.className).toContain("text-lg");
    expect(name.className).toContain("font-bold");
  });

  it("defaults ScoreReadout to the sans variant and keeps mono available", () => {
    const { rerender } = render(<ScoreReadout score={88.4} caption="Shadow Striker" />);
    const readout = screen.getByTestId("score-readout");
    const figure = readout.firstElementChild as HTMLElement;
    expect(figure.className).not.toContain("font-serif");
    expect(figure.className).toContain("tracking-tight");
    expect(figure.className).toContain("text-3xl");
    expect(figure.className).toContain("font-bold");
    // the score band colour is untouched by the typeface change
    expect(figure.className).toContain("text-pitch-mid");

    rerender(<ScoreReadout score={88.4} variant="mono" />);
    expect((screen.getByTestId("score-readout").firstElementChild as HTMLElement).className).toContain(
      "mono",
    );
  });

  it("keeps the RoleFit hero score larger than the surrounding caption", () => {
    render(<LedgerRoleFitHero hasAnalysis score={90} role="Deep-Lying Playmaker" />);
    const figure = screen.getByTestId("score-readout").firstElementChild as HTMLElement;
    expect(figure.className).toContain("text-3xl");
    expect(screen.getByTestId("score-caption").className).toContain("text-[11px]");
    expect(screen.getByText("RoleFit").className).toContain("label");
  });
});
