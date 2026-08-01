import { confidenceColor, marketLabelColor } from "@/lib/formatters";

// ---------------------------------------------------------------------------
// The semantic display-tag contract
//
// Every non-interactive label tag in ScoutBoy renders through this primitive, so
// the same fact looks the same on every surface and stays consistent when reused
// by future functionality.
//
// Rules for call sites:
//   1. New display tags MUST use `DisplayTag` (or `displayTagClass` when the tag
//      needs bespoke ARIA, as the two compound ledger units do).
//   2. Call sites choose a semantic MEANING (`variant`), never a colour. There is
//      deliberately no `className`/colour escape hatch — a new colour requires a
//      new variant here, reviewed once, rather than a per-page combination.
//   3. Playstyles are always the dark filled treatment, whatever their tier.
//   4. Market and concern colours carry meaning and must not be reused for
//      decoration.
//   5. Interactive controls (role tabs, filters, age bands, navigation, action
//      buttons, favourite/compare) are NOT display tags. They keep their own
//      component styles. Do not migrate them here.
//
// Geometry (square 90-degree corners, padding, border, weight, inline-flex, wrap
// behaviour) is owned centrally by `.display-tag` in globals.css, in line with
// the product-wide sharp-corner system.
// ---------------------------------------------------------------------------

export type TagVariant =
  /** Player trait. Always ink-filled with paper text, for every tier. */
  | "playstyle"
  /** Flagged risk. Warning styling — never mistakable for a playstyle. */
  | "concern"
  /** Market valuation state; tone comes from the label's established meaning. */
  | "market"
  /** Positive role distinction: "Best", "Best-Rated Role". */
  | "role-status"
  /** RoleFit confidence word; a separate fact from score magnitude. */
  | "confidence"
  /** Evidence/coverage availability; a separate fact from confidence. */
  | "evidence"
  /** Restrained system/metadata status. */
  | "neutral";

/** Value-independent tones. Market and confidence derive theirs from the value. */
const TONE: Record<Exclude<TagVariant, "market" | "confidence">, string> = {
  playstyle: "border-ink bg-ink text-paper",
  concern: "border-accent-red bg-[#f4e8e3] text-accent-red",
  "role-status": "border-pitch bg-[#e9f0ea] text-pitch-dark",
  evidence: "border-line-strong bg-paper-muted text-ink-muted",
  neutral: "border-line bg-paper-muted text-ink-muted",
};

/**
 * The class string for a semantic tag. Exported for the two compound ledger
 * units, which supply their own grouping ARIA and data attributes but must not
 * own their geometry or colour.
 */
export function displayTagClass(
  variant: TagVariant,
  value?: string | null,
  compound = false,
): string {
  const tone =
    variant === "market"
      ? marketLabelColor(value)
      : variant === "confidence"
      ? confidenceColor(value)
      : TONE[variant];
  return `display-tag${compound ? " display-tag-compound" : ""} ${tone}`;
}

/**
 * A non-interactive semantic label. Renders a plain `<span>`: no button
 * semantics, no tab stop. `title`/`ariaLabel` are passed through because several
 * tags carry extra meaning there (a playstyle's `why_applied`, a confidence
 * word's full sentence).
 */
export function DisplayTag({
  variant,
  value,
  compound = false,
  children,
  title,
  ariaLabel,
  testId,
}: {
  variant: TagVariant;
  /** The raw enum whose established colour this tag must keep (market/confidence). */
  value?: string | null;
  /** Two facts inside one box. Only for layouts that genuinely need it. */
  compound?: boolean;
  children: React.ReactNode;
  title?: string;
  ariaLabel?: string;
  testId?: string;
}) {
  return (
    <span
      className={displayTagClass(variant, value, compound)}
      data-tag-variant={variant}
      data-tag-value={value ?? undefined}
      title={title || undefined}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {children}
    </span>
  );
}
