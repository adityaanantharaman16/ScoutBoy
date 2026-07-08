import Link from "next/link";

const LINKS = [
  { href: "/", label: "Search" },
  { href: "/roles/touchline_winger", label: "Leaderboards" },
  { href: "/compare", label: "Compare" },
  { href: "/methodology", label: "Methodology" },
];

export function NavBar() {
  return (
    <header className="border-b border-white/10 bg-pitch-800/70 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Scout<span className="text-accent">Boy</span>
        </Link>
        <div className="flex gap-4 text-sm text-slate-300">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-accent-soft" data-testid={`nav-${l.label.toLowerCase()}`}>
              {l.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
