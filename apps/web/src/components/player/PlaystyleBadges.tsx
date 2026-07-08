import type { PlaystyleBadge } from "@/lib/api/types";
import { tierBadge, whyText } from "@/lib/formatters";

export function PlaystyleBadges({
  playstyles,
  concerns,
}: {
  playstyles: PlaystyleBadge[];
  concerns: PlaystyleBadge[];
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="label mb-2">Playstyles</div>
        <div className="flex flex-wrap gap-2" data-testid="playstyles">
          {playstyles.length === 0 && (
            <span className="text-xs text-slate-500">No qualifying playstyles for this sample.</span>
          )}
          {playstyles.map((b) => (
            <span
              key={b.playstyle_key}
              className={`chip ${tierBadge(b.tier)}`}
              title={whyText(b)}
            >
              {b.display_name}
              {b.tier && b.tier !== "base" ? ` · ${b.tier}` : ""}
            </span>
          ))}
        </div>
      </div>
      <div>
        <div className="label mb-2">Concerns</div>
        <div className="flex flex-wrap gap-2" data-testid="concerns">
          {concerns.length === 0 && <span className="text-xs text-slate-500">None flagged.</span>}
          {concerns.map((b) => (
            <span
              key={b.playstyle_key}
              className="chip border-rose-500/40 bg-rose-500/15 text-rose-200"
              title={whyText(b)}
            >
              {b.display_name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
