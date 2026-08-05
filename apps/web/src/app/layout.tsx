import type { Metadata } from "next";

import { NavBar } from "@/components/common/NavBar";
// Self-hosted Inter Variable (woff2 bundled by the build, `font-display: swap`).
// Imported before globals.css so the @font-face rules precede our own cascade.
// Deliberately NOT next/font/google or any runtime CDN: the production build must
// stay reproducible and offline.
import "inter-ui/inter-variable.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "ScoutBoy - Player Discovery",
  description: "Explainable, role-based scouting dossiers for football player discovery.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `data-scroll-behavior="smooth"` declares to Next.js that the document sets
    // `scroll-behavior: smooth` in CSS (globals.css, under
    // `prefers-reduced-motion: no-preference`). Next.js then temporarily switches
    // route-transition scrolling to `auto` for non-hash navigations and restores
    // the CSS behaviour afterwards.
    //
    // Without it, navigating away from a deeply scrolled dossier glides the whole
    // previous document to the top — a page-wide route transition, which the
    // Interaction & Motion cadence explicitly rejects. This is a declaration, not
    // an animation: no route motion, no View Transitions API, no scroll JavaScript.
    // In-page hash anchors still scroll smoothly, and `reduce` still computes to
    // `auto`.
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <Providers>
          <a href="#main" className="skip-link">
            Skip to main content
          </a>
          <NavBar />
          <main id="main" className="mx-auto max-w-6xl px-4 py-6 pb-28">
            {children}
          </main>
          <footer className="mx-auto max-w-6xl border-t border-line px-4 py-8 text-xs text-ink-soft">
            <p>
              ScoutBoy is an independent prototype. Not affiliated with FUT.gg, EA SPORTS FC,
              clubs, or data providers.
            </p>
            <p className="mt-1">
              Coverage is limited to the available local snapshots. Profile-only and low-confidence
              states are shown without fabricated RoleFit analysis.
            </p>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
