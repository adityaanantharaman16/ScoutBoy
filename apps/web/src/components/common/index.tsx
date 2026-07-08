import Link from "next/link";

import { confidenceColor, confidenceLabel } from "@/lib/formatters";

export function ScopeBanner({ text }: { text: string }) {
  return (
    <div
      data-testid="scope-banner"
      className="mb-4 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent-soft"
    >
      {text}
    </div>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: string | null | undefined }) {
  return (
    <span className={`chip ${confidenceColor(confidence)}`} title={confidenceLabel(confidence)}>
      {confidence ?? "unknown"}
    </span>
  );
}

export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StatBar({ score }: { score: number | null | undefined }) {
  if (score == null) {
    return <span className="text-xs text-slate-500">unknown</span>;
  }
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-white/10">
      <div className="h-full rounded bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="py-10 text-center text-slate-400">{label}</div>;
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-pitch-800/40 py-10 text-center text-slate-400">
      {label}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-rose-500/40 bg-rose-500/10 py-6 text-center text-rose-200">
      {message}
    </div>
  );
}

export function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm hover:border-accent/50 hover:text-accent-soft"
    >
      {children}
    </Link>
  );
}
