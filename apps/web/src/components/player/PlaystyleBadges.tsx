import { DisplayTag } from "@/components/common/DisplayTag";
import type { PlaystyleBadge } from "@/lib/api/types";
import { tierText, whyText } from "@/lib/formatters";

// Playstyles and concerns are both display tags but deliberately NOT the same
// one: a playstyle is a trait (ink-filled), a concern is a flagged risk (warning
// styling). Tier stays in the label text; it never changes the colour, so a tier
// can never be mistaken for a confidence or market status.

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
            <DisplayTag key={b.playstyle_key} variant="playstyle" title={whyText(b)}>
              {b.display_name}
              {tierText(b.tier) ? ` · ${tierText(b.tier)}` : ""}
            </DisplayTag>
          ))}
        </div>
      </div>
      <div>
        <div className="label mb-2">Concerns</div>
        <div className="flex flex-wrap gap-2" data-testid="concerns">
          {concerns.length === 0 && <span className="text-xs text-ink-soft">None flagged.</span>}
          {concerns.map((b) => (
            <DisplayTag key={b.playstyle_key} variant="concern" title={whyText(b)}>
              {b.display_name}
            </DisplayTag>
          ))}
        </div>
      </div>
    </div>
  );
}
