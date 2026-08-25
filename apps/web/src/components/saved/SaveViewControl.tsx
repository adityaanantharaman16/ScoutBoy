"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { NamePanel } from "@/components/saved/NamePanel";
import {
  discoveryViewCriteriaCount,
  isEmptyDiscoveryView,
  sameDiscoveryView,
  type DiscoveryView,
} from "@/lib/filters/canonical";
import { useSavedWork } from "@/lib/state/saved-work";

/**
 * The Discovery "Save View" action.
 *
 * WHERE it is, and why not in the filter rail: the rail is 248px wide and already
 * intentionally dense — an always-visible save control plus a list of saved views
 * would turn cohort narrowing into collection management and push the controls a
 * scout actually came for below the fold. This sits at the RESULTS level, beside
 * the ledger heading, because saving a view is something you do once you can see
 * what the view produced. Managing saved views lives on `/saved`.
 *
 * The button is one `.btn` and the panel is anchored to it, so the closed state
 * costs a single control's worth of space and the open state costs none of the
 * page's layout at all.
 *
 * It reports what actually happened rather than assuming success: a duplicate
 * cohort renames the existing view and says so, a quota failure says the view was
 * NOT saved, and neither is announced until the write has settled.
 */
export function SaveViewControl({ view }: { view: DiscoveryView }) {
  const { views } = useSavedWork();
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

  /**
   * The saved view this cohort already IS, if any.
   *
   * Compared by canonical identity rather than by name, so a scout who saved this
   * exact cohort under another name is offered a rename instead of a second copy
   * of the same thing. Recomputed from the live view, so it stays correct as
   * filters change.
   */
  const existing = useMemo(
    () => views.items.find((item) => sameDiscoveryView(item.view, view)),
    [views.items, view],
  );

  const criteria = discoveryViewCriteriaCount(view);
  const empty = isEmptyDiscoveryView(view);

  const close = () => {
    setOpen(false);
    setError(null);
    triggerRef.current?.focus();
  };

  const submit = async (label: string) => {
    setBusy(true);
    setError(null);
    // AWAITED. For a guest this settles as soon as the device write lands; for a
    // signed-in scout it settles only when the SERVER has confirmed. Until then
    // the panel stays open, keeps the typed name, and stays busy - nothing here
    // announces a save the account has not taken.
    const result = await views.save(label, view);
    setBusy(false);
    if (!result.ok) {
      // The intent was replaced, or the account moved on. Nothing to announce in
      // either direction, so say nothing and simply stop being busy.
      if (result.disposition === "superseded") return;
      // Stays open, with the typed name intact, so a retry costs nothing.
      setError(result.message ?? "That could not be saved.");
      return;
    }
    if (!openRef.current) return;
    setOpen(false);
    triggerRef.current?.focus();
    setNotice(
      result.disposition === "created"
        ? `Saved this Discovery view as ${label}.`
        : result.disposition === "updated"
          ? `You had already saved this cohort. It is now called ${label}.`
          : `This cohort is already saved as ${label}.`,
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
        // The state is in the name, not only in the icon: a scout using a screen
        // reader is told whether this cohort is already saved before they open it.
        // Begins with the VISIBLE label, so the accessible name contains it
        // (WCAG 2.2 SC 2.5.3 Label in Name) while still saying more than the
        // two words on the control do.
        aria-label={
          existing
            ? `Saved View: rename ${existing.label}, the saved Discovery view for these filters`
            : "Save View: keep this Discovery setup"
        }
        data-testid="save-view-trigger"
        data-saved={existing ? "true" : "false"}
        disabled={empty}
        // A view that narrows nothing is the bare ledger. Saving it would store an
        // artifact that reopens to exactly where "Discover" already goes, so the
        // control says why instead of storing it.
        title={empty ? "Add at least one filter before saving a view." : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {existing ? "Saved View" : "Save View"}
      </button>

      <NamePanel
        open={open}
        title={existing ? "Rename this saved Discovery view" : "Save this Discovery view"}
        submitLabel={existing ? "Rename View" : "Save View"}
        initialValue={existing?.label ?? ""}
        description={
          existing
            ? "These filters are already saved. Renaming updates the existing Discovery view rather than adding another."
            : `Saves these ${criteria} ${criteria === 1 ? "criterion" : "criteria"} and the current sort. Opening it later always starts on page 1.`
        }
        busy={busy}
        error={error}
        onSubmit={submit}
        onClose={close}
        testId="save-view-panel"
      />

      {/* Polite, and carrying only the NEW information — the outcome. It queues
          behind any existing announcement rather than interrupting it. */}
      <span className="sr-only" role="status" data-testid="save-view-notice">
        {notice}
      </span>
    </div>
  );
}
