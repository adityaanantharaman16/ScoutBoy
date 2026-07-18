"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { DossierSection, ErrorState, Loading, Notice, Section } from "@/components/common";
import { AuditAccordion } from "@/components/player/AuditAccordion";
import { ContextPanel } from "@/components/player/ContextPanel";
import { FaceStatsGrid } from "@/components/player/FaceStatsGrid";
import { MarketValuePanel } from "@/components/player/MarketValuePanel";
import { PlayerCardHeader } from "@/components/player/PlayerCardHeader";
import { PlaystyleBadges } from "@/components/player/PlaystyleBadges";
import { RoleRatingsPanel } from "@/components/player/RoleRatingsPanel";
import { SimilarPlayers } from "@/components/player/SimilarPlayers";
import { StrengthsConcerns } from "@/components/player/StrengthsConcerns";
import { SubstatsTable } from "@/components/player/SubstatsTable";
import { usePlayer, usePlayerRatings, usePlayerSimilar } from "@/lib/api/hooks";

export default function PlayerCardPage() {
  const params = useParams();
  const playerId = Number(params.playerId);
  const { data: card, isLoading, isError, error } = usePlayer(playerId);
  const { data: ratings } = usePlayerRatings(playerId);
  const { data: similar } = usePlayerSimilar(playerId);

  if (isLoading) return <Loading label="Loading player card…" />;
  if (isError || !card) return <ErrorState message={(error as Error)?.message ?? "Not found"} />;
  const hasAnalysis = card.has_rolefit_analysis;

  return (
    <div className="space-y-6" data-testid="player-card">
      <Link href="/" className="text-sm font-semibold text-pitch-dark hover:underline">
        Back to discover
      </Link>

      <PlayerCardHeader card={card} />

      {!hasAnalysis && (
        <Notice
          title="Detailed RoleFit analysis unavailable"
          tone="caution"
          testId="analysis-unavailable"
        >
          <p>
            This player has a season profile in the available dataset, but no RoleFit rating for
            this season. ScoutBoy is showing identity, minutes, context, market, and source evidence
            without fabricating an analytical score.
          </p>
        </Notice>
      )}

      {hasAnalysis && (
        <>
          <DossierSection number="01" title="RoleFit summary" eyebrow="Performance profile">
            <FaceStatsGrid faceStats={card.face_stats} />
          </DossierSection>

          <DossierSection number="02" title="Role breakdown" eyebrow="Peer-ranked roles">
            <RoleRatingsPanel ratings={card.role_ratings} />
          </DossierSection>

          {(card.playstyles.length > 0 || card.concerns.length > 0) && (
            <DossierSection number="03" title="Playstyles & concerns" eyebrow="Observed tags">
              <PlaystyleBadges playstyles={card.playstyles} concerns={card.concerns} />
            </DossierSection>
          )}
        </>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DossierSection number={hasAnalysis ? "04" : "01"} title="Market value" eyebrow="Ranges and confidence">
          <MarketValuePanel market={card.market} />
        </DossierSection>
        <DossierSection number={hasAnalysis ? "05" : "02"} title="Context & coverage" eyebrow="Evidence">
          <ContextPanel context={card.context} />
        </DossierSection>
      </div>

      {hasAnalysis && (
        <>
          <DossierSection number="06" title="Strengths & concerns" eyebrow="Scouting notes">
            <StrengthsConcerns strengths={card.strengths} concerns={card.concerns_text} />
          </DossierSection>

          <DossierSection number="07" title="Sub-stats" eyebrow="Per-90 and percentile view">
            <SubstatsTable substats={card.substats} />
          </DossierSection>

          <DossierSection number="08" title="Why these scores" eyebrow="Audit trail">
            {ratings ? <AuditAccordion audits={ratings.audits} /> : <Loading />}
          </DossierSection>
        </>
      )}

      {hasAnalysis && similar && (
        <DossierSection number="09" title="Similar players" eyebrow="Style and value comparisons">
          <SimilarPlayers data={similar} />
        </DossierSection>
      )}

      <Section title="Sources, version & limitations" eyebrow="Data provenance">
        <div className="card space-y-2 text-sm text-ink-muted">
          <p>
            Rating version <span className="font-mono text-ink">{card.rating_version ?? "—"}</span>
            {" "}· last updated <span className="font-mono text-ink">{card.last_updated ?? "—"}</span>
          </p>
          <ul className="space-y-2">
            {card.data_sources.length === 0 && <li>No source metadata available.</li>}
            {card.data_sources.map((s) => (
              <li key={`${s.source_name}-${s.source_player_id ?? "none"}`}>
                <span className="font-semibold text-ink">{s.provider_display_name ?? s.source_name}</span>
                {s.data_type ? ` · ${s.data_type}` : ""} {s.last_updated ? `· ${s.last_updated}` : ""}
                {s.attribution ? <span className="block text-xs text-ink-soft">{s.attribution}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </Section>
    </div>
  );
}
