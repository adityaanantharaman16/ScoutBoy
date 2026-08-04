import Link from "next/link";
import { Fragment } from "react";

import { DisplayTag, displayTagClass } from "@/components/common/DisplayTag";
import { ConfidenceMeter } from "@/components/player/ConfidenceMeter";
import {
  confidenceLabel,
  confidenceText,
  evidenceStatusText,
  formatScore,
  marketLabelText,
  scoreBarClass,
  scoreColor,
} from "@/lib/formatters";
import { marketRangeText } from "@/lib/market/marketChart";

export { ConfidenceMeter } from "@/components/player/ConfidenceMeter";
export { DisplayTag, displayTagClass, type TagVariant } from "@/components/common/DisplayTag";

export function ScopeBanner({ text }: { text: string }) {
  return (
    <div
      data-testid="scope-banner"
      className="mb-5 border border-line-strong bg-paper-panel px-3 py-2 text-sm text-ink-muted"
    >
      {text}
    </div>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: string | null | undefined }) {
  return (
    <DisplayTag
      variant="confidence"
      value={confidence}
      title={confidenceLabel(confidence)}
      ariaLabel={confidenceLabel(confidence)}
    >
      {confidenceText(confidence)}
    </DisplayTag>
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
          <h2 className="text-2xl font-bold leading-tight tracking-tight text-ink">{title}</h2>
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
          <h2 className="text-2xl font-bold leading-tight tracking-tight text-ink">{title}</h2>
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
      // Same restrained pane settle as a populated result — an empty result IS a
      // result. Deliberately nothing theatrical: opacity only, no movement, no
      // separate treatment that would dramatise the absence of players. The
      // `role="status"` text is in the DOM at mount, so the announcement is never
      // delayed by the visual settle.
      className="pane-enter flex flex-col items-center gap-3 border border-line bg-paper-panel px-4 py-10 text-center text-sm text-ink-soft"
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
      // The same pane settle, and nothing more: an error is not dramatised. The
      // `role="alert"` content is present at mount, so assistive tech announces it
      // immediately regardless of the opacity animation.
      className="pane-enter border border-accent-red/50 bg-[#f4e8e3] px-4 py-6 text-center text-sm font-semibold text-accent-red"
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
      <div className="border border-line bg-paper-panel">
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
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">{title}</h1>
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
 * Renders text so a line break can only fall on a space: every space-delimited
 * token is non-wrapping, which keeps hyphenated role names ("Deep-Lying",
 * "Ball-Winning") intact — browsers otherwise treat a hyphen as a break
 * opportunity. Nothing is truncated and the rendered text content is identical to
 * the input, so the accessible name is preserved.
 */
function WordBoundaryText({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((word, i) => (
        <Fragment key={`${i}-${word}`}>
          {i > 0 ? " " : null}
          <span className="whitespace-nowrap">{word}</span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Band-coloured score magnitude. The numeric value is the signal; colour only
 * emphasises it. Missing scores render the formatter sentinel ("—"), never zero.
 *
 * `variant="sans"` (the default) is the proportional Inter treatment, tightened so
 * a large figure still reads as the row's hero; `variant="mono"` keeps the
 * deliberately tabular presentation. `captionWrap="words"` is opt-in: it
 * constrains the caption to word-boundary wrapping for the fixed-width ledger
 * RoleFit track.
 */
export function ScoreReadout({
  score,
  caption,
  captionWrap = "normal",
  variant = "sans",
  size = "lg",
  className = "",
}: {
  score: number | null | undefined;
  caption?: string | null;
  captionWrap?: "normal" | "words";
  variant?: "sans" | "mono";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeCls = size === "lg" ? "text-3xl" : size === "md" ? "text-2xl" : "text-lg";
  const fontCls = variant === "sans" ? "tracking-tight" : "mono";
  return (
    <div className={className} data-testid="score-readout">
      <div className={`${fontCls} ${sizeCls} font-bold leading-none ${scoreColor(score)}`}>
        {formatScore(score)}
      </div>
      {caption != null && caption !== "" && (
        <div className="mt-1 text-[11px] text-ink-soft" data-testid="score-caption">
          {captionWrap === "words" ? <WordBoundaryText text={caption} /> : caption}
        </div>
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
      <DisplayTag variant="evidence" value={status}>
        {evidenceStatusText(status)}
      </DisplayTag>
    </span>
  );
}

/**
 * Honest market readout: a label chip plus the expected-asking range. Partial
 * ranges are preserved ("From €X" / "Up to €Y") and a missing endpoint is never
 * rendered as €0 (see {@link marketRangeText}).
 *
 * The `ledger` layout is the shared ledger-row variant used by discovery and My
 * Favorites: risk label and price inside one sharp status box at equal weight.
 * `inline`/`stacked` are unchanged, so comparison, the leaderboard and the dossier
 * keep their own readouts.
 *
 * `align="end"` mirrors the `inline` layout for a right-aligned column, so the
 * risk tag sits against the outer edge and the range reads inward — the mirror
 * image of the left column rather than a repeat of it. Label and range never
 * split across lines, however wide the figures get.
 */
export function MarketReadout({
  label,
  low,
  high,
  layout = "inline",
  align = "start",
  className = "",
}: {
  label: string | null | undefined;
  low: number | null | undefined;
  high: number | null | undefined;
  layout?: "inline" | "stacked" | "ledger";
  /** `inline` only: which edge the risk tag hugs once the columns sit side by side. */
  align?: "start" | "end";
  className?: string;
}) {
  const range = marketRangeText(low, high);
  if (layout === "ledger") {
    // Compound label-and-range box: one tag, two facts at equal weight. Uses the
    // shared tag geometry/tone via the helper because it carries its own
    // market-label data attribute.
    return (
      <span
        className={`${displayTagClass("market", label, true)} ${className}`}
        data-tag-variant="market"
        data-testid="market-readout"
        data-market-label={label ?? "unknown"}
      >
        <span>{marketLabelText(label)}</span>
        <span aria-hidden="true">·</span>
        {/* Monospace for figure alignment only — same size and weight as the label. */}
        <span className="mono">{range}</span>
      </span>
    );
  }
  if (layout === "stacked") {
    return (
      <div className={className} data-testid="market-readout">
        <div className="label mb-1">Expected asking</div>
        <div className="flex flex-wrap items-center gap-2">
          <DisplayTag variant="market" value={label}>
            {marketLabelText(label)}
          </DisplayTag>
          <span className="mono text-sm text-ink">{range}</span>
        </div>
      </div>
    );
  }
  // No `flex-wrap` and a non-breaking range: the tag and the figures stay on one
  // line together even for the widest asking ranges. `flex-row-reverse` mirrors
  // the visual order for an end-aligned column while the DOM order (label, then
  // range) stays the same on both sides and when the columns stack on mobile.
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${
        align === "end" ? "sm:flex-row-reverse" : ""
      } ${className}`}
      data-testid="market-readout"
      data-market-align={align}
    >
      <DisplayTag variant="market" value={label}>
        {marketLabelText(label)}
      </DisplayTag>
      <span className="mono whitespace-nowrap text-xs text-ink-muted">{range}</span>
    </span>
  );
}
