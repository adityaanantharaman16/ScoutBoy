import Link from "next/link";

import { ConfidenceMeter } from "@/components/player/ConfidenceMeter";
import {
  confidenceColor,
  confidenceLabel,
  confidenceText,
  evidenceStatusText,
  formatScore,
  marketLabelColor,
  marketLabelText,
  scoreBarClass,
  scoreColor,
} from "@/lib/formatters";
import { marketRangeText } from "@/lib/market/marketChart";

export { ConfidenceMeter } from "@/components/player/ConfidenceMeter";

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
    <span
      className={`chip ${confidenceColor(confidence)}`}
      title={confidenceLabel(confidence)}
      aria-label={confidenceLabel(confidence)}
    >
      {confidenceText(confidence)}
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
  fill,
}: {
  number: string;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  /** When true, the section fills its container height so its card can stretch. */
  fill?: boolean;
}) {
  return (
    <section className={`mb-8 ${fill ? "flex h-full flex-col" : ""}`}>
      <div className="section-rule mb-3 flex items-end justify-between gap-3 pb-2">
        <div>
          <div className="label mb-1">{number} / {eyebrow ?? "ScoutBoy dossier"}</div>
          <h2 className="font-serif text-2xl font-bold leading-tight text-ink">{title}</h2>
        </div>
        {action}
      </div>
      {fill ? <div className="flex flex-1 flex-col">{children}</div> : children}
    </section>
  );
}

export function StatBar({ score }: { score: number | null | undefined }) {
  if (score == null) {
    return <span className="text-xs text-ink-soft">unknown</span>;
  }
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="h-2 w-full overflow-hidden bg-track">
      <div className={`h-full ${scoreBarClass(score)}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="py-10 text-center text-sm font-semibold text-ink-soft">
      {label}
    </div>
  );
}

export function EmptyState({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 border border-line bg-paper-panel px-4 py-10 text-center text-sm text-ink-soft"
      style={{ borderRadius: 6 }}
    >
      <span>{label}</span>
      {action}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="border border-accent-red/50 bg-[#f4e8e3] px-4 py-6 text-center text-sm font-semibold text-accent-red"
      style={{ borderRadius: 6 }}
    >
      <span className="mr-1" aria-hidden="true">
        ⚠
      </span>
      {message}
    </div>
  );
}

/**
 * Structural loading placeholder for a ledger/table pane. It preserves the
 * page's layout while the data resolves (so the page header/filters stay put)
 * without fabricating any values — the bars are neutral track colour, never
 * numbers or names. A polite live region announces the load to assistive tech.
 */
export function LedgerSkeleton({
  rows = 5,
  label = "Loading…",
  testId = "ledger-skeleton",
}: {
  rows?: number;
  label?: string;
  testId?: string;
}) {
  return (
    <div role="status" aria-live="polite" data-testid={testId}>
      <span className="sr-only">{label}</span>
      <div className="border border-line bg-paper-panel" style={{ borderRadius: 6 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            aria-hidden="true"
            className={`flex items-center gap-4 px-3 py-3.5 ${i < rows - 1 ? "border-b border-line" : ""}`}
          >
            <div className="h-3 w-5 bg-track" />
            <div className="h-3 flex-1 bg-track" />
            <div className="hidden h-3 w-20 bg-track sm:block" />
            <div className="h-3 w-14 bg-track" />
          </div>
        ))}
      </div>
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
    <div
      className={`border px-4 py-3 text-sm ${toneClass}`}
      style={{ borderRadius: 6 }}
      data-testid={testId}
      role={tone === "critical" ? "alert" : undefined}
    >
      <div className="font-semibold text-ink">{title}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared cross-surface readouts
//
// A few narrow, semantic primitives — NOT a universal card. Each keeps the four
// evidence channels visually distinct and honest: score magnitude, RoleFit
// confidence (monochrome glyph), evidence coverage, and market uncertainty.
// Every surface composes these into its own layout; the treatment is shared,
// the structure is not. All are flat + hairline; elevation stays reserved for
// Role Territory.
// ---------------------------------------------------------------------------

/** Shared page introduction + optional right-aligned control and metadata line. */
export function PageHeader({
  eyebrow,
  title,
  lead,
  meta,
  aside,
  className = "",
}: {
  eyebrow: string;
  title: string;
  lead?: React.ReactNode;
  meta?: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={`mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="max-w-3xl">
        <p className="label mb-1">{eyebrow}</p>
        <h1 className="font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">{title}</h1>
        {lead && <p className="mt-2 text-sm text-ink-muted">{lead}</p>}
        {meta && (
          <p className="mt-2 text-xs text-ink-soft" data-testid="page-meta">
            {meta}
          </p>
        )}
      </div>
      {aside && <div className="shrink-0 sm:min-w-[240px]">{aside}</div>}
    </header>
  );
}

