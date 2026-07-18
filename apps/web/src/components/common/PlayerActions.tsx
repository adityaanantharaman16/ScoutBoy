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
      <span aria-hidden="true">vs</span>
      <span>{active ? "Queued" : "Compare"}</span>
    </button>
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
      style={{ borderRadius: 6 }}
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
                style={{ borderRadius: 4 }}
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
