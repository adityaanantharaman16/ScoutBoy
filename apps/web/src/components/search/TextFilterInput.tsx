"use client";

import { parseTextFilter } from "@/lib/filters";

import { useEditDraft } from "./useEditDraft";

/**
 * One free-text Discovery predicate: Search, League, Club or Nationality.
 *
 * The value that reaches the URL, the request and the readable active-criteria
 * summary is always the TRIMMED one, so a stray leading or trailing space cannot
 * become part of a literal substring predicate that then matches nothing. What the
 * user sees while typing is their own raw text, held by {@link useEditDraft} — which
 * is what lets " " between two words survive long enough to become "Paris Saint-
 * Germain" instead of being normalized away a keystroke at a time.
 *
 * Whitespace-only input clears the predicate rather than sending a needle no stored
 * value can contain.
 */
export function TextFilterInput({
  label,
  testId,
  value,
  onCommit,
  placeholder,
  describedBy,
  className = "input",
}: {
  label: string;
  testId: string;
  /** The canonical, already-trimmed predicate, or `undefined` when unset. */
  value: string | undefined;
  onCommit: (next: string | undefined) => void;
  placeholder?: string;
  describedBy?: string;
  className?: string;
}) {
  const draft = useEditDraft(value);

  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="label">{label}</span>
      <input
        data-testid={testId}
        className={className}
        placeholder={placeholder}
        aria-describedby={describedBy}
        value={draft.raw ?? value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          const next = parseTextFilter(raw);
          draft.hold(raw, next);
          onCommit(next);
        }}
        // Leaving the field settles it on exactly what the URL holds, so a trailing
        // space is visibly gone rather than lingering as a state nothing else shares.
        onBlur={() => draft.release()}
      />
    </label>
  );
}
