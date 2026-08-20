"use client";

import { useRef } from "react";

import { AccountSuggestion } from "@/components/account/AccountSuggestion";
import { CompareTray } from "@/components/common/PlayerActions";
import { useFocusNotObscuredBy } from "@/lib/a11y/focus-not-obscured";

/**
 * The one viewport-anchored region in ScoutBoy.
 *
 * Two surfaces can be present here, and they STACK rather than overlap: the
 * account suggestion sits above the compare tray, separated by the same 8px the
 * rest of the product uses. Only one element is positioned — this container —
 * so neither child can drift out of alignment with the other, and a page
 * carrying only the tray renders exactly as it did before this rail existed
 * (`inset-x-3 bottom-3`, centred, capped at `max-w-5xl`).
 *
 * `pointer-events-none` on the column with `pointer-events-auto` on each child
 * keeps the gap and the empty rail inert, so nothing here intercepts a click
 * meant for the page underneath.
 *
 * The focus-obscuring guard lives here rather than on the tray, so both surfaces
 * are covered by one implementation.
 */
export function BottomRail() {
  const railRef = useRef<HTMLDivElement | null>(null);
  useFocusNotObscuredBy(railRef, true);

  return (
    <div
      ref={railRef}
      className="pointer-events-none fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-5xl flex-col gap-2"
      data-testid="bottom-rail"
    >
      <AccountSuggestion />
      <CompareTray />
    </div>
  );
}
