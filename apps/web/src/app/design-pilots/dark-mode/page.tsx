import type { Metadata } from "next";

import {
  CompareSpecimen,
  DeskSpecimen,
  DiscoverySpecimen,
  HonestyStatesSpecimen,
  NavSpecimen,
  Specimen,
  SwatchesSpecimen,
} from "./_specimens";
import "./pilot.css";

/**
 * ScoutBoy — Dark Mode Pilot. AN APPROVAL ARTIFACT, NOT A THEME.
 *
 * Isolation contract:
 *  - unlinked: this route is absent from `NavBar`'s LINKS and from every
 *    in-page link on a production surface; it is reachable only by typing the
 *    URL;
 *  - noindex/nofollow below;
 *  - every style lives in ./pilot.css beneath the `.dark-pilot` root, so no
 *    production route's colours change;
 *  - no theme switching, no light/dark toggle, no `prefers-color-scheme` query,
 *    and no read or write of any theme preference (there is no client
 *    component here at all — the page is fully static);
 *  - production tokens in globals.css and tailwind.config.ts are untouched.
 */
export const metadata: Metadata = {
  title: "Dark Mode Pilot — ScoutBoy (for visual approval)",
  description:
    "An isolated dark-mode design pilot for ScoutBoy. Not a production theme and not live data.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export default function DarkModePilotPage() {
  return (
    <div className="dark-pilot" data-testid="dark-mode-pilot">
      <div className="pilot-banner" role="note" data-testid="pilot-approval-banner">
        <div className="pilot-banner-inner">
          <span className="pilot-banner-title">Dark Mode Pilot — For Visual Approval</span>
          <span className="pilot-banner-note">
            Not a shipped theme. Not linked from navigation. Not live data.
          </span>
        </div>
      </div>

      <div className="pilot-shell">
        <header className="pilot-intro">
          <p className="specimen-index">ScoutBoy · Design pilot</p>
          <h1>A recruitment desk after hours</h1>
          <p className="pilot-lead">
            The approved thesis is <em>a quiet modern recruitment desk with one living,
            evidence-honest pitch</em>. This pilot translates it rather than replacing it: the warm
            paper becomes a warm charcoal desk, the ink becomes off-white, the hairlines stay, and
            the pitch stops being the darkest thing on the page and becomes the one lit thing on
            it. Everything else stays quiet so it can.
          </p>

          <div className="pilot-facts">
            <p className="pilot-fact">
              <strong>What this is for</strong>
              Deciding whether ScoutBoy should receive a complete dark theme. Nothing here ships.
            </p>
            <p className="pilot-fact">
              <strong>Where the numbers come from</strong>
              Frozen representative values from the deterministic sample cohort (season 2023/24).
              This page makes no API calls and is not a comprehensive view of live data.
            </p>
            <p className="pilot-fact">
              <strong>Scope</strong>
              All styling is scoped beneath a single <code className="pilot-mono">.dark-pilot</code>{" "}
              root. No production route&rsquo;s colours were changed and no theme switching exists.
            </p>
            <p className="pilot-fact">
              <strong>Accessibility</strong>
              Every semantic text/background pair below is measured against WCAG 2.2 AA and
              recorded in <code className="pilot-mono">docs/design_pilots/dark_mode.md</code>. The
              pilot being measured does not make the product accessible.
            </p>
          </div>
        </header>

        <Specimen
          index="01"
          title="Navigation and saved-player counter"
          note="The wordmark stays typographic. The active destination is marked by an underline rule as well as a colour change, and the always-visible counter keeps its “saved on this device” disclosure."
        >
          <NavSpecimen />
        </Specimen>

        <Specimen
          index="02"
          title="Discovery — filter rail and ledger"
          note="The rail stays deliberately subordinate to the ledger: quiet hairlines, canvas-coloured fields, and a selected control that gains a green inset marker as well as a green tint, so selection never rests on colour alone. Four rows exercise the top and bottom of the score scale, all three market states, and a row whose confidence disagrees with its coverage."
        >
          <DiscoverySpecimen />
        </Specimen>

        <Specimen
          index="03"
          title="Recruitment Desk excerpt"
          note="Sekou Diallo’s stored Shadow Striker audit — a genuinely uncertain record: 1,300 minutes in Ligue 2, medium confidence, and a context multiplier that pulls a raw 81.2 down to 68.1. Role Territory is the only elevated surface in the pilot; on a dark canvas it earns that status by being lighter and greener than everything around it rather than by casting a shadow."
        >
          <DeskSpecimen />
        </Specimen>

        <Specimen
          index="04"
          title="Comparison excerpt — no shared rated role"
          note="A real result from the cohort: an attacker and a defensive midfielder with no role in common. The surface stays useful — both sides keep their market state, playstyles and evidence context — and neither side is labelled “not rated”, because no role was selected. No score is fabricated to fill the gap."
        >
          <CompareSpecimen />
        </Specimen>

        <Specimen
          index="05"
          title="Core tokens"
          note="The proposed semantic vocabulary. Each name maps one-for-one onto an existing production light token, so a future migration would be a value swap rather than a re-architecture."
        >
          <SwatchesSpecimen />

          <div style={{ marginTop: "1.75rem" }}>
            <p className="pilot-label" style={{ marginBottom: "0.625rem" }}>
              Honesty states
            </p>
            <HonestyStatesSpecimen />
          </div>
        </Specimen>

        <Specimen
          index="06"
          title="Where this leaves the decision"
          note="Separating what the pilot settles from what it does not. The middle column is what needs a product-owner call before any implementation work is scheduled."
        >
          <div className="pilot-decisions">
            <div>
              <h3>Demonstrated by this pilot</h3>
              <ul>
                <li>Warm charcoal reads as ScoutBoy, not as a generic dashboard.</li>
                <li>Every proposed text/background pair meets WCAG 2.2 AA.</li>
                <li>
                  Role Territory survives as the single signature surface using luminance instead
                  of shadow.
                </li>
                <li>
                  The four evidence channels — score, confidence, coverage, market — stay visually
                  separate on a dark canvas.
                </li>
                <li>Score bands stay distinguishable across all six steps.</li>
                <li>The layout holds at 1280, 640, 390 and 320 with no horizontal overflow.</li>
              </ul>
            </div>
            <div>
              <h3>Needs a product-owner decision</h3>
              <ul>
                <li>Whether ScoutBoy gets a dark theme at all.</li>
                <li>
                  If yes: dark-only, or a user-selectable theme — and whether it should follow the
                  operating system.
                </li>
                <li>
                  Whether the pitch should stay lighter than its surroundings, inverting the light
                  theme&rsquo;s relationship.
                </li>
                <li>
                  Whether score magnitude and market state should keep sharing hues. Amber, rust,
                  red and elite blue are one value in both channels today — in production too —
                  and a dark canvas makes the overlap more visible.
                </li>
                <li>Whether the printed-paper metaphor survives at all in a dark context.</li>
                <li>Whether charts and the market axis need their own dark treatment pass.</li>
              </ul>
            </div>
            <div>
              <h3>Later, only if approved</h3>
              <ul>
                <li>Migrating production components off literal colours onto semantic tokens.</li>
                <li>A theme mechanism, if a switch is wanted.</li>
                <li>A full audit across every production surface and state.</li>
                <li>Dark-mode visual-regression coverage.</li>
              </ul>
              <p className="pilot-soft" style={{ fontSize: "0.75rem", marginTop: "0.75rem" }}>
                None of this is scheduled. The migration surface is listed in{" "}
                <code className="pilot-mono">docs/design_pilots/dark_mode.md</code>.
              </p>
            </div>
          </div>
        </Specimen>
      </div>
    </div>
  );
}
