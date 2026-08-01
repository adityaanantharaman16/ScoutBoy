"use client";

import { EmptyState, ErrorState, LedgerSkeleton, LinkButton, PageHeader, ScopeBanner } from "@/components/common";
import {
  LedgerActionRail,
  LedgerHeader,
  LedgerIdentity,
  LedgerRoleFitHero,
  LedgerRow,
  LedgerStatusStack,
} from "@/components/common/LedgerRow";
import { SavedPlayerActionRail } from "@/components/common/PlayerActions";
import { SCOPE_BANNER } from "@/lib/constants";
import { usePlayersByIds } from "@/lib/api/hooks";
import { useScoutingState } from "@/lib/state/scouting-state";
import type { PlayerCard } from "@/lib/api/types";
import { formatAge } from "@/lib/formatters";

// A saved player uses the same ledger row geometry as a discovery result, so the
// two surfaces stay aligned. `PlayerCard` carries less per-season context than a
// search card (there is no represented-minutes field), so the second context line
// reports only what the response actually supplies — nothing is invented.
function SavedRecord({
  card,
  onRemove,
}: {
  card: PlayerCard;
  onRemove: (id: number) => void;
}) {
  const id = card.identity;
  const best = card.role_ratings.find((r) => r.is_best) ?? card.role_ratings[0];
  const analyzed = card.has_rolefit_analysis && !!best;
  const minutes = card.context?.minutes;

  return (
    <LedgerRow testId="shortlist-record">
      <LedgerHeader>
        <LedgerIdentity
          href={`/players/${id.id}`}
          name={id.canonical_name}
          nameTestId="shortlist-player"
        >
          <div className="mt-0.5 text-xs text-ink-muted">
            {formatAge(id.age)} yrs · {id.primary_position ?? "—"} · {id.club ?? "—"}
          </div>
          <div className="text-xs text-ink-soft">
            {id.league ?? "—"} · {card.season}
            {minutes != null ? ` · ${minutes} min` : ""}
          </div>
        </LedgerIdentity>
        <LedgerRoleFitHero
          hasAnalysis={analyzed}
          score={analyzed ? best.final_score : null}
          role={analyzed ? best.display_name : null}
        />
      </LedgerHeader>

      <LedgerStatusStack
        evidenceStatus={card.evidence_status}
        confidence={analyzed ? best.confidence : card.confidence}
        hasAnalysis={analyzed}
        marketLabel={card.market?.label}
        marketLow={card.market?.expected_asking_low_eur}
        marketHigh={card.market?.expected_asking_high_eur}
        playstyles={card.playstyles.slice(0, 3).map((b) => b.display_name)}
      />

      <LedgerActionRail>
        <SavedPlayerActionRail
          player={{ id: id.id, name: id.canonical_name }}
          onRemove={() => onRemove(id.id)}
        />
      </LedgerActionRail>
    </LedgerRow>
  );
}

export default function ShortlistPage() {
  const { shortlistIds, removeShortlist } = useScoutingState();
  const queries = usePlayersByIds(shortlistIds);
  const loading = queries.some((q) => q.isLoading);
  const cards = queries.flatMap((q) => (q.data ? [q.data] : []));
  const staleIds = shortlistIds.filter((id, index) => queries[index]?.isError);

  return (
    <div>
      <ScopeBanner text={SCOPE_BANNER} />
      <PageHeader
        eyebrow="My Favorites"
        title="Saved Players"
        lead="Players you have set aside to revisit. These are stored in this browser only — saved on this device, not synced to an account."
        meta={
          cards.length > 0
            ? `${cards.length} resolved player${cards.length === 1 ? "" : "s"} · saved on this device`
            : undefined
        }
      />

      {shortlistIds.length === 0 && (
        <EmptyState
          label="No players saved yet. Save players from discovery, profiles, similar players, or leaderboards to revisit them here."
          action={<LinkButton href="/">Go to discovery</LinkButton>}
        />
      )}

      {loading && shortlistIds.length > 0 && (
        <LedgerSkeleton rows={Math.min(shortlistIds.length, 4)} label="Resolving shortlisted players…" />
      )}

      {staleIds.length > 0 && (
        <div className="mb-4">
          <ErrorState
            message={`${staleIds.length} saved player id${staleIds.length === 1 ? "" : "s"} could not be resolved and may be stale.`}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {staleIds.map((id) => (
              <button
                key={id}
                type="button"
                className="btn px-2 py-1 text-xs"
                onClick={() => removeShortlist(id)}
              >
                Remove stale id {id}
              </button>
            ))}
          </div>
        </div>
      )}

      {cards.length > 0 && (
        <div
          className="divide-y divide-line overflow-hidden border border-line bg-paper-panel"
          data-testid="shortlist-ledger"
        >
          {cards.map((card) => (
            <SavedRecord key={card.identity.id} card={card} onRemove={removeShortlist} />
          ))}
        </div>
      )}
    </div>
  );
}
