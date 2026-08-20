"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MOTION_EXIT_MS, usePresence } from "@/lib/motion/presence";
import { useAuthSession } from "@/lib/auth/session";
import { isSuppressed, recordDismissal } from "@/lib/auth/suggestion-state";
import { useScoutingState } from "@/lib/state/scouting-state";

/**
 * Once per browser session, tracked in `sessionStorage` rather than in a module
 * variable so a page reload does not re-offer it. A plain marker string: there is
 * no shape to corrupt, and an unreadable store simply means the suggestion may
 * appear once more, which is harmless.
 */
const SESSION_KEY = "scoutboy.accountSuggestion.session.v1";

function shownThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markShownThisSession(): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* private mode: at worst it is offered again next session */
  }
}

/**
 * A restrained, non-modal offer shown to a guest who has just saved a player.
 *
 * What it is NOT: a modal, a paywall, a gate, or a reason the favourite did not
 * happen. The save completes first and completely; this appears afterwards and
 * changes nothing about it. Everything in ScoutBoy stays usable while it is on
 * screen, and closing it costs one key press.
 *
 * Where it sits: the bottom rail, stacked above the compare tray rather than
 * over it (see `providers.tsx`). That boundary is already the product's home for
 * transient, spatially anchored surfaces, so this introduces no new region and
 * no new geometry — and because it is anchored rather than in flow, the favourite
 * control the user just pressed does not move a pixel when it appears.
 *
 * When it appears, precisely:
 *   - a GUEST added a player they had not saved before (`guestSaveSignal`), and
 *   - this build offers accounts, and
 *   - nobody is signed in, and
 *   - it has not already been shown this browser session, and
 *   - no explicit "Not now" is inside its cooling-off window.
 *
 * Which means: never on load, never after a removal, never merely because saved
 * players exist, never for an account holder, never in an auth-free build, and
 * never from Compare — the comparison queue is not account-synchronized in this
 * phase, so offering an account there would be promising something untrue.
 */
export function AccountSuggestion() {
  const { effectiveStatus, enabled, openSignIn, openSignUp } = useAuthSession();
  const { favorites } = useScoutingState();
  const [open, setOpen] = useState(false);
  // `effectiveStatus`, so this agrees with the counter and the header rather
  // than running its own idea of whether the session is known. A provider that
  // never answered reports `unavailable`, which is NOT eligible: offering to
  // create an account through a provider that cannot load would be an empty
  // promise.
  const eligible = enabled && effectiveStatus === "anonymous";
  // Derived, not synchronised through an effect: an account arriving by ANY
  // route (sign-in here, sign-in in another tab, a session restored on load)
  // retires the offer in the same render it becomes ineligible, with no
  // cascading commit and no window where an account holder can see it.
  const { visible, leaving } = usePresence(open && eligible, MOTION_EXIT_MS);

  const containerRef = useRef<HTMLElement | null>(null);
  /**
   * Whatever had focus when the offer appeared — in practice the favourite
   * control that was just pressed. Restoring to it on dismissal means a keyboard
   * user is returned exactly where they were, instead of being dropped on
   * `document.body`.
   */
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const lastSignal = useRef<number | null>(null);

  useEffect(() => {
    // The first observed value is the baseline, never a trigger: mounting with a
    // signal already at 3 must not open anything.
    if (lastSignal.current === null) {
      lastSignal.current = favorites.guestSaveSignal;
      return;
    }
    if (favorites.guestSaveSignal === lastSignal.current) return;
    lastSignal.current = favorites.guestSaveSignal;

    if (!eligible) return;
    if (shownThisSession()) return;
    if (isSuppressed()) return;

    markShownThisSession();
    returnFocusTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
     * This is a reaction to a completed save, not derived render state: the save
     * has already been written before the signal it increments is observed. */
    setOpen(true);
  }, [favorites.guestSaveSignal, eligible]);

  /**
   * Returns focus only if it is currently INSIDE the offer. Dismissing with
   * Escape from elsewhere on the page must not yank focus back to the favourite
   * control the user has since moved away from.
   */
  const close = useCallback(() => {
    const container = containerRef.current;
    const focusIsInside =
      container !== null &&
      document.activeElement instanceof Node &&
      container.contains(document.activeElement);
    setOpen(false);
    if (focusIsInside) {
      const target = returnFocusTo.current;
      if (target && target.isConnected) target.focus();
    }
  }, []);

  /** "Not now" and Escape are the same decision, so they get the same effect. */
  const dismiss = useCallback(() => {
    recordDismissal();
    close();
  }, [close]);

  useEffect(() => {
    if (!open || !eligible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, eligible, dismiss]);

  if (!visible) return null;

  return (
    <aside
      ref={containerRef}
      className={`pointer-events-auto border border-line-strong bg-paper-panel px-3 py-3 sm:px-4 ${
        leaving ? "callout-exit" : "callout-enter"
      }`}
      aria-label="Account suggestion"
      data-testid="account-suggestion"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {/*
            The one live element. It carries the NEW information only: the
            existing favourites live region has already announced "added to
            shortlist. Saved on this device", so repeating it here would say the
            same sentence twice. `role="status"` is polite, so it queues behind
            that announcement rather than interrupting it.
          */}
          <p className="text-sm text-ink" role="status" data-testid="account-suggestion-message">
            Saved on this device. Create an account to keep your favorites when you return or
            switch devices.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary px-3 py-2 text-xs"
            data-testid="account-suggestion-create"
            onClick={() => {
              close();
              openSignUp();
            }}
          >
            Create account
          </button>
          <button
            type="button"
            className="btn px-3 py-2 text-xs"
            data-testid="account-suggestion-signin"
            onClick={() => {
              close();
              openSignIn();
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className="btn px-3 py-2 text-xs"
            data-testid="account-suggestion-dismiss"
            onClick={dismiss}
          >
            Not now
          </button>
        </div>
      </div>
    </aside>
  );
}
