"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useScoutingState } from "@/lib/state/scouting-state";

const LINKS = [
  { href: "/", label: "Discover" },
  { href: "/roles/touchline_winger", label: "Leaderboards" },
  { href: "/compare", label: "Compare" },
  { href: "/shortlist", label: "Shortlist" },
  { href: "/methodology", label: "Methodology" },
];

export function NavBar() {
  const pathname = usePathname();
  const { shortlistIds } = useScoutingState();

  return (
    <header className="border-b border-line bg-paper-panel">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-7 gap-y-3 px-4 py-3" aria-label="Primary">
        <Link href="/" className="font-serif text-xl font-bold tracking-tight text-ink no-underline">
          ScoutBoy <span className="ml-1 font-sans text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft">Recruitment</span>
        </Link>
        <div className="flex flex-wrap gap-1 text-sm">
          {LINKS.map((l) => {
            const active =
              l.href === "/"
                ? pathname === "/" || pathname === "/players"
                : pathname.startsWith(`/${l.href.split("/")[1]}`);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded px-2.5 py-1.5 font-semibold no-underline hover:bg-paper-muted hover:text-ink ${
                  active ? "text-pitch-dark shadow-[inset_0_-2px_0_var(--pitch)]" : "text-ink-muted"
                }`}
                data-testid={`nav-${l.label.toLowerCase()}`}
                aria-current={active ? "page" : undefined}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto border border-line bg-paper px-3 py-1 text-xs font-semibold text-ink-muted" style={{ borderRadius: 999 }}>
          Shortlist <span className="font-mono text-pitch-dark">{shortlistIds.length}</span> · saved on this device
        </div>
      </nav>
    </header>
  );
}
