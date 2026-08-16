"use client";

import { askingMillionsInput, classifyAskingDraft } from "@/lib/filters";

import { useEditDraft } from "./useEditDraft";

/**
 * One expected-asking bound, typed in EUR millions over an absolute-EUR contract.
 *
 * ---- why this is not a plain controlled `<input type="number">` ----------------
 * It was, and sequential typing did not survive it. Every keystroke re-derived the
 * field from the canonical URL value, so the intermediate `"12."` a user passes
 * through on the way to `12.5` was rewritten as `"12"` by the browser's own number
 * sanitization before the `5` could be typed. `fill("12.5")` hid the defect — it sets
 * the whole value at once — which is why the regression test presses one key at a
 * time.
 *
 * So the control keeps a **raw text draft** while it is being edited, and derives its
 * value from the URL only when it is not. Two states, one rule for choosing between
 * them:
 *
 * * `draft.from` records the canonical value the draft was synchronized with. While
 *   they agree the draft wins, so the user's own text is never rewritten under them.
 * * When the incoming canonical value differs from `draft.from`, something OTHER than
 *   this control changed it — Clear All, removing the criterion, back/forward, a hard
 *   load, or the companion bound being pushed by the coherent min/max rule — and the
 *   draft is dropped so the field converges on the URL. That is the same
 *   adjust-state-during-render pattern the age slider uses for its own echo.
 * * Blur drops the draft too, so a half-typed or malformed value cannot persist as a
 *   visible state the URL does not share.
 *
 * `type="text"` with `inputMode="decimal"` rather than `type="number"`: the numeric
 * keypad is what a phone needs, and the browser's value sanitization is precisely the
 * thing that was destroying intermediate decimals. Validity is enforced here instead,
 * where it can distinguish "clear this bound" from "do not send this yet".
 */
export function AskingPriceInput({
  label,
  testId,
  describedBy,
  valueEur,
  onCommit,
}: {
  label: React.ReactNode;
  testId: string;
  describedBy: string;
  /** The canonical bound in absolute EUR, or `undefined` for no bound. */
  valueEur: number | undefined;
  /** Called with absolute EUR, or `undefined` to clear. Never called for junk. */
  onCommit: (eur: number | undefined) => void;
}) {
  const draft = useEditDraft(valueEur);

  const shown = draft.raw ?? askingMillionsInput(valueEur);
  const invalid = draft.raw != null && classifyAskingDraft(draft.raw).kind === "invalid";

  const onChange = (raw: string) => {
    const parsed = classifyAskingDraft(raw);
    // The draft records what the canonical value WILL be once this change is
    // applied, so `useEditDraft` does not mistake this control's own commit for an
    // outside change and throw the text away.
    if (parsed.kind === "value") {
      draft.hold(raw, parsed.eur);
      onCommit(parsed.eur);
    } else if (parsed.kind === "blank") {
      draft.hold(raw, undefined);
      onCommit(undefined);
    } else {
      // Malformed: keep the text on screen, send nothing. The URL and the request
      // keep whatever they last agreed on.
      draft.hold(raw, valueEur);
    }
  };

  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="label">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        data-testid={testId}
        className="input"
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        value={shown}
        onChange={(e) => onChange(e.target.value)}
        // Leaving the field is the moment the draft stops being useful: whatever the
        // URL holds is the truth, and a malformed leftover snaps back to it.
        onBlur={() => draft.release()}
      />
    </label>
  );
}
