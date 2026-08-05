import Link from "next/link";

import { DisplayTag, displayTagClass, MarketReadout, ScoreReadout } from "@/components/common";
import { ConfidenceMeter } from "@/components/player/ConfidenceMeter";
import { confidenceText, coverageSpokenText, coverageStatusText } from "@/lib/formatters";

// The shared scouting-ledger row presentation, used by discovery results and by
// My Favorites saved players so the two surfaces stay dimensionally symmetrical.
// A row is one entry of a continuous ledger — never an isolated card, never a
// nested collection of cards. Geometry lives in the `.ledger-*` rules in
// globals.css; the leaderboard, dossier, comparison and methodology surfaces keep
// their own compositions and are unaffected.

/** The row shell: three structural regions at lg+, a clean stack below it. */
export function LedgerRow({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <article
      // The hover transition now comes from `.ledger-row` in globals.css as an
      // explicit `background-color` change, not the broad Tailwind utility: a
      // ledger of 12 rows must never carry promoted transform/filter layers.
      className="ledger-row px-4 py-3.5 hover:bg-paper-muted/50"
      data-testid={testId}
    >
      {children}
    </article>
  );
}

/**
 * Below lg this is the identity/RoleFit header, wrapping to a stack once the two
 * no longer fit side by side; at lg+ it dissolves (`display: contents`) so both
 * become sibling regions of the row grid.
 */
export function LedgerHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 lg:contents">
      {children}
    </div>
  );
}

/** Player information: the linked name plus whatever context lines the surface's
 *  response honestly supplies. */
export function LedgerIdentity({
  href,
  name,
  nameTestId,
  children,
}: {
  href: string;
  name: string;
  nameTestId: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="ledger-identity min-w-0 flex-1 basis-44" data-testid="row-identity">
      <Link href={href} data-testid={nameTestId} className="no-underline">
        <span className="tracking-tight text-lg font-bold leading-tight text-ink hover:underline">
          {name}
        </span>
      </Link>
      {children}
    </div>
  );
}

/**
 * The RoleFit hero: compact eyebrow, band-coloured score, and the selected/best
 * role directly beneath it. Hierarchy comes from alignment, size and whitespace
 * plus one restrained hairline — there is no surrounding box or card. The caption
 * wraps on word boundaries inside the fixed hero track, so a long role name never
 * moves the divider.
 */
export function LedgerRoleFitHero({
  hasAnalysis,
  score,
  role,
}: {
  hasAnalysis: boolean;
  score: number | null | undefined;
  role: string | null | undefined;
}) {
  return (
    <div
      className="ledger-hero shrink-0 text-right lg:border-l lg:border-line lg:pl-5 lg:text-left"
      data-testid="row-rolefit"
    >
      <div className="label mb-1">RoleFit</div>
      {hasAnalysis ? (
        <ScoreReadout score={score} caption={role ?? "-"} captionWrap="words" size="lg" />
      ) : (
        <DisplayTag variant="evidence" value="profile_only">
          Profile Only
        </DisplayTag>
      )}
    </div>
  );
}

/**
 * Compound coverage + confidence status.
 *
 * The two facts are grouped into one sharp-edged unit so a row scans quickly,
 * but they are never collapsed into a single inferred status: coverage comes
 * from `evidence_status`, confidence independently from `confidence`, both
 * segments carry equal typographic weight, and the confidence glyph stays
 * monochrome (never the score palette). High coverage therefore never implies
 * high confidence. Profile-only rows show coverage alone — no confidence bars
 * are invented for a player who was never rated.
 */
export function CoverageConfidenceStatus({
  evidenceStatus,
  confidence,
  hasAnalysis,
}: {
  evidenceStatus: string | null | undefined;
  confidence: string | null | undefined;
  hasAnalysis: boolean;
}) {
  const spokenConfidence = hasAnalysis
    ? confidenceText(confidence).toLowerCase()
    : "not available";
  return (
    <span
      // Shared tag geometry/tone via the helper: this unit carries its own
      // grouping ARIA and coverage data attribute.
      className={displayTagClass("evidence", evidenceStatus, true)}
      data-tag-variant="evidence"
      data-testid="card-status"
      data-coverage={evidenceStatus ?? "unknown"}
      // One description for the whole unit, so the two facts stay explicitly
      // separate for assistive tech instead of running together as one status.
      // The visible segments carry no prefixes, hence the label rather than
      // sr-only text.
      role="group"
      aria-label={`Evidence coverage: ${coverageSpokenText(evidenceStatus)}. RoleFit confidence: ${spokenConfidence}.`}
    >
      <span aria-hidden="true">{coverageStatusText(evidenceStatus)}</span>
      {hasAnalysis && (
        <>
          <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-line-strong" />
          <span aria-hidden="true" className="inline-flex items-center gap-1.5">
            <ConfidenceMeter level={confidence} showWord={false} />
            <span>{confidenceText(confidence)} Confidence</span>
          </span>
        </>
      )}
    </span>
  );
}

/**
 * Playstyles on their own line. They are player traits, not a reliability or
 * market status, so they never share a container with either. Supplied order is
 * preserved and nothing is fabricated; the fallbacks stay plain text rather than
 * posing as badges.
 */
export function PlaystyleLine({
  playstyles,
  hasAnalysis,
}: {
  playstyles: string[];
  hasAnalysis: boolean;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-testid="status-line-playstyles"
    >
      {playstyles.length > 0 ? (
        playstyles.map((s) => (
          <DisplayTag key={s} variant="playstyle">
            {s}
          </DisplayTag>
        ))
      ) : !hasAnalysis ? (
        <span className="text-xs text-ink-soft" data-testid="profile-only-card">
          Analysis unavailable
        </span>
      ) : (
        <span className="text-xs text-ink-soft" data-testid="no-playstyles">
          No qualifying playstyles
        </span>
      )}
    </div>
  );
}

/**
 * The three status families as three explicitly stacked block lines: coverage +
 * confidence, then market, then playstyles. Each is its own container, so the
 * market box can never ride up onto the coverage line when horizontal room
 * happens to allow it.
 */
export function LedgerStatusStack({
  evidenceStatus,
  confidence,
  hasAnalysis,
  marketLabel,
  marketLow,
  marketHigh,
  playstyles,
}: {
  evidenceStatus: string | null | undefined;
  confidence: string | null | undefined;
  hasAnalysis: boolean;
  marketLabel: string | null | undefined;
  marketLow: number | null | undefined;
  marketHigh: number | null | undefined;
  playstyles: string[];
}) {
  return (
    <div
      className="ledger-status-stack mt-2.5 space-y-1.5 lg:mt-2"
      data-testid="row-status-stack"
    >
      <div data-testid="status-line-coverage">
        <CoverageConfidenceStatus
          evidenceStatus={evidenceStatus}
          confidence={confidence}
          hasAnalysis={hasAnalysis}
        />
      </div>
      <div data-testid="status-line-market">
        <MarketReadout layout="ledger" label={marketLabel} low={marketLow} high={marketHigh} />
      </div>
      <PlaystyleLine playstyles={playstyles} hasAnalysis={hasAnalysis} />
    </div>
  );
}

/** The rightmost full-height action rail at lg+; the row's bottom rail below it. */
export function LedgerActionRail({ children }: { children: React.ReactNode }) {
  return (
    <div className="ledger-rail mt-3 lg:mt-0" data-testid="action-rail">
      {children}
    </div>
  );
}
