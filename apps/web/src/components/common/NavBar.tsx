"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useScoutingState } from "@/lib/state/scouting-state";

// Test ids are declared, not derived from the label: the presentation copy is
// "My Favorites" while the route, storage keys and stable id stay `shortlist`.
const LINKS = [
  { href: "/", label: "Discover", testId: "nav-discover" },
  { href: "/roles/touchline_winger", label: "Leaderboards", testId: "nav-leaderboards" },
  { href: "/compare", label: "Compare", testId: "nav-compare" },
  { href: "/shortlist", label: "My Favorites", testId: "nav-shortlist" },
  { href: "/methodology", label: "Methodology", testId: "nav-methodology" },
];

export function NavBar() {
  const pathname = usePathname();
  const { shortlistIds } = useScoutingState();
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-line bg-paper-panel">
      <nav
        className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3"
        aria-label="Primary"
      >
        {/* Typographic wordmark: weight + tight tracking carry it, no logo asset. */}
        <Link
          href="/"
          className="text-xl font-extrabold tracking-[-0.03em] text-ink no-underline"
        >
          ScoutBoy{" "}
          <span className="ml-1 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft">
            Recruitment
          </span>
        </Link>

        {/* Menu toggle for mobile/tablet. Inline links appear only at lg+, where
            the labels + counter fit on one line without awkward wrapping. */}
        <button
          type="button"
          className="btn ml-auto px-2.5 py-1.5 text-xs lg:hidden"
          aria-expanded={open}
          aria-controls="primary-nav-links"
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          data-testid="nav-menu-toggle"
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true">{open ? "✕" : "☰"}</span>
          <span>Menu</span>
        </button>

        <div
          id="primary-nav-links"
          className={`${open ? "flex" : "hidden"} order-last w-full flex-wrap gap-1 text-sm lg:order-none lg:flex lg:w-auto`}
        >
          {LINKS.map((l) => {
            const active =
              l.href === "/"
                ? pathname === "/" || pathname === "/players"
                : pathname.startsWith(`/${l.href.split("/")[1]}`);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-2.5 py-1.5 font-semibold no-underline hover:bg-paper-muted hover:text-ink ${
                  active ? "text-pitch-dark shadow-[inset_0_-2px_0_var(--pitch)]" : "text-ink-muted"
                }`}
                data-testid={l.testId}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {l.label}
              </Link>
            );
          })}
        </div>

        {/* My Favorites counter — always visible, never wraps internally, keeps
            the "saved on this device" wording. */}
        <div
          className="ml-auto whitespace-nowrap border border-line bg-paper px-3 py-1 text-xs font-semibold text-ink-muted"
          data-testid="favorites-counter"
        >
          My Favorites <span className="font-mono text-pitch-dark">{shortlistIds.length}</span> ·
          saved on this device
        </div>
      </nav>
    </header>
  );
}
