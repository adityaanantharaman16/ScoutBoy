import Link from "next/link";

import { confidenceColor, confidenceLabel } from "@/lib/formatters";

export function ScopeBanner({ text }: { text: string }) {
  return (
    <div
      data-testid="scope-banner"
      className="mb-5 border border-line-strong bg-paper-panel px-3 py-2 text-sm text-ink-muted"
      style={{ borderRadius: 5 }}
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
  eyebrow,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <section className="mb-7">
      <div className="section-rule mb-3 flex items-end justify-between gap-3 pb-2">
        <div>
          {eyebrow && <div className="label mb-1">{eyebrow}</div>}
          <h2 className="font-serif text-2xl font-bold leading-tight text-ink">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function DossierSection({
  number,
  title,
  eyebrow,
  children,
  action,
}: {
  number: string;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="section-rule mb-3 flex items-end justify-between gap-3 pb-2">
        <div>
          <div className="label mb-1">{number} / {eyebrow ?? "ScoutBoy dossier"}</div>
          <h2 className="font-serif text-2xl font-bold leading-tight text-ink">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StatBar({ score }: { score: number | null | undefined }) {
  if (score == null) {
    return <span className="text-xs text-ink-soft">unknown</span>;
  }
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-track">
      <div className="h-full rounded-full bg-pitch" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="py-10 text-center text-sm font-semibold text-ink-soft">{label}</div>;
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="border border-line bg-paper-panel py-10 text-center text-sm text-ink-soft" style={{ borderRadius: 6 }}>
      {label}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="border border-accent-red/50 bg-[#f4e8e3] py-6 text-center text-sm font-semibold text-accent-red" style={{ borderRadius: 6 }}>
      {message}
    </div>
  );
}

export function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="btn no-underline"
    >
      {children}
    </Link>
  );
}

export function Notice({
  title,
  children,
  tone = "neutral",
  testId,
}: {
  title: string;
  children: React.ReactNode;
  tone?: "neutral" | "caution" | "critical";
  testId?: string;
}) {
  const toneClass =
    tone === "critical"
      ? "border-accent-red/50 bg-[#f4e8e3] text-accent-red"
      : tone === "caution"
      ? "border-accent-amber/50 bg-[#f6ecd7] text-accent-amber"
      : "border-line-strong bg-paper-panel text-ink-muted";
  return (
    <div className={`border px-4 py-3 text-sm ${toneClass}`} style={{ borderRadius: 6 }} data-testid={testId}>
      <div className="font-semibold text-ink">{title}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
