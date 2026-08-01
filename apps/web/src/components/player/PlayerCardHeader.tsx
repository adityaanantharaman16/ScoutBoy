import { ConfidenceBadge, DisplayTag } from "@/components/common";
import { PlayerActionRow } from "@/components/common/PlayerActions";
import type { PlayerCard } from "@/lib/api/types";
import { evidenceStatusText, formatAge, formatScore, scoreColor } from "@/lib/formatters";

export function PlayerCardHeader({ card }: { card: PlayerCard }) {
  const best = card.role_ratings.find((r) => r.is_best);
  const id = card.identity;
  return (
    <section className="grid gap-5 border-b border-line pb-6 lg:grid-cols-[1.45fr_1fr]" aria-labelledby="player-name">
      <div>
        <p className="mb-1 text-sm text-ink-soft">
          {card.season} / {id.club ?? "Club unknown"} / {id.league ?? "League unknown"}
        </p>
        <h1 className="tracking-tight text-4xl font-bold leading-none text-ink sm:text-5xl" data-testid="player-name">
          {id.canonical_name}
        </h1>
        <div className="mt-3 text-sm text-ink-muted">
          {formatAge(id.age)} yrs · {id.primary_position ?? "—"}
          {id.secondary_positions.length > 0 && ` (${id.secondary_positions.join(", ")})`} ·{" "}
          {id.nationality ?? "—"}
        </div>
        <div className="mt-1 text-xs text-ink-soft">
          {id.preferred_foot ? `${id.preferred_foot}-footed` : ""}{" "}
          {id.height_cm ? `· ${id.height_cm}cm` : ""}
        </div>
        <div className="mt-4">
          <PlayerActionRow player={{ id: id.id, name: id.canonical_name }} size="md" />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden border border-line bg-line">
        <div className="bg-paper-panel px-4 py-3">
          <dt className="label">Best RoleFit</dt>
          <dd className={`mt-1 tracking-tight text-4xl font-bold leading-none ${scoreColor(best?.final_score)}`}>
            {best ? formatScore(best.final_score) : "Profile only"}
          </dd>
        </div>
        <div className="bg-paper-panel px-4 py-3">
          <dt className="label">Role</dt>
          <dd className="mt-1 text-sm font-semibold text-ink">{best?.display_name ?? "Unavailable"}</dd>
        </div>
        <div className="bg-paper-panel px-4 py-3">
          <dt className="label">Evidence</dt>
          <dd className="mt-1 text-sm font-semibold text-ink">{evidenceStatusText(card.evidence_status)}</dd>
        </div>
        <div className="bg-paper-panel px-4 py-3">
          <dt className="label">Confidence</dt>
          <dd className="mt-1">
            {card.has_rolefit_analysis ? (
              <ConfidenceBadge confidence={card.confidence} />
            ) : (
              <DisplayTag variant="evidence" value="profile_only">Profile Only</DisplayTag>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
