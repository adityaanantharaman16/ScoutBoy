"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { MOTION_EXIT_MS, usePresence } from "@/lib/motion/presence";
import { useScoutingState, type PlayerRef } from "@/lib/state/scouting-state";

export function ShortlistButton({
  player,
  size = "md",
}: {
  player: PlayerRef;
  size?: "sm" | "md";
}) {
  const { isShortlisted, toggleShortlist } = useScoutingState();
  const active = isShortlisted(player.id);
  return (
    <button
      type="button"
      className={`btn ${active ? "btn-on" : ""} ${size === "sm" ? "px-2 py-1 text-xs" : ""}`}
      aria-pressed={active}
      aria-label={`${active ? "Remove" : "Add"} ${player.name} ${active ? "from" : "to"} shortlist`}
      onClick={() => toggleShortlist(player)}
    >
      {!active && <span aria-hidden="true">+</span>}
      <span>{active ? "Shortlisted" : "Shortlist"}</span>
    </button>
  );
}

export function CompareQueueButton({
  player,
  size = "md",
}: {
  player: PlayerRef;
  size?: "sm" | "md";
}) {
  const { isQueuedForCompare, toggleCompare } = useScoutingState();
  const active = isQueuedForCompare(player.id);
  return (
    <button
      type="button"
      className={`btn ${active ? "btn-on" : ""} ${size === "sm" ? "px-2 py-1 text-xs" : ""}`}
      aria-pressed={active}
      aria-label={`${active ? "Remove" : "Add"} ${player.name} ${active ? "from" : "to"} compare queue`}
      onClick={() => toggleCompare(player)}
    >
      {/* Label only — the decorative "vs" glyph is gone; the accessible name
          above still names the player and the queue action. */}
      <span>{active ? "Queued" : "Compare"}</span>
    </button>
  );
}

/**
 * Outlined vs filled heart at identical geometry — the selected state toggles the
 * fill, never the icon's footprint. Inline and monochrome via `currentColor`.
 *
 * The fill is expressed as `fill="currentColor"` plus a `fill-opacity` of 1 or 0,
 * rather than toggling `fill` between `currentColor` and `none`. Visually
 * identical, but `none` is not a colour and therefore cannot interpolate — so
 * transitioning `fill` would silently snap while `fill-opacity` genuinely
 * transitions (see `.heart-fill` in globals.css). The stroke is always painted,
 * so the outline never disappears mid-transition, and `data-filled` remains the
 * asserted state attribute.
 */
function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-testid="favorite-heart"
      data-filled={filled ? "true" : "false"}
    >
      <path
        className="heart-fill"
        d="M12 20.6 4.7 13.3a4.85 4.85 0 0 1 0-6.9 4.75 4.75 0 0 1 6.6 0l.7.7.7-.7a4.75 4.75 0 0 1 6.6 0 4.85 4.85 0 0 1 0 6.9Z"
        fill="currentColor"
        fillOpacity={filled ? 1 : 0}
      />
    </svg>
  );
}

/**
 * Discovery-rail favourite action: the same device-local shortlist state as
 * {@link ShortlistButton}, presented as an icon-only region of the rail.
 */
export function FavoriteHeartButton({ player }: { player: PlayerRef }) {
  const { isShortlisted, toggleShortlist } = useScoutingState();
  const active = isShortlisted(player.id);
  return (
    <button
      type="button"
      className="rail-action"
      aria-pressed={active}
      aria-label={`${active ? "Remove" : "Add"} ${player.name} ${active ? "from" : "to"} My Favorites`}
      data-testid="favorite-action"
      onClick={() => toggleShortlist(player)}
    >
      <HeartIcon filled={active} />
    </button>
  );
}

/** Discovery-rail compare action: label only, same compare-queue behaviour. */
export function CompareRailButton({ player }: { player: PlayerRef }) {
  const { isQueuedForCompare, toggleCompare } = useScoutingState();
  const active = isQueuedForCompare(player.id);
  return (
    <button
      type="button"
      className="rail-action"
      aria-pressed={active}
      aria-label={`${active ? "Remove" : "Add"} ${player.name} ${active ? "from" : "to"} compare queue`}
      data-testid="compare-action"
      onClick={() => toggleCompare(player)}
    >
      Compare
    </button>
  );
}

/**
 * Discovery action rail — a presentation variant of {@link PlayerActionRow}, not
 * a replacement: two equal action regions in one hairline box (a full-height
 * two-row rail at lg+, two equal-width columns below it). Shared state and
 * accessibility semantics are reused; only the composition differs.
 *
 * `rail-box-discovery` is the single sanctioned rectangular radius exception in
 * production: this box was approved with its existing 2px geometry and keeps it.
 * The modifier is applied HERE ONLY — {@link SavedPlayerActionRail} shares the
 * component but not the exception, so My Favorites renders square.
 */
export function PlayerActionRail({ player }: { player: PlayerRef }) {
  return (
    <div className="rail-box rail-box-discovery" data-testid="action-rail-box">
      <FavoriteHeartButton player={player} />
      <CompareRailButton player={player} />
    </div>
  );
}

/**
 * My Favorites rail: the player is already saved, so the direct action is Remove
 * rather than a favourite toggle. Compare reuses the shared queue behaviour and
 * keeps its pressed state, so toggling it cannot shift the row's layout.
 */
export function SavedPlayerActionRail({
  player,
  onRemove,
}: {
  player: PlayerRef;
  onRemove: () => void;
}) {
  return (
    <div className="rail-box" data-testid="action-rail-box">
      <button
        type="button"
        className="rail-action"
        aria-label={`Remove ${player.name} from My Favorites`}
        data-testid="remove-action"
        onClick={onRemove}
      >
        Remove
      </button>
      <CompareRailButton player={player} />
    </div>
  );
}

