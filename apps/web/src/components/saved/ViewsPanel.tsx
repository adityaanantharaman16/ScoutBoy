"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { EmptyState, ErrorState, LinkButton } from "@/components/common";
import { ConfirmRemoveButton, NamePanel } from "@/components/saved/NamePanel";
import { POSITION_GROUPS, ROLES, SORT_OPTIONS } from "@/lib/constants";
import {
  discoveryViewCriteriaCount,
  discoveryViewHref,
  droppedFieldLabels,
  type DiscoveryView,
} from "@/lib/filters/canonical";
import { ageSelectionFromBounds, ageSummaryText } from "@/lib/filters";
import { formatEur, titleCase } from "@/lib/formatters";
import { useSavedWork } from "@/lib/state/saved-work";
import type { SavedView } from "@/lib/storage/saved-work";

/**
 * A saved view's criteria, in the rail's own words.
 *
 * Derived from the stored view rather than from a sentence stored alongside it:
 * a description written at save time would still say "Playstyle: Tempo Setter"
 * after that playstyle stopped existing. Reading it back from the criteria means
 * the row can never describe a cohort the view no longer produces.
 */
function summarize(view: DiscoveryView): string[] {
  const parts: string[] = [];
  if (view.q) parts.push(`Search: ${view.q}`);
  const age = ageSelectionFromBounds(view.age_min, view.age_max);
  if (age.direction != null) parts.push(`Age: ${ageSummaryText(age)}`);
  if (view.position_group) {
    parts.push(
      `Position Group: ${POSITION_GROUPS.find((g) => g.key === view.position_group)?.label ?? view.position_group}`,
    );
  }
  if (view.role) {
    parts.push(`Role: ${ROLES.find((r) => r.key === view.role)?.label ?? titleCase(view.role)}`);
  }
  if (view.league) parts.push(`League: ${view.league}`);
  if (view.club) parts.push(`Club: ${view.club}`);
  if (view.nationality) parts.push(`Nationality: ${view.nationality}`);
  if (view.playstyle) parts.push(`Playstyle: ${titleCase(view.playstyle)}`);
  if (view.min_minutes != null) parts.push(`Minimum Minutes: ${view.min_minutes.toLocaleString("en-US")}`);
  if (view.rolefit_min != null) parts.push(`Minimum RoleFit: ${view.rolefit_min}`);
  if (view.rolefit_max != null) parts.push(`Maximum RoleFit: ${view.rolefit_max}`);
  if (view.value_min != null) parts.push(`Minimum Expected Asking: ${formatEur(view.value_min)}`);
  if (view.value_max != null) parts.push(`Maximum Expected Asking: ${formatEur(view.value_max)}`);
  if (view.sort) {
    parts.push(`Sort: ${SORT_OPTIONS.find((s) => s.key === view.sort)?.label ?? view.sort}`);
  }
  return parts;
}

function ViewRow({ item }: { item: SavedView }) {
  const { views } = useSavedWork();
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renameRef = useRef<HTMLButtonElement | null>(null);

  /**
   * Closing the panel returns focus to the control that opened it.
   *
   * Without this, dismissing with Escape dropped focus on `document.body`
   * and a keyboard user had to tab back through the whole row to carry on -
   * which is exactly the WCAG 2.2 focus-management failure the naming panel
   * exists to avoid.
   */
  const closeRename = () => {
    setRenaming(false);
    setError(null);
    renameRef.current?.focus();
  };

  const criteria = discoveryViewCriteriaCount(item.view);
  const summary = summarize(item.view);
  const lost = droppedFieldLabels(item.unavailable);

  const submit = async (label: string) => {
    setBusy(true);
    setError(null);
    // AWAITED: a signed-in rename settles only once the server confirms it, so
    // the panel stays open and busy until then and a failure restores the last
    // confirmed label rather than leaving the typed one on screen.
    const result = await views.rename(item.clientId, label);
    setBusy(false);
    if (!result.ok) {
      if (result.disposition === "superseded") return;
      setError(result.message ?? "That could not be renamed.");
      return;
    }
    closeRename();
  };

  return (
    <div className="px-3 py-3.5" data-testid="saved-view-row">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {/* React text, never markup: a label of `<img src=x onerror=alert(1)>`
              renders as those characters and cannot execute. */}
          <div className="font-semibold text-ink" data-testid="saved-view-label">
            {item.label}
          </div>
          <div className="mt-0.5 text-xs text-ink-muted">
            {criteria === 0
              ? "No narrowing criteria"
              : `${criteria} ${criteria === 1 ? "criterion" : "criteria"}`}
          </div>
          {summary.length > 0 && (
            <div className="mt-1 text-xs text-ink-soft" data-testid="saved-view-summary">
              {summary.join(" · ")}
            </div>
          )}
          {lost.length > 0 && (
            <p className="mt-2 text-xs text-accent-amber" data-testid="saved-view-unavailable">
              Part of this saved Discovery view is no longer supported ({lost.join(", ")}).
              Opening it restores everything else; update or remove it to keep it accurate.
            </p>
          )}
        </div>

        <div className="relative shrink-0">
          <div className="rail-box" data-testid="action-rail-box">
            {/* A real link, so it opens in a new tab on the modifier a scout
                expects and creates a genuine history entry when it does not. */}
            <Link
              href={discoveryViewHref(item.view)}
              className="rail-action no-underline"
              aria-label={`Open the saved Discovery view ${item.label}`}
              data-testid="saved-view-open"
            >
              Open
            </Link>
            <button
              ref={renameRef}
              type="button"
              className="rail-action"
              aria-label={`Rename the saved Discovery view ${item.label}`}
              aria-expanded={renaming}
              aria-haspopup="dialog"
              data-testid="saved-view-rename"
              onClick={() => setRenaming((v) => !v)}
            >
              Rename
            </button>
            <ConfirmRemoveButton
              what={`the saved Discovery view ${item.label}`}
              testId="saved-view-remove"
              onConfirm={() => {
                void views.remove(item.clientId);
              }}
            />
          </div>

          <NamePanel
            open={renaming}
            title="Rename this saved Discovery view"
            submitLabel="Rename View"
            initialValue={item.label}
            busy={busy}
            error={error}
            onSubmit={submit}
            onClose={closeRename}
            testId="saved-view-rename-panel"
          />
        </div>
      </div>
    </div>
  );
}

export function ViewsPanel() {
  const { views } = useSavedWork();

  return (
    <>
      {views.error && (
        <div className="mb-4" data-testid="saved-views-error">
          <ErrorState message={views.error} />
          <div className="mt-2">
            <button
              type="button"
              className="btn px-3 py-2 text-xs"
              data-testid="saved-views-retry"
              onClick={views.retry}
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {views.items.length === 0 ? (
        <EmptyState
          label="No saved Discovery views yet. Narrow Discovery with the filter rail, then use Save View beside the page heading to keep that cohort."
          action={<LinkButton href="/">Go To Discovery</LinkButton>}
        />
      ) : (
        <div
          className="divide-y divide-line overflow-hidden border border-line bg-paper-panel"
          data-testid="saved-views-ledger"
        >
          {views.items.map((item) => (
            <ViewRow key={item.clientId} item={item} />
          ))}
        </div>
      )}
    </>
  );
}
