"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { ErrorState, LinkButton, Loading, Section } from "@/components/common";
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

  return (
    <div className="space-y-6" data-testid="player-card">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-accent-soft hover:underline">
          ← Back to search
        </Link>
        <LinkButton href={`/compare?a=${card.identity.id}`}>Compare</LinkButton>
      </div>

      <PlayerCardHeader card={card} />

      <Section title="Face stats">
        <FaceStatsGrid faceStats={card.face_stats} />
      </Section>

      <Section title="RoleFit ratings">
        <RoleRatingsPanel ratings={card.role_ratings} />
      </Section>

      <Section title="Playstyles & concerns">
        <PlaystyleBadges playstyles={card.playstyles} concerns={card.concerns} />
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Market value">
          <MarketValuePanel market={card.market} />
        </Section>
        <Section title="Context">
          <ContextPanel context={card.context} />
        </Section>
      </div>

      <Section title="Strengths & concerns">
        <StrengthsConcerns strengths={card.strengths} concerns={card.concerns_text} />
      </Section>

      <Section title="Sub-stats">
        <SubstatsTable substats={card.substats} />
      </Section>

      <Section title="Why these scores (audit)">
        {ratings ? <AuditAccordion audits={ratings.audits} /> : <Loading />}
      </Section>

      {similar && (
        <Section title="Similar players">
          <SimilarPlayers data={similar} />
        </Section>
      )}

      <p className="text-xs text-slate-500">
        Rating version {card.rating_version ?? "—"} · sources:{" "}
        {card.data_sources.map((s) => s.source_name).join(", ") || "—"}
      </p>
    </div>
  );
}
