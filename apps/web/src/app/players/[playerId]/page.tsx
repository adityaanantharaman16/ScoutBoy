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
import { RecruitmentDesk } from "@/components/player/RecruitmentDesk";
import { RoleRatingsPanel } from "@/components/player/RoleRatingsPanel";
import { SimilarPlayers } from "@/components/player/SimilarPlayers";
import { StrengthsConcerns } from "@/components/player/StrengthsConcerns";
import { SubstatsTable } from "@/components/player/SubstatsTable";
import { usePlayer, usePlayerRatings, usePlayerSimilar } from "@/lib/api/hooks";

export default function PlayerCardPage() {
  const params = useParams();
  const playerId = Number(params.playerId);
  const { data: card, isLoading, isError, error } = usePlayer(playerId);
  const {
    data: ratings,
    isLoading: ratingsLoading,
    isError: ratingsError,
  } = usePlayerRatings(playerId);
  const { data: similar } = usePlayerSimilar(playerId);

  if (isLoading) return <Loading label="Loading player card…" />;
  if (isError || !card) return <ErrorState message={(error as Error)?.message ?? "Not found"} />;
  const hasAnalysis = card.has_rolefit_analysis;

  return (
    <div className="space-y-8" data-testid="player-card">
      <Link href="/" className="text-sm font-semibold text-pitch-dark hover:underline">
        Back to discover
      </Link>

      {hasAnalysis ? (
        <>
          {/* Recruitment Desk: role-driven analysis of the selected role. */}
          <RecruitmentDesk
            key={card.identity.id}
            card={card}
            ratings={ratings}
            ratingsLoading={ratingsLoading}
            ratingsError={ratingsError}
          />

          {/* Supporting dossier — full detail beneath the desk. */}
          <div className="border-t border-line pt-6">
            <DossierSection
              number="01"
              title="Face Stats"
              eyebrow="General profile · not role-specific"
            >
              <p className="mb-3 text-sm text-ink-soft">
                Broad, non-role-specific averages across all roles. For the selected role&apos;s
                authoritative breakdown, use the role territory above.
              </p>
              <FaceStatsGrid faceStats={card.face_stats} />
            </DossierSection>

            <DossierSection number="02" title="Peer-Ranked Roles" eyebrow="Role breakdown">
              <RoleRatingsPanel ratings={card.role_ratings} />
            </DossierSection>

            {(card.playstyles.length > 0 || card.concerns.length > 0) && (
              <DossierSection number="03" title="Playstyles & Concerns" eyebrow="Observed tags">
                <PlaystyleBadges playstyles={card.playstyles} concerns={card.concerns} />
              </DossierSection>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-stretch">
              <div id="market-full" className="flex scroll-mt-24">
                <DossierSection number="04" title="Market Value" eyebrow="Ranges and confidence" fill>
                  <MarketValuePanel market={card.market} />
                </DossierSection>
              </div>
              <div id="context-full" className="flex scroll-mt-24">
                <DossierSection number="05" title="Context & Coverage" eyebrow="Evidence" fill>
                  <ContextPanel context={card.context} />
                </DossierSection>
              </div>
            </div>

            <DossierSection number="06" title="Strengths & Concerns" eyebrow="Scouting notes">
              <StrengthsConcerns strengths={card.strengths} concerns={card.concerns_text} />
            </DossierSection>

            <DossierSection number="07" title="Sub-Stats" eyebrow="Per-90 and percentile view">
              <SubstatsTable substats={card.substats} />
            </DossierSection>

            <DossierSection number="08" title="Complete Audit Trail" eyebrow="All roles">
              {ratings ? (
                <AuditAccordion audits={ratings.audits} />
              ) : ratingsError ? (
                <ErrorState message="Audit trail unavailable." />
              ) : (
                <Loading />
              )}
            </DossierSection>

            {similar && (
              <DossierSection number="09" title="Similar Players" eyebrow="Style and value comparisons">
                <SimilarPlayers data={similar} />
              </DossierSection>
            )}
          </div>
        </>
      ) : (
        <>
          <PlayerCardHeader card={card} />
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

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <DossierSection number="01" title="Market Value" eyebrow="Ranges and confidence">
              <MarketValuePanel market={card.market} />
            </DossierSection>
            <DossierSection number="02" title="Context & Coverage" eyebrow="Evidence">
              <ContextPanel context={card.context} />
            </DossierSection>
          </div>
        </>
      )}

      <Section title="Sources, Version & Limitations" eyebrow="Data provenance">
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
