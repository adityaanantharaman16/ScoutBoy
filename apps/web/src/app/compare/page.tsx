"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { EmptyState, ErrorState, Loading, PageHeader, ScopeBanner } from "@/components/common";
import { PlayerCompareTable } from "@/components/compare/PlayerCompareTable";
import { ROLES, SCOPE_BANNER } from "@/lib/constants";
import { useAllPlayersLite, useCompare } from "@/lib/api/hooks";

function ComparePageInner() {
  const params = useSearchParams();
  const { data: players } = useAllPlayersLite();
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const [role, setRole] = useState<string>("");

  useEffect(() => {
    const initA = params.get("a");
    const initB = params.get("b");
    /* eslint-disable react-hooks/set-state-in-effect --
     * URL search params are external navigation state and intentionally update
     * the controlled selectors when the active URL changes. */
    if (initA) setA(Number(initA));
    if (initB) setB(Number(initB));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [params]);

  const { data, isLoading, isError, error } = useCompare(a, b, role || undefined);

  const options = players?.items ?? [];

  return (
    <div>
      <ScopeBanner text={SCOPE_BANNER} />
      <PageHeader
        eyebrow="Analytical decision surface"
        title="Compare players"
        lead="Select two players and a role to weigh them side by side. The conclusion, per-side confidence, and any confidence warnings come straight from the ScoutBoy compare API — nothing is recomputed here."
      />

      <div className="card mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="label">Player A</span>
          <select
            data-testid="compare-a"
            className="input"
            value={a ?? ""}
            onChange={(e) => setA(e.target.value ? Number(e.target.value) : null)}
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
          <span className="label">Player B</span>
          <select
            data-testid="compare-b"
            className="input"
            value={b ?? ""}
            onChange={(e) => setB(e.target.value ? Number(e.target.value) : null)}
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
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="">Automatic role</option>
            {ROLES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-ink-soft">
            Uses Player A’s best-rated role, falling back to Player B’s.
          </span>
        </label>
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
