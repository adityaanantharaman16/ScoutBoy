import { ConfidenceBadge } from "@/components/common";
import type { PlayerCard } from "@/lib/api/types";
import { formatAge, formatScore, scoreColor } from "@/lib/formatters";

export function PlayerCardHeader({ card }: { card: PlayerCard }) {
  const best = card.role_ratings.find((r) => r.is_best);
  const id = card.identity;
  return (
    <div className="card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold" data-testid="player-name">
          {id.canonical_name}
        </h1>
        <div className="mt-1 text-sm text-slate-300">
          {formatAge(id.age)} yrs · {id.primary_position ?? "—"}
          {id.secondary_positions.length > 0 && ` (${id.secondary_positions.join(", ")})`} ·{" "}
          {id.nationality ?? "—"}
        </div>
        <div className="text-sm text-slate-400">
          {id.club ?? "—"} · {id.league ?? "—"} · {card.season}
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {id.preferred_foot ? `${id.preferred_foot}-footed` : ""}{" "}
          {id.height_cm ? `· ${id.height_cm}cm` : ""}
        </div>
      </div>
      <div className="text-right">
        {best && (
          <>
            <div className={`text-4xl font-black ${scoreColor(best.final_score)}`}>
              {formatScore(best.final_score)}
            </div>
            <div className="text-xs text-slate-400">Best: {best.display_name}</div>
          </>
        )}
        <div className="mt-2 flex justify-end">
          <ConfidenceBadge confidence={card.confidence} />
        </div>
      </div>
    </div>
  );
}
