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
  title: "ScoutBoy — player discovery",
  description: "Explainable, role-based scouting dossiers for football player discovery.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
