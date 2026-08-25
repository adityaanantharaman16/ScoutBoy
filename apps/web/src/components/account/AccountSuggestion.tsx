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
 * A restrained, non-modal offer shown to a guest who has just favourited a player.
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
 * ONE trigger: a GUEST added a player to My Favorites that they had not saved
 * before, and the device write is already confirmed. Then, and only then, if:
 *
 *   - this build offers accounts, and
 *   - nobody is signed in, and
 *   - it has not already been shown this browser session, and
 *   - no explicit "Not now" is inside its cooling-off window.
 *
 * Which means: **never merely because the application was opened.** Not on first
 * mount, not on a reload, not while the identity provider is still resolving, not
 * when it restores an existing session, not because favourites were already in
 * browser storage, not because saved Discovery views or saved comparison setups
 * exist, and not because a provider hydrated or synchronized. Also never after a
 * removal, never after re-selecting a player already saved, never after a FAILED
 * write, never for an account holder, and never in an auth-free build.
 *
 * 8.4B briefly widened this to "any first durable save", summing a second signal
 * from saved views and saved comparisons. That was wrong in practice: filtering
 * Discovery and saving the view is a routine opening move, so a scout who had
 * favourited nothing and asked for nothing got an unsolicited account callout
 * moments after launch. Saving a view is a filing action, not a moment of
 * attachment to a player — the favourite is. One trigger, and it is that one.
 *
 * Saved views and saved comparison setups still synchronize to an account exactly
 * as before; they simply no longer ask for one.
 */
export function AccountSuggestion() {
  const { effectiveStatus, enabled, openSignIn, openSignUp } = useAuthSession();
  const { favorites } = useScoutingState();
  /**
   * Raised by the favourites store, once, inside the branch that has already
   * confirmed the device write — so a removal, a no-op re-select, a failed write
   * and hydration all leave it exactly where it was.
   */
  const newFavoriteSignal = favorites.guestSaveSignal;
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
  /**
   * The signal value this component has already accounted for.
   *
   * `null` until the first time the effect runs, and that first run is ALWAYS a
   * baseline. This is the launch guard: whatever the store hands over while the
   * page is starting up — a hydrated list of forty favourites, a restored
   * session, a provider settling — is absorbed here, never fired on. The offer
   * can only be opened by a value that arrives after this component has already
   * seen a different one, which is another way of saying: by something the user
   * just did.
   */
  const observed = useRef<number | null>(null);

  useEffect(() => {
    if (observed.current === null) {
      observed.current = newFavoriteSignal;
      return;
    }
    // Strictly greater. Only an ADDITION raises this counter, so a value that
    // stayed put or somehow went backwards is not one and cannot open anything.
    const added = newFavoriteSignal > observed.current;
    observed.current = newFavoriteSignal;
    if (!added) return;

    if (!eligible) return;
    if (shownThisSession()) return;
    if (isSuppressed()) return;

    markShownThisSession();
    returnFocusTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
     * This is a reaction to a completed favourite, not derived render state: the
     * player is already in browser storage by the time the signal moves, and a
     * FAILED write never moves it. */
    setOpen(true);
  }, [newFavoriteSignal, eligible]);

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
            Saved on this device. Create an account to keep saved work across devices.
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
            Create Account
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
            Sign In
          </button>
          <button
            type="button"
            className="btn px-3 py-2 text-xs"
            data-testid="account-suggestion-dismiss"
            onClick={dismiss}
          >
            Not Now
          </button>
        </div>
      </div>
    </aside>
  );
}
