"use client";

import { useMemo, useState } from "react";

import { Notice } from "@/components/common";
import { PlayerActionRow } from "@/components/common/PlayerActions";
import { ConfidenceMeter } from "@/components/player/ConfidenceMeter";
import { RoleSelector } from "@/components/player/RoleSelector";
import {
  RoleEvidenceList,
  RoleTerritoryPitch,
  useTerritoryHighlight,
} from "@/components/player/RoleTerritory";
import type { AuditBreakdown, PlayerCard, RoleRatingDetail, RoleRatingSummary } from "@/lib/api/types";
import { auditGroups, auditPenalties, bestRoleKey, findRoleAudit, findRoleSummary } from "@/lib/audit/roleAudit";
import {
  confidenceLabel,
  evidenceStatusText,
  formatAge,
  formatScore,
  marketLabelColor,
  marketLabelText,
  scoreColor,
} from "@/lib/formatters";
import { marketRangeText } from "@/lib/market/marketChart";

const PANEL_ID = "role-analysis-panel";

interface ConfidenceBreakdown {
  score?: number;
  level?: string;
}

function orderedRoles(ratings: RoleRatingSummary[]): RoleRatingSummary[] {
  return [...ratings].sort((a, b) => {
    if (a.is_best !== b.is_best) return a.is_best ? -1 : 1;
    return (b.final_score ?? -1) - (a.final_score ?? -1);
  });
}

/** Compact identity block for the left rail (replaces the wide header grid). */
function IdentityBlock({ card }: { card: PlayerCard }) {
  const id = card.identity;
  return (
    <div>
      <p className="mb-1 text-sm text-ink-soft">
        {card.season} / {id.club ?? "Club unknown"} / {id.league ?? "League unknown"}
      </p>
      <h1
        className="font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl"
        data-testid="player-name"
      >
        {id.canonical_name}
      </h1>
      <div className="mt-2 text-sm text-ink-muted">
        {formatAge(id.age)} yrs · {id.primary_position ?? "—"}
        {id.secondary_positions.length > 0 && ` (${id.secondary_positions.join(", ")})`} ·{" "}
        {id.nationality ?? "—"}
      </div>
      <div className="mt-1 text-xs text-ink-soft">
        {id.preferred_foot ? `${id.preferred_foot}-footed` : ""}
        {id.preferred_foot && id.height_cm ? " · " : ""}
        {id.height_cm ? `${id.height_cm}cm` : ""}
      </div>
      <div className="mt-3">
        <PlayerActionRow player={{ id: id.id, name: id.canonical_name }} size="md" />
      </div>
    </div>
  );
}

/** Selected-role summary: score, best indicator, confidence, evidence status. */
function SelectedRoleSummary({
  card,
  summary,
}: {
  card: PlayerCard;
  summary: RoleRatingSummary | undefined;
}) {
  return (
    <div
      className="border border-line bg-paper-panel p-4"
      style={{ borderRadius: 6 }}
      data-testid="selected-role-summary"
    >
      <div className="label">Selected Role RoleFit</div>
      <div className="mt-1 flex items-baseline gap-3">
        <span className={`font-serif text-4xl font-bold leading-none ${scoreColor(summary?.final_score)}`}>
          {formatScore(summary?.final_score)}
        </span>
        <span className="text-sm font-semibold text-ink">{summary?.display_name ?? "Unavailable"}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {summary?.is_best ? (
          <span className="chip border-pitch bg-[#e9f0ea] text-pitch-dark">Best-Rated Role</span>
        ) : (
          <span className="text-ink-soft">Not this player&apos;s best-rated role</span>
        )}
        {summary?.rank_in_peer_group ? (
          <span className="text-ink-soft">Rank #{summary.rank_in_peer_group} in peer group</span>
        ) : null}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className="text-sm text-ink-muted">RoleFit confidence</span>
        <ConfidenceMeter level={summary?.confidence} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-sm text-ink-muted">Evidence coverage</span>
        <span className="text-sm font-semibold text-ink">
          {evidenceStatusText(card.evidence_status)}
        </span>
      </div>
    </div>
  );
}

