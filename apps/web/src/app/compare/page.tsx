"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";

import { EmptyState, ErrorState, Loading, Notice, PageHeader, ScopeBanner } from "@/components/common";
import { PlayerCompareTable } from "@/components/compare/PlayerCompareTable";
import { SaveComparisonControl } from "@/components/saved/SaveComparisonControl";
import { ROLES, SCOPE_BANNER } from "@/lib/constants";
import { useAllPlayersLite, useCompare } from "@/lib/api/hooks";

const ROLE_KEYS = ROLES.map((r) => r.key);

/**
 * A player id from the URL: a positive integer and nothing else.
 *
 * `Number("abc")` is `NaN` and `Number("")` is `0`, and both previously reached
 * `useCompare` as a selector value — so a malformed link left the page in a state
 * the selectors could not display and the API could not answer.
 */
function parsePlayerId(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** A role from the URL, or null for Automatic Role. Unknown keys are dropped. */
function parseRole(raw: string | null): string | null {
  return raw != null && ROLE_KEYS.includes(raw) ? raw : null;
}

function ComparePageInner() {
  const params = useSearchParams();
  const pathname = usePathname();
  const { data: players } = useAllPlayersLite();

  /**
   * The URL is the single source of truth for all three selectors.
   *
   * Before 8.4B this page hydrated `a` and `b` from the URL into local state
   * ONCE and then let the selectors drift: changing a player never updated the
   * address bar, `role` was never in the URL at all, and back/forward restored
   * neither. A comparison was therefore unshareable, unbookmarkable, and
   * impossible to save as a setup — which is precisely what 8.4B has to store.
   *
   * Deriving straight from `useSearchParams` rather than mirroring into state
   * removes the drift by construction: there is no second copy to fall out of
   * step, and back/forward restores all three because it restores the URL.
   */
  const a = parsePlayerId(params.get("a"));
  const b = parsePlayerId(params.get("b"));
  const role = parseRole(params.get("role"));

  /** Whether the URL carried something for a slot that could not be honoured. */
  const malformed = useMemo(
    () => ({
      a: params.get("a") != null && a === null,
      b: params.get("b") != null && b === null,
      role: params.get("role") != null && role === null,
    }),
    [params, a, b, role],
  );

  // Memoized before it is used as a dependency: `players?.items ?? []` produces a
  // fresh array identity on every render while the query is still resolving, which
  // would rebuild the lookup below on every pass.
  const options = useMemo(() => players?.items ?? [], [players]);
  const byId = useMemo(() => new Map(options.map((p) => [p.id, p])), [options]);

  /**
   * Writes the canonical URL for a selection.
   *
   * `push`, not `replace`: choosing a different player is a deliberate step in a
   * decision, so it earns a history entry a scout can walk back — unlike a
   * Discovery filter keystroke, which would leave one entry per character.
   *
   * Automatic Role omits `role` entirely rather than writing an "auto" sentinel,
   * so the canonical URL for the default is the short one and two links that mean
   * the same thing are the same string.
   */
  const select = (next: { a?: number | null; b?: number | null; role?: string | null }) => {
    const nextA = next.a === undefined ? a : next.a;
    const nextB = next.b === undefined ? b : next.b;
    const nextRole = next.role === undefined ? role : next.role;

    const search = new URLSearchParams();
    if (nextA !== null) search.set("a", String(nextA));
    if (nextB !== null) search.set("b", String(nextB));
    if (nextRole !== null) search.set("role", nextRole);

    const suffix = search.toString();
    window.history.pushState(null, "", suffix ? `${pathname}?${suffix}` : pathname);
  };

  const { data, isLoading, isError, error } = useCompare(a, b, role ?? undefined);

  const playerA = a !== null ? { id: a, name: byId.get(a)?.canonical_name ?? `Player ${a}` } : null;
  const playerB = b !== null ? { id: b, name: byId.get(b)?.canonical_name ?? `Player ${b}` } : null;

  return (
    <div>
      <ScopeBanner text={SCOPE_BANNER} />
      <PageHeader
        eyebrow="Analytical decision surface"
        title="Compare players"
        lead="Select two players and a role to weigh them side by side. The conclusion, per-side confidence, and any confidence warnings come straight from the ScoutBoy compare API - nothing is recomputed here."
      />

      {/* An honest unavailable state rather than a silent correction: a link that
          carried something unusable is told so, and the selector it belongs to is
          simply left unset. Nothing is guessed on the scout's behalf. */}
      {(malformed.a || malformed.b || malformed.role) && (
        <div className="mb-4" data-testid="compare-url-notice">
          <Notice title="Part of this link could not be used" tone="caution">
            {[
              malformed.a && "Player 1",
              malformed.b && "Player 2",
              malformed.role && "the selected role",
            ]
              .filter(Boolean)
              .join(", ")}{" "}
            {malformed.role && !malformed.a && !malformed.b
              ? "is no longer available, so this comparison opened with Automatic Role."
              : "could not be read from this link. Choose again below."}
          </Notice>
        </div>
      )}

      <div className="card mb-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="label">Player 1</span>
            <select
              data-testid="compare-a"
              className="input"
              value={a ?? ""}
              onChange={(e) => select({ a: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Select…</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.canonical_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Player 2</span>
            <select
              data-testid="compare-b"
              className="input"
              value={b ?? ""}
              onChange={(e) => select({ b: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Select…</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.canonical_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Role</span>
            <select
              data-testid="compare-role-select"
              className="input"
              value={role ?? ""}
              onChange={(e) => select({ role: e.target.value || null })}
            >
              <option value="">Automatic Role</option>
              {ROLES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-ink-soft">
              Chooses the shared rated role where both players have the strongest joint fit.
            </span>
          </label>
        </div>

        {/* Save comparison sits with the selection it describes rather than in a
            fourth floating box at the bottom of the viewport — the bottom rail
            already carries the compare tray and the account suggestion. */}
        <div className="mt-3 flex justify-start border-t border-line pt-3 sm:justify-end">
          <SaveComparisonControl playerA={playerA} playerB={playerB} roleKey={role} />
        </div>
      </div>

      {a == null || b == null ? (
        <EmptyState label="Pick two players to compare." />
      ) : a === b ? (
        <ErrorState message="Choose two different players." />
      ) : isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message ?? "Failed to compare"} />
      ) : data ? (
        <PlayerCompareTable data={data} />
      ) : null}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<Loading />}>
      <ComparePageInner />
    </Suspense>
  );
}
