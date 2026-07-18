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
            <span className="text-xs text-ink-soft">No qualifying playstyles for this sample.</span>
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
          {concerns.length === 0 && <span className="text-xs text-ink-soft">None flagged.</span>}
          {concerns.map((b) => (
            <span
              key={b.playstyle_key}
              className="chip border-accent-red bg-[#f4e8e3] text-accent-red"
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