/** Expandable evidence/context/market summary (mobile: collapsible section). */
function EvidenceContextRail({ card }: { card: PlayerCard }) {
  const ctx = card.context;
  const market = card.market;
  const coverage =
    ctx?.competition_coverage_pct == null && ctx?.matches_covered == null
      ? "—"
      : ctx?.competition_coverage_pct == null
      ? "Selective"
      : `${Math.round(ctx.competition_coverage_pct * 100)}%`;

  return (
    <details
      open
      className="h-full border border-line bg-paper-panel p-4"
      style={{ borderRadius: 6 }}
      data-testid="evidence-context-rail"
    >
      <summary className="label cursor-pointer select-none">Evidence &amp; Context</summary>

      <div className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
        <Row label="Competition coverage" value={coverage} />
        <Row label="Minutes" value={ctx?.minutes ?? "—"} mono />
        <Row label="Appearances" value={ctx?.appearances ?? "—"} mono />
      </div>

      <div className="mt-2 space-y-1.5 border-t border-line pt-2 text-sm">
        <Row label="Overall evidence" value={ctx?.overall_rating_confidence ?? "—"} />
        <Row label="Sample confidence" value={ctx?.sample_size_confidence ?? ctx?.sample_confidence ?? "—"} />
        <Row label="Coverage confidence" value={ctx?.coverage_confidence ?? "—"} />
      </div>

      <div className="mt-2 border-t border-line pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-ink-muted">Market</span>
          {market ? (
            <span className={`chip ${marketLabelColor(market.label)}`}>{marketLabelText(market.label)}</span>
          ) : (
            <span className="text-sm text-ink-soft">No market data</span>
          )}
        </div>
        {market && (
          <div className="mt-1 flex items-center justify-between gap-2 text-sm">
            <span className="text-ink-muted">Asking price</span>
            <span className="font-mono font-semibold text-ink">
              {marketRangeText(market.expected_asking_low_eur, market.expected_asking_high_eur)}
            </span>
          </div>
        )}
        {market?.manual_review_required && (
          <p className="mt-1 text-xs text-accent-amber">Flagged for manual review (outlier guardrail).</p>
        )}
      </div>

      {ctx?.limitations?.slice(0, 2).map((item) => (
        <p key={item} className="mt-2 text-xs text-ink-soft">
          {item}
        </p>
      ))}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2 text-xs font-semibold text-pitch-dark">
        <a href="#market-full" className="hover:underline">
          Full market detail ↓
        </a>
        <a href="#context-full" className="hover:underline">
          Full context &amp; coverage ↓
        </a>
      </div>
    </details>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-muted">{label}</span>
      <span className={`font-semibold text-ink ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function TerritoryLoading() {
  return (
    <div className="territory-surface p-4" aria-hidden="true" data-testid="territory-loading">
      <div className="label mb-3">Role Territory</div>
      <div className="mx-auto h-[300px] w-full max-w-[320px] rounded bg-paper-muted" style={{ borderRadius: 6 }} />
      <div className="mt-3 h-3 w-3/4 rounded bg-paper-muted" />
    </div>
  );
}

function ExplanationBlock({ audit, className = "" }: { audit: AuditBreakdown; className?: string }) {
  const penalties = auditPenalties(audit);
  const hasPenalties = (penalties.items?.length ?? 0) > 0;
  if (!audit.explanation_text && !hasPenalties) return null;
  return (
    <div className={`card ${className}`}>
      <div className="label mb-1">Why This Score</div>
      {audit.explanation_text && <p className="text-sm text-ink-muted">{audit.explanation_text}</p>}
      {hasPenalties && (
        <div className="mt-2">
          <div className="label mb-1 text-accent-red">Risk penalties</div>
          {penalties.items!.map((p, i) => (
            <p key={i} className="text-xs text-ink-muted">
              {p.explanation}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function RecruitmentDesk({
  card,
  ratings,
  ratingsLoading,
  ratingsError,
}: {
  card: PlayerCard;
  ratings: RoleRatingDetail | undefined;
  ratingsLoading?: boolean;
  ratingsError?: boolean;
}) {
  const roles = useMemo(() => orderedRoles(card.role_ratings), [card.role_ratings]);
  const [selectedKey, setSelectedKey] = useState<string>(() => bestRoleKey(roles) ?? "");
  const [announcement, setAnnouncement] = useState("");
  const highlight = useTerritoryHighlight();

  const summary = findRoleSummary(roles, selectedKey);
  const audit = findRoleAudit(ratings?.audits ?? [], selectedKey);
  const groups = auditGroups(audit);
  const cb = audit?.confidence_breakdown as ConfidenceBreakdown | undefined;
  const confScore = typeof cb?.score === "number" ? cb.score : null;

  function selectRole(key: string) {
    setSelectedKey(key);
    const next = findRoleSummary(roles, key);
    if (next) {
      setAnnouncement(
        `Selected role: ${next.display_name}. RoleFit ${formatScore(next.final_score)}, ${confidenceLabel(
          next.confidence,
        ).toLowerCase()}.`,
      );
    }
  }

  const hasAnalysis = !ratingsLoading && !ratingsError && !!audit && groups.length > 0;

  return (
    <div className="space-y-6" data-testid="recruitment-desk">
      {/* live region announcing role changes */}
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="role-live-region">
        {announcement}
      </div>

      {/* Header: player identity (left) + the role selector (right). */}
      <div className="lg:grid lg:grid-cols-[minmax(300px,340px)_1fr] lg:items-start lg:gap-8">
        <IdentityBlock card={card} />
        <div className="mt-5 lg:mt-0">
          <div className="label mb-2">Choose a role to analyse</div>
          <RoleSelector
            ratings={roles}
            selectedKey={selectedKey}
            onSelect={selectRole}
            panelId={PANEL_ID}
          />
        </div>
      </div>

      {/* The role analysis (tabpanel controlled by the selector above). */}
      <div
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={`role-tab-${selectedKey}`}
        tabIndex={0}
        className="scroll-mt-24 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pitch"
      >
        {hasAnalysis ? (
          <div className="desk-analysis">
            {/* Left rail: selected-role summary + evidence/context, stretched so the
                evidence panel's bottom aligns with the pitch. */}
            <div className="desk-railtop flex h-full flex-col gap-4">
              <SelectedRoleSummary card={card} summary={summary} />
              <div className="flex flex-1 flex-col">
                <EvidenceContextRail card={card} />
              </div>
            </div>
            <RoleTerritoryPitch
              roleDisplayName={summary?.display_name ?? selectedKey}
              groups={groups}
              roleConfidence={summary?.confidence}
              confidenceScore={confScore}
              highlight={highlight}
              className="desk-pitch h-full"
            />
            <RoleEvidenceList groups={groups} highlight={highlight} className="desk-traits" />
            {/* Fills the space beneath the rail + pitch, down to the trait list. */}
            <ExplanationBlock audit={audit!} className="desk-why h-full" />
          </div>
        ) : (
          <div className="lg:grid lg:grid-cols-[minmax(300px,340px)_1fr] lg:items-start lg:gap-6">
            <div className="flex flex-col gap-4">
              <SelectedRoleSummary card={card} summary={summary} />
              <EvidenceContextRail card={card} />
            </div>
            <div>
              {ratingsLoading ? (
                <TerritoryLoading />
              ) : ratingsError ? (
                <Notice title="Role evidence unavailable" tone="critical" testId="territory-error">
                  <p>
                    The RoleFit audit for this player could not be loaded. Identity, context, market,
                    and the summary remain available. Try again shortly.
                  </p>
                </Notice>
              ) : !audit ? (
                <Notice title="Selected-role audit unavailable" tone="caution" testId="territory-unavailable">
                  <p>
                    {summary?.display_name ?? "This role"} has a RoleFit rating, but its detailed
                    evidence breakdown is not available in this dataset. ScoutBoy will not reconstruct
                    or estimate the missing breakdown.
                  </p>
                </Notice>
              ) : (
                <Notice title="No evidence groups to show" tone="caution" testId="territory-empty">
                  <p>This role&apos;s audit did not include any evidence groups.</p>
                </Notice>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
