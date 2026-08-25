"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { NamePanel } from "@/components/saved/NamePanel";
import { ROLES } from "@/lib/constants";
import { useSavedWork } from "@/lib/state/saved-work";

/**
 * The Compare "Save Comparison" action.
 *
 * Sits with the selection controls it describes, not in a floating box at the
 * bottom of the viewport: the bottom rail already carries the compare tray and
 * the account suggestion, and a third anchored surface there would start
 * competing for the same edge. Saving a comparison is part of setting one up, so
 * the control belongs where the setup is.
 *
 * What it stores is a SETUP — the two players in their chosen screen positions
 * and the selected role — and never a result. Reopening it runs current ScoutBoy
 * analysis, so a score from three weeks ago can never be shown as though it were
 * still true.
 */
export function SaveComparisonControl({
  playerA,
  playerB,
  roleKey,
}: {
  playerA: { id: number; name: string } | null;
  playerB: { id: number; name: string } | null;
  roleKey: string | null;
}) {
  const { comparisons } = useSavedWork();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  /**
   * Whether the panel is still the one the scout is looking at.
   *
   * A signed-in write is now AWAITED, so the panel can be dismissed (Escape,
   * Cancel) while the request is still in flight. Without this guard the late
   * resolution would yank focus back to a trigger the scout had already left.
   */
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // A comparison is only savable once it is a real comparison: two different
  // players. The button says why rather than failing on submit.
  const complete = playerA !== null && playerB !== null && playerA.id !== playerB.id;

  const existing = useMemo(() => {
    if (!complete) return undefined;
    return comparisons.items.find(
      (item) =>
        item.playerA.playerId === playerA.id &&
        item.playerB.playerId === playerB.id &&
        (item.roleKey ?? null) === roleKey,
    );
  }, [comparisons.items, complete, playerA, playerB, roleKey]);

  const roleLabel = roleKey
    ? (ROLES.find((r) => r.key === roleKey)?.label ?? roleKey)
    : "Automatic Role";

  const suggested =
    complete && playerA && playerB ? `${playerA.name} vs ${playerB.name}` : "";

  const close = () => {
    setOpen(false);
    setError(null);
    triggerRef.current?.focus();
  };

  const submit = async (label: string) => {
    if (!playerA || !playerB) return;
    setBusy(true);
    setError(null);
    // AWAITED: a signed-in save settles only once the server confirms it.
    const result = await comparisons.save(
      label,
      { playerId: playerA.id, name: playerA.name },
      { playerId: playerB.id, name: playerB.name },
      roleKey,
    );
    setBusy(false);
    if (!result.ok) {
      if (result.disposition === "superseded") return;
      setError(result.message ?? "That could not be saved.");
      return;
    }
    if (!openRef.current) return;
    setOpen(false);
    triggerRef.current?.focus();
    setNotice(
      result.disposition === "created"
        ? `Saved this comparison setup as ${label}.`
        : result.disposition === "updated"
          ? `You had already saved this comparison setup. It is now called ${label}.`
          : `This comparison setup is already saved as ${label}.`,
    );
    window.setTimeout(() => setNotice((current) => (current.includes(label) ? "" : current)), 4000);
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="btn px-2.5 py-1.5 text-xs"
        aria-expanded={open}
        aria-haspopup="dialog"
        // Begins with the VISIBLE label; see `SaveViewControl`.
        aria-label={
          existing
            ? `Saved Comparison: rename ${existing.label}`
            : "Save Comparison: keep this setup, these two players and this role"
        }
        data-testid="save-comparison-trigger"
        data-saved={existing ? "true" : "false"}
        disabled={!complete}
        title={complete ? undefined : "Select two different players before saving."}
        onClick={() => setOpen((v) => !v)}
      >
        {existing ? "Saved Comparison" : "Save Comparison"}
      </button>

      <NamePanel
        open={open}
        title={existing ? "Rename this saved comparison" : "Save this comparison setup"}
        submitLabel={existing ? "Rename Comparison" : "Save Comparison"}
        initialValue={existing?.label ?? suggested}
        description={
          existing
            ? "This setup is already saved. Renaming updates it rather than adding another."
            : `Saves these two players in this order, in ${roleLabel}. Reopening it loads current analysis; no score is stored.`
        }
        busy={busy}
        error={error}
        onSubmit={submit}
        onClose={close}
        testId="save-comparison-panel"
      />

      <span className="sr-only" role="status" data-testid="save-comparison-notice">
        {notice}
      </span>
    </div>
  );
}
