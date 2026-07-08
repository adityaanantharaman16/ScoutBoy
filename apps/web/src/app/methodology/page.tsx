"use client";

import { ErrorState, Loading, ScopeBanner, Section } from "@/components/common";
import { useMethodology } from "@/lib/api/hooks";

export default function MethodologyPage() {
  const { data, isLoading, isError, error } = useMethodology();
  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message ?? "Failed to load"} />;

  return (
    <div>
      <ScopeBanner text={data.scope} />
      <h1 className="mb-4 text-2xl font-bold">Methodology</h1>

      <Section title="RoleFit rating">
        <div className="card">
          <p className="text-sm text-slate-300">
            Each role is scored from peer-group percentiles of weighted metric groups, then adjusted
            for context and confidence. The formula:
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-black/30 p-3 text-xs text-accent-soft">
            {data.formula}
          </pre>
          <p className="mt-2 text-xs text-slate-500">
            Versions — rating: {data.rating_version}, playstyles: {data.playstyle_version}, market:{" "}
            {data.market_version}
          </p>
        </div>
      </Section>

      <Section title="Context adjustments">
        <div className="card space-y-1.5">
          {data.context_dimensions.map((c) => (
            <div key={c.key} className="text-sm">
              <span className="font-medium text-accent-soft">{c.key.replace(/_/g, " ")}</span>
              <span className="text-slate-400"> — {c.explanation}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Roles (${data.roles.length})`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.roles.map((r) => (
            <div key={r.role_key} className="card">
              <div className="font-medium">{r.display_name}</div>
              <div className="text-xs text-slate-500">{r.position_group}</div>
              <p className="mt-1 text-xs text-slate-400">{r.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {r.groups.map((g) => (
                  <span key={g.key} className="chip border-white/10 bg-white/5 text-[11px]">
                    {g.key.replace(/_/g, " ")} {Math.round(g.weight * 100)}%
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Playstyles & concerns">
        <div className="card">
          <div className="mb-2 flex flex-wrap gap-1">
            {data.playstyles.map((p) => (
              <span key={p.key} className="chip border-accent/30 bg-accent/10 text-accent-soft">
                {p.display_name}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {data.concerns.map((c) => (
              <span key={c.key} className="chip border-rose-500/30 bg-rose-500/10 text-rose-200">
                {c.display_name}
              </span>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Data sources">
        <div className="card space-y-2">
          {data.data_sources.map((s) => (
            <div key={s.name} className="text-sm">
              <span className="font-medium">{s.name}</span>
              <span className="text-slate-400"> — {s.role}. {s.note}</span>
              {s.url && (
                <a href={s.url} className="ml-1 text-accent-soft hover:underline" target="_blank" rel="noreferrer">
                  link
                </a>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Limitations">
        <ul className="card list-disc space-y-1 pl-6 text-sm text-slate-300">
          {data.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
