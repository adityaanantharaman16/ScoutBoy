"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { SAVED_LABEL_MAX } from "@/lib/filters/canonical";

/**
 * The one naming surface for saved work: Save View, Save Comparison, and rename.
 *
 * A compact anchored panel rather than a modal, and non-modal on purpose. A
 * naming prompt does not need to take the page hostage, and a real modal brings a
 * focus trap, an inert background and a scroll lock — three mechanisms that each
 * have their own failure modes — in exchange for nothing this interaction needs.
 * `role="dialog"` without `aria-modal` is exactly what a non-modal dialog is.
 *
 * What it does guarantee:
 *
 *   * focus moves to the text field when it opens, and the whole existing name is
 *     selected so a rename is one keystroke;
 *   * Escape closes it and returns focus to the control that opened it;
 *   * Cancel and submit do the same;
 *   * a pointer press outside closes it, and does NOT steal focus, so clicking
 *     into the page continues to do what the click meant;
 *   * every control has a visible text label — no icon-only actions;
 *   * it is positioned relative to its trigger, so it never consumes layout space
 *     when closed and cannot push the page around when it opens.
 *
 * Geometry is the established one: hairline border, panel background, 90-degree
 * corners, existing spacing tokens. No shadow, no radius, no pill.
 */
export function NamePanel({
  open,
  title,
  submitLabel,
  initialValue = "",
  description,
  busy = false,
  error,
  onSubmit,
  onClose,
  testId,
}: {
  open: boolean;
  /** The dialog's accessible name, e.g. "Save this Discovery view". */
  title: string;
  /** The submit button's visible text, Title Case, e.g. "Save View". */
  submitLabel: string;
  initialValue?: string;
  /** One short line above the field, when the action needs explaining. */
  description?: React.ReactNode;
  busy?: boolean;
  error?: string | null;
  onSubmit: (label: string) => void;
  onClose: () => void;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [value, setValue] = useState(initialValue);
  const fieldId = useId();
  const describedById = useId();

  // Re-seed whenever the panel opens, so a cancelled edit does not persist into
  // the next one and a rename always starts from the CURRENT name.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setValue(initialValue);
  }

  useEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [open]);

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    // Pointer, not click: a press that starts outside should dismiss even if the
    // pointer is released elsewhere, and `pointerdown` fires before focus moves,
    // so the element the user is reaching for still receives it.
    const onPointerDown = (event: PointerEvent) => {
      const panel = panelRef.current;
      if (panel && event.target instanceof Node && !panel.contains(event.target)) close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  if (!open) return null;

  const trimmed = value.trim();
  const tooLong = trimmed.length > SAVED_LABEL_MAX;
  const invalid = trimmed.length === 0 || tooLong;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      /*
       * Positioned by the trigger's wrapper.
       *
       * `z-30` sits below the bottom rail's `z-40`, so an open panel can never
       * cover the compare tray.
       *
       * LEFT-anchored below `sm`, right-anchored above it, because that is where
       * the trigger actually is at each width. Every surface that opens this
       * panel stacks its controls to the left on mobile and to the right from
       * `sm` up (the Discovery heading's control slot, Compare's selector card,
       * and a saved row's action rail all do). A permanently right-anchored panel
       * therefore hung ~290px off the LEFT edge of a 320px viewport - which does
       * not grow `scrollWidth`, so it is invisible to an overflow check and simply
       * clips the field a scout is trying to type into.
       */
      className="absolute left-0 top-full z-30 mt-1 w-[min(20rem,calc(100vw-2rem))] border border-line-strong bg-paper-panel p-3 text-left sm:left-auto sm:right-0"
      data-testid={testId}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (invalid || busy) return;
          onSubmit(trimmed);
        }}
      >
        <label className="label mb-1 block" htmlFor={fieldId}>
          {title}
        </label>
        {description && (
          <p className="mb-2 text-xs text-ink-soft" id={describedById}>
            {description}
          </p>
        )}
        <input
          ref={inputRef}
          id={fieldId}
          type="text"
          className="input w-full"
          value={value}
          maxLength={SAVED_LABEL_MAX}
          // The browser's own required/length messaging is suppressed in favour of
          // the explicit, always-visible counter and error text below, so one
          // message is shown rather than two competing ones.
          aria-describedby={description ? describedById : undefined}
          aria-invalid={tooLong || undefined}
          onChange={(event) => setValue(event.target.value)}
          data-testid={testId ? `${testId}-input` : undefined}
        />
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-ink-soft">
          <span>
            {trimmed.length}/{SAVED_LABEL_MAX}
          </span>
          {error && (
            <span className="text-accent-red" role="alert" data-testid={testId ? `${testId}-error` : undefined}>
              {error}
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="submit"
            className="btn btn-primary px-3 py-2 text-xs"
            disabled={invalid || busy}
            data-testid={testId ? `${testId}-submit` : undefined}
          >
            {busy ? "Saving…" : submitLabel}
          </button>
          <button
            type="button"
            className="btn px-3 py-2 text-xs"
            onClick={close}
            data-testid={testId ? `${testId}-cancel` : undefined}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * A deliberate, accessible two-step removal.
 *
 * Never `window.confirm`: it is unstyleable, it blocks the whole page, its
 * wording cannot say what is being removed, and it is announced as a browser
 * chrome dialog rather than as part of the application. This is the same decision
 * expressed in the product's own controls — the action's accessible name states
 * exactly what will be removed, and it takes two deliberate presses.
 *
 * The armed state auto-disarms on blur, so a control left half-pressed does not
 * sit there waiting to delete something on the next Enter.
 */
export function ConfirmRemoveButton({
  what,
  onConfirm,
  testId,
}: {
  /** What is being removed, in words — becomes part of the accessible name. */
  what: string;
  onConfirm: () => void;
  testId?: string;
}) {
  const [armed, setArmed] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!armed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setArmed(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        className="rail-action"
        aria-label={`Remove ${what}`}
        data-testid={testId}
        onClick={() => setArmed(true)}
      >
        Remove
      </button>
    );
  }

  return (
    <span
      ref={wrapperRef}
      className="inline-flex items-stretch"
      onBlur={(event) => {
        // Only when focus genuinely left this pair, not when it moved between the
        // two buttons inside it.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setArmed(false);
      }}
    >
      <button
        type="button"
        className="rail-action text-accent-red"
        aria-label={`Confirm removing ${what}`}
        data-testid={testId ? `${testId}-confirm` : undefined}
        // Focus follows the arming press, so a keyboard user lands on the
        // confirmation rather than having to hunt for it.
        autoFocus
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        Confirm
      </button>
      <button
        type="button"
        className="rail-action"
        aria-label={`Cancel removing ${what}`}
        data-testid={testId ? `${testId}-cancel` : undefined}
        onClick={() => setArmed(false)}
      >
        Cancel
      </button>
    </span>
  );
}
