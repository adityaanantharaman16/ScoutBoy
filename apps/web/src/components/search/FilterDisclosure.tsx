"use client";

/**
 * The one disclosure control in the Discovery rail.
 *
 * Advanced Filters, each of its three categories, and the active-criteria
 * summary are all this component, so the rail grows one repeated shape rather
 * than three separate inventions. It is a real `<button>`: Enter and Space are
 * the platform's, `:focus-visible` is the product's shared 2px green ring, and
 * `aria-expanded` / `aria-controls` describe the region it owns.
 *
 * Geometry is a square, full-width, 44px row (`.filter-disclosure`), with a
 * shorter, quieter variant for a nested category header. Nothing here rounds a
 * corner, floats, or animates a dimension: the open state is carried by an inset
 * marker and the glyph, exactly as the age-direction segments and the ledger
 * action rail already do it.
 */
export function FilterDisclosure({
  controls,
  label,
  open,
  onToggle,
  count = 0,
  level = "primary",
  testId,
}: {
  /** `id` of the region this control expands. Always present in the DOM, so the
   *  reference resolves whether the region is open or closed. */
  controls: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  /** Active criteria inside the region. Rendered, and spoken, only when nonzero. */
  count?: number;
  level?: "primary" | "sub";
  testId: string;
}) {
  return (
    <button
      type="button"
      className={`filter-disclosure${level === "sub" ? " filter-disclosure-sub" : ""}`}
      aria-expanded={open}
      aria-controls={controls}
      // The visible label is the first thing in this name (WCAG 2.5.3 Label in
      // Name), and the count is spoken rather than left as a bare numeral.
      aria-label={count > 0 ? `${label}, ${count} active` : label}
      data-testid={testId}
      onClick={onToggle}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={level === "sub" ? "label" : "text-sm font-bold tracking-tight"}>
          {label}
        </span>
        {count > 0 && (
          <span className="filter-disclosure-count" data-testid={`${testId}-count`}>
            {count}
          </span>
        )}
      </span>
      {/* Decorative: the state is already carried by `aria-expanded`. */}
      <span className="filter-disclosure-glyph" aria-hidden="true">
        {open ? "−" : "+"}
      </span>
    </button>
  );
}
