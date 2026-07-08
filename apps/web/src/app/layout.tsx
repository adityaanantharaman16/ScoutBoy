import type { Metadata } from "next";

import { NavBar } from "@/components/common/NavBar";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "ScoutBoy — player discovery",
  description: "Explainable, role-based scouting cards for U23 attackers & midfielders in Europe.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <NavBar />
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-slate-500">
            ScoutBoy is an independent prototype. Not affiliated with FUT.gg, EA SPORTS FC, clubs, or
            data providers. Sample data is synthetic.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
