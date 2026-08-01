"use client";

import Link from "next/link";

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
 */
function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-testid="favorite-heart"
      data-filled={filled ? "true" : "false"}
    >
      <path d="M12 20.6 4.7 13.3a4.85 4.85 0 0 1 0-6.9 4.75 4.75 0 0 1 6.6 0l.7.7.7-.7a4.75 4.75 0 0 1 6.6 0 4.85 4.85 0 0 1 0 6.9Z" />
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

export function CompareTray() {
  const { compareQueue, removeCompare, clearCompare } = useScoutingState();
  if (compareQueue.length === 0) return null;

  const compareHref =
    compareQueue.length === 2
      ? `/compare?a=${compareQueue[0].id}&b=${compareQueue[1].id}`
      : "/compare";

  return (
    <aside
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-5xl border border-line-strong bg-ink px-3 py-3 text-paper shadow-sm sm:px-4"
      aria-label="Compare queue"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="label text-paper/60">Compare queue · device local</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {compareQueue.map((player) => (
              <span
                key={player.id}
                className="inline-flex items-center gap-2 border border-paper/20 px-2 py-1 text-sm"
              >
                {player.name}
                <button
                  type="button"
                  className="text-paper/70 hover:text-paper"
                  aria-label={`Remove ${player.name} from compare queue`}
                  onClick={() => removeCompare(player.id)}
                >
                  x
                </button>
              </span>
            ))}
            {compareQueue.length < 2 && <span className="text-sm text-paper/60">Add one more player</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn border-paper/30 bg-transparent text-paper hover:bg-paper/10" onClick={clearCompare}>
            Clear
          </button>
          <Link
            href={compareHref}
            className={`btn btn-primary ${compareQueue.length < 2 ? "pointer-events-none opacity-55" : ""}`}
            aria-disabled={compareQueue.length < 2}
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
