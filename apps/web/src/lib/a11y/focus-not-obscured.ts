"use client";

import { useEffect, type RefObject } from "react";

/**
 * WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum), for viewport-anchored surfaces.
 *
 * Reproduced during the Milestone 7 closeout: with the compare tray open at the
 * top of Discovery, tabbing to the third player link left it at y=686 inside a
 * tray occupying 626-708 — entirely hidden. `scroll-padding-bottom` (kept, in
 * globals.css) does not help on its own, because the browser only consults it
 * when it decides to scroll, and there the element is already technically "in
 * view".
 *
 * This is the smallest correction that resolves it: when focus lands on
 * something the anchored surface overlaps, nudge the page so the control clears
 * it.
 *
 * `behavior: "instant"`, NOT `"auto"`. Per the CSSOM View spec `"auto"` means
 * "use the element's `scroll-behavior` CSS value" — and this document sets
 * `scroll-behavior: smooth` under `no-preference`, so `"auto"` would start a
 * smooth page scroll: page-wide motion the cadence rejects, and a delay before
 * the focused control is actually visible. `"instant"` forces the immediate jump
 * this needs, in both motion preferences.
 *
 * Pointer users cannot trigger it, since the surface already intercepts clicks
 * over the region it covers.
 *
 * Applied to the shared bottom rail rather than to the tray alone, so the
 * account suggestion stacked above the tray is covered by the same guarantee
 * rather than needing a second copy of this reasoning.
 */
export function useFocusNotObscuredBy(
  surface: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      const element = surface.current;
      if (!target || !element || element.contains(target)) return;
      // An empty rail occupies no space and can obscure nothing.
      const bar = element.getBoundingClientRect();
      if (bar.height === 0) return;

      const focused = target.getBoundingClientRect();
      const overlaps = focused.bottom > bar.top && focused.top < bar.bottom;
      if (!overlaps) return;

      // Scrolling down moves the focused control up, out from under the surface.
      window.scrollBy({ top: focused.bottom - bar.top + 8, behavior: "instant" });
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [surface, active]);
}
