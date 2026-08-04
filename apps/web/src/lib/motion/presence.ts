"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * The motion layer's only JavaScript.
 *
 * Two elements in ScoutBoy genuinely leave the DOM — the compare tray and the
 * mobile menu — and both are anchored to a boundary, so an exit that travels back
 * toward that boundary is the one place presence management earns its place.
 * Everything else in the motion system is a CSS transition or a mount-triggered
 * keyframe with no state, no key, and no timer.
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * `matchMedia` is absent in some non-browser render targets and in jsdom. Its
 * absence must never throw: motion is a progressive enhancement, so "unknown"
 * degrades to the no-preference default.
 */
function mediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

function subscribeToReducedMotion(onStoreChange: () => void): () => void {
  const query = mediaQuery();
  if (!query) return () => {};
  // Safari below 14 exposes only the deprecated listener API.
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onStoreChange);
    return () => query.removeEventListener("change", onStoreChange);
  }
  query.addListener(onStoreChange);
  return () => query.removeListener(onStoreChange);
}

function getReducedMotionSnapshot(): boolean {
  return mediaQuery()?.matches ?? false;
}

/** The server cannot know the preference; the client corrects it on hydration. */
function getReducedMotionServerSnapshot(): boolean {
  return false;
}

/**
 * `prefers-reduced-motion: reduce`, read as an external store rather than
 * mirrored into state by an effect — so there is no extra commit, no cascading
 * render, and no window where the component has rendered with a stale value.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
}

export interface Presence {
  /** Render the element at all. Semantic mount/unmount is preserved. */
  visible: boolean;
  /** True only while the element is playing its exit. */
  leaving: boolean;
}

/**
 * Holds an element mounted for `exitDuration` after `active` goes false, so a CSS
 * exit keyframe can play, then unmounts it for real.
 *
 * Guarantees that matter:
 *
 * - **Never gates the action.** Application state (the compare queue, the menu's
 *   `aria-expanded`) is updated by the caller synchronously. This hook only
 *   delays the element's *removal from the DOM*, so no click, keypress, focus
 *   move, or live-region announcement ever waits on an animation.
 * - **Reduced motion skips the hold entirely** — `visible` follows `active` in the
 *   same commit and no timer is ever scheduled.
 * - **No stale timer.** The exit window is derived from an `active` transition
 *   detected during render (React's documented "adjust state when a prop changes"
 *   pattern), and the single timeout is owned by an effect that clears it on every
 *   re-run. Re-activating during an exit therefore cancels the pending unmount
 *   instead of racing it — which is what makes rapid add/remove unable to strand a
 *   ghost tray: the element is either on its way in or already gone, never both.
 */
export function usePresence(active: boolean, exitDuration: number): Presence {
  const reduced = usePrefersReducedMotion();
  const animateExit = !reduced && exitDuration > 0;

  const [leaving, setLeaving] = useState(false);
  const [previous, setPrevious] = useState(active);

  // Adjusting state during render (not in an effect): React re-renders
  // immediately without committing the intermediate result, so the exit begins in
  // the same pass that observed the deactivation.
  if (previous !== active) {
    setPrevious(active);
    setLeaving(!active && animateExit);
  }

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(false), exitDuration);
    return () => window.clearTimeout(timer);
  }, [leaving, exitDuration]);

  // Re-checking `reduced` here matters for the case where the preference is
  // switched on mid-exit: the element then disappears at once rather than
  // finishing a motion the user has just asked not to see.
  const exiting = leaving && !reduced;
  return { visible: active || exiting, leaving: exiting };
}

/** Matches `--motion-exit` in globals.css. */
export const MOTION_EXIT_MS = 120;