/**
 * Band-coloured score magnitude. The numeric value is the signal; colour only
 * emphasises it. Missing scores render the formatter sentinel ("—"), never zero.
 */
export function ScoreReadout({
  score,
  caption,
  variant = "serif",
  size = "lg",
  className = "",
}: {
  score: number | null | undefined;
  caption?: string | null;
  variant?: "serif" | "mono";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeCls = size === "lg" ? "text-3xl" : size === "md" ? "text-2xl" : "text-lg";
  const fontCls = variant === "serif" ? "font-serif" : "mono";
  return (
    <div className={className} data-testid="score-readout">
      <div className={`${fontCls} ${sizeCls} font-bold leading-none ${scoreColor(score)}`}>
        {formatScore(score)}
      </div>
      {caption != null && caption !== "" && (
        <div className="mt-1 text-[11px] text-ink-soft">{caption}</div>
      )}
    </div>
  );
}

/** RoleFit confidence in its own monochrome channel, with an explicit label. */
export function ConfidenceReadout({
  level,
  score,
  label = "RoleFit confidence",
  layout = "inline",
  className = "",
}: {
  level: string | null | undefined;
  score?: number | null;
  label?: string | null;
  layout?: "inline" | "stacked";
  className?: string;
}) {
  if (layout === "stacked") {
    return (
      <div className={className} data-testid="confidence-readout">
        {label && <div className="label mb-1">{label}</div>}
        <ConfidenceMeter level={level} score={score ?? undefined} />
      </div>
    );
  }
  return (
    <span
      className={`inline-flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted ${className}`}
      data-testid="confidence-readout"
    >
      {label && <span>{label}:</span>}
      <ConfidenceMeter level={level} score={score ?? undefined} />
    </span>
  );
}

/** Evidence-coverage label — a channel distinct from RoleFit confidence. */
export function EvidenceTag({
  status,
  showLabel = true,
  className = "",
}: {
  status: string | null | undefined;
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted ${className}`}
      data-testid="evidence-tag"
    >
      {showLabel && <span>Evidence:</span>}
      <span className="chip border-line-strong bg-paper-muted text-ink-muted">
        {evidenceStatusText(status)}
      </span>
    </span>
  );
}

/**
 * Honest market readout: a label chip plus the expected-asking range. Partial
 * ranges are preserved ("From €X" / "Up to €Y") and a missing endpoint is never
 * rendered as €0 (see {@link marketRangeText}).
 */
export function MarketReadout({
  label,
  low,
  high,
  layout = "inline",
  className = "",
}: {
  label: string | null | undefined;
  low: number | null | undefined;
  high: number | null | undefined;
  layout?: "inline" | "stacked";
  className?: string;
}) {
  const range = marketRangeText(low, high);
  if (layout === "stacked") {
    return (
      <div className={className} data-testid="market-readout">
        <div className="label mb-1">Expected asking</div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`chip ${marketLabelColor(label)}`}>{marketLabelText(label)}</span>
          <span className="mono text-sm text-ink">{range}</span>
        </div>
      </div>
    );
  }
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`} data-testid="market-readout">
      <span className={`chip ${marketLabelColor(label)}`}>{marketLabelText(label)}</span>
      <span className="mono text-xs text-ink-muted">{range}</span>
    </span>
  );
}