export function PlayerActionRow({
  player,
  size = "sm",
}: {
  player: PlayerRef;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <ShortlistButton player={player} size={size} />
      <CompareQueueButton player={player} size={size} />
    </div>
  );
}

/**
 * The compare tray is the one region in ScoutBoy that is spatially anchored to a
 * viewport edge, so its presence may travel — but only from and toward the bottom
 * boundary it already lives on.
 *
 * `usePresence` holds the tray mounted for the exit's duration and no longer. The
 * queue state itself is never gated: `clearCompare` and `removeCompare` take
 * effect synchronously, so clearing the tray works immediately and the live
 * region is unaffected. Re-adding a player during the exit cancels the pending
 * unmount rather than racing it, so rapid add/remove cannot strand a ghost tray.
 * Under reduced motion the hold collapses to zero and the tray mounts/unmounts in
 * the same commit, with no translation.
 */
export function CompareTray() {
  const { compareQueue, removeCompare, clearCompare } = useScoutingState();
  const { visible, leaving } = usePresence(compareQueue.length > 0, MOTION_EXIT_MS);
  // Keeps the last non-empty queue on screen for the 120ms exit, so the tray
  // animates out carrying the content it had rather than blanking to "Add one
  // more player" first. Adjusted during render, never from a ref read.
  const [held, setHeld] = useState<PlayerRef[]>(compareQueue);
  if (compareQueue.length > 0 && held !== compareQueue) setHeld(compareQueue);
  const trayRef = useRef<HTMLElement | null>(null);

  /**
   * WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum).
   *
   * Reproduced during the closeout: with the tray open at the top of Discovery,
   * tabbing to the third player link left it at y=686 inside a tray occupying
   * 626–708 — entirely hidden. `scroll-padding-bottom` (kept, in globals.css)
   * does not help on its own, because the browser only consults it when it
   * decides to scroll, and here the element is already technically "in view".
   *
   * This is the smallest correction that resolves it: when focus lands on
   * something the fixed tray overlaps, nudge the page so the control clears it.
   *
   * `behavior: "instant"`, NOT `"auto"`. Per the CSSOM View spec `"auto"` means
   * "use the element's `scroll-behavior` CSS value" — and this document sets
   * `scroll-behavior: smooth` under `no-preference`, so `"auto"` would start a
   * smooth page scroll: page-wide motion the cadence rejects, and a delay before
   * the focused control is actually visible. `"instant"` forces the immediate
   * jump this needs, in both motion preferences.
   *
   * Pointer users cannot trigger it, since the tray already intercepts clicks
   * over the region it covers.
   */
  useEffect(() => {
    if (!visible) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      const tray = trayRef.current;
      if (!target || !tray || tray.contains(target)) return;

      const focused = target.getBoundingClientRect();
      const bar = tray.getBoundingClientRect();
      const overlaps = focused.bottom > bar.top && focused.top < bar.bottom;
      if (!overlaps) return;

      // Scrolling down moves the focused control up, out from under the tray.
      window.scrollBy({ top: focused.bottom - bar.top + 8, behavior: "instant" });
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [visible]);

  if (!visible) return null;
  const queue = compareQueue.length > 0 ? compareQueue : held;

  const compareHref =
    queue.length === 2 ? `/compare?a=${queue[0].id}&b=${queue[1].id}` : "/compare";

  return (
    <aside
      ref={trayRef}
      className={`fixed inset-x-3 bottom-3 z-40 mx-auto max-w-5xl border border-line-strong bg-ink px-3 py-3 text-paper shadow-sm sm:px-4 ${
        leaving ? "tray-exit" : "tray-enter"
      }`}
      aria-label="Compare queue"
      data-testid="compare-tray"
      data-leaving={leaving ? "true" : "false"}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {/* `label-on-ink` rather than a `text-*` utility: `.label` is declared
              after Tailwind's utilities layer, so a utility of equal specificity
              cannot override its colour. See globals.css. */}
          <div className="label label-on-ink">Compare queue · device local</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {queue.map((player) => (
              <span
                key={player.id}
                // Opacity only, on mount: it points at WHICH name just joined the
                // queue. Removal is instant — the tray already reports the change.
                className="tray-token-enter inline-flex items-center gap-2 border border-paper/20 px-2 py-1 text-sm"
              >
                {player.name}
                {/* Was an 8x20 glyph — below the 24x24 minimum in WCAG 2.2
                    SC 2.5.8, with no applicable exception (it is not inline in a
                    sentence and its size is not essential). The hit area is now
                    24x24 while the glyph itself is unchanged, so the tray's
                    visual density is preserved. */}
                <button
                  type="button"
                  className="-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center text-paper/70 hover:text-paper"
                  aria-label={`Remove ${player.name} from compare queue`}
                  data-testid="tray-remove"
                  onClick={() => removeCompare(player.id)}
                >
                  <span aria-hidden="true">x</span>
                </button>
              </span>
            ))}
            {queue.length < 2 && <span className="text-sm text-paper/60">Add one more player</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn border-paper/30 bg-transparent text-paper hover:bg-paper/10" onClick={clearCompare}>
            Clear
          </button>
          <Link
            href={compareHref}
            className={`btn btn-primary ${queue.length < 2 ? "pointer-events-none opacity-55" : ""}`}
            aria-disabled={queue.length < 2}
          >
            Open comparison
          </Link>
        </div>
      </div>
    </aside>
  );
}

export function ScoutingLiveRegion() {
  const { notice } = useScoutingState();
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {notice}
    </div>
  );
}
