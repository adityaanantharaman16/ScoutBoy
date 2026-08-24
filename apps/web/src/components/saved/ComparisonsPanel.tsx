"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { EmptyState, ErrorState, LinkButton } from "@/components/common";
import { ConfirmRemoveButton, NamePanel } from "@/components/saved/NamePanel";
import { ROLES } from "@/lib/constants";
import { useSavedWork } from "@/lib/state/saved-work";
import type { AccountSavedComparison } from "@/lib/api/saved-work";

const ROLE_KEYS = ROLES.map((r) => r.key);

/**
 * The href a saved comparison opens, in the canonical Compare URL contract.
 *
 * `role` is omitted for Automatic Role, matching what the Compare page itself
 * writes, so a saved setup and a hand-built link for the same comparison are the
 * same string.
 */
function comparisonHref(item: AccountSavedComparison, roleKey: string | null): string {
  const params = new URLSearchParams();
  params.set("a", String(item.playerA.playerId));
  params.set("b", String(item.playerB.playerId));
  if (roleKey !== null) params.set("role", roleKey);
  return `/compare?${params.toString()}`;
}

function ComparisonRow({ item }: { item: AccountSavedComparison }) {
  const { comparisons } = useSavedWork();
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

  const missing = [
    !item.playerA.available && `${item.playerA.name} (Player 1)`,
    !item.playerB.available && `${item.playerB.name} (Player 2)`,
  ].filter(Boolean) as string[];
  const openable = missing.length === 0;

  /**
   * A role that no longer exists is a RECOVERABLE loss, unlike a missing player.
   *
   * The comparison still means something without it — Automatic Role picks the
   * shared rated role where both players fit best — so the setup stays openable
   * and the fallback is explained rather than performed silently. A missing
   * player has no equivalent: there is nothing honest to substitute.
   */
  const roleAvailable = item.roleKey === null || ROLE_KEYS.includes(item.roleKey);
  const effectiveRole = roleAvailable ? item.roleKey : null;
  const roleLabel =
    effectiveRole === null
      ? "Automatic Role"
      : (ROLES.find((r) => r.key === effectiveRole)?.label ?? effectiveRole);

  const submit = async (label: string) => {
    setBusy(true);
    setError(null);
    // AWAITED: a signed-in rename settles only once the server confirms it, so
    // the panel stays open and busy until then and a failure restores the last
    // confirmed label rather than leaving the typed one on screen.
    const result = await comparisons.rename(item.clientId, label);
    setBusy(false);
    if (!result.ok) {
      if (result.disposition === "superseded") return;
      setError(result.message ?? "That could not be renamed.");
      return;
    }
    closeRename();
  };

  return (
    <div className="px-3 py-3.5" data-testid="saved-comparison-row">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="font-semibold text-ink" data-testid="saved-comparison-label">
            {item.label}
          </div>
          <div className="mt-0.5 text-xs text-ink-muted" data-testid="saved-comparison-players">
            {/* The saved names, in their saved screen positions. An unavailable
                side keeps its name and is marked — never replaced by a different
                player, and never quietly dropped. */}
            {item.playerA.name}
            {!item.playerA.available && " (no longer available)"} vs {item.playerB.name}
            {!item.playerB.available && " (no longer available)"}
          </div>
          <div className="text-xs text-ink-soft">
            {roleLabel} · Opens with current analysis
          </div>

          {missing.length > 0 && (
            <p className="mt-2 text-xs text-accent-amber" data-testid="saved-comparison-unavailable">
              This comparison cannot be opened: {missing.join(" and ")}{" "}
              {missing.length === 1 ? "is" : "are"} no longer available. It is kept here so you can
              rename or remove it.
            </p>
          )}
          {!roleAvailable && (
            <p className="mt-2 text-xs text-accent-amber" data-testid="saved-comparison-role-fallback">
              The role saved with this comparison is no longer available. Opening it uses Automatic
              Role instead.
            </p>
          )}
        </div>

        <div className="relative shrink-0">
          <div className="rail-box" data-testid="action-rail-box">
            {openable ? (
              <Link
                href={comparisonHref(item, effectiveRole)}
                className="rail-action no-underline"
                aria-label={
                  roleAvailable
                    ? `Open the saved comparison ${item.label}`
                    : `Open the saved comparison ${item.label} with Automatic Role`
                }
                data-testid="saved-comparison-open"
              >
                Open
              </Link>
            ) : (
              // Disabled rather than hidden, and it says why in its accessible
              // name: a control that vanishes tells a keyboard user nothing.
              <button
                type="button"
                className="rail-action opacity-55"
                disabled
                aria-label={`Cannot open ${item.label}: a player is no longer available`}
                data-testid="saved-comparison-open-disabled"
              >
                Open
              </button>
            )}
            <button
              ref={renameRef}
              type="button"
              className="rail-action"
              aria-label={`Rename the saved comparison ${item.label}`}
              aria-expanded={renaming}
              aria-haspopup="dialog"
              data-testid="saved-comparison-rename"
              onClick={() => setRenaming((v) => !v)}
            >
              Rename
            </button>
            <ConfirmRemoveButton
              what={`the saved comparison ${item.label}`}
              testId="saved-comparison-remove"
              onConfirm={() => {
                void comparisons.remove(item.clientId);
              }}
            />
          </div>

          <NamePanel
            open={renaming}
            title="Rename this saved comparison"
            submitLabel="Rename Comparison"
            initialValue={item.label}
            busy={busy}
            error={error}
            onSubmit={submit}
            onClose={closeRename}
            testId="saved-comparison-rename-panel"
          />
        </div>
      </div>
    </div>
  );
}

export function ComparisonsPanel() {
  const { comparisons } = useSavedWork();

  return (
    <>
      {comparisons.error && (
        <div className="mb-4" data-testid="saved-comparisons-error">
          <ErrorState message={comparisons.error} />
          <div className="mt-2">
            <button
              type="button"
              className="btn px-3 py-2 text-xs"
              data-testid="saved-comparisons-retry"
              onClick={comparisons.retry}
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {comparisons.items.length === 0 ? (
        <EmptyState
          label="No saved comparisons yet. Pick two players and a role on Compare, then use Save Comparison beside the selectors to keep that setup."
          action={<LinkButton href="/compare">Go To Compare</LinkButton>}
        />
      ) : (
        <div
          className="divide-y divide-line overflow-hidden border border-line bg-paper-panel"
          data-testid="saved-comparisons-ledger"
        >
          {comparisons.items.map((item) => (
            <ComparisonRow key={item.clientId} item={item} />
          ))}
        </div>
      )}
    </>
  );
}
