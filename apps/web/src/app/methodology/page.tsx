"use client";

import { ErrorState, Loading, ScopeBanner, Section } from "@/components/common";
import { CalibrationPanel } from "@/components/methodology/CalibrationPanel";
import { useMethodology } from "@/lib/api/hooks";

export default function MethodologyPage() {
  const { data, isLoading, isError, error } = useMethodology();
  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message ?? "Failed to load"} />;

  return (
    <div>
      <ScopeBanner text={data.scope} />
      <div className="mb-5 max-w-3xl">
        <p className="label mb-1">Technical note</p>
        <h1 className="font-serif text-4xl font-bold leading-tight text-ink">Methodology</h1>
        <p className="mt-2 text-sm text-ink-muted">
          How ScoutBoy scores RoleFit, labels playstyles, models market ranges, and communicates
          limitations.
        </p>
      </div>

      <Section title="RoleFit rating" eyebrow="Formula and versions">
        <div className="card">
          <p className="text-sm text-ink-muted">
            Each role is scored from peer-group percentiles of weighted metric groups, then adjusted
            for context and confidence. The formula:
          </p>
          <pre className="mt-2 overflow-x-auto border border-line bg-paper-muted p-3 font-mono text-xs text-pitch-dark" style={{ borderRadius: 5 }}>
            {data.formula}
          </pre>
          <p className="mt-2 text-xs text-ink-soft">
            Versions — rating: {data.rating_version}, playstyles: {data.playstyle_version}, market:{" "}
            {data.market_version}
          </p>
        </div>
      </Section>

      <Section title="Calibration & evidence" eyebrow="Model evaluation">
        <CalibrationPanel calibration={data.calibration} />
      </Section>

      <Section title="Context adjustments" eyebrow="Multipliers">
        <div className="card space-y-1.5">
          {data.context_dimensions.map((c) => (
            <div key={c.key} className="text-sm">
              <span className="font-semibold text-pitch-dark">{c.key.replace(/_/g, " ")}</span>
              <span className="text-ink-muted"> — {c.explanation}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Roles (${data.roles.length})`} eyebrow="Config-driven weights">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.roles.map((r) => (
            <div key={r.role_key} className="card">
              <div className="font-serif text-xl font-bold text-ink">{r.display_name}</div>
              <div className="text-xs text-ink-soft">{r.position_group}</div>
              <p className="mt-1 text-xs text-ink-muted">{r.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {r.groups.map((g) => (
                  <span key={g.key} className="chip border-line bg-paper-muted text-[11px] text-ink-muted">
                    {g.key.replace(/_/g, " ")} {Math.round(g.weight * 100)}%
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Playstyles & concerns" eyebrow="Observed labels">
        <div className="card">
          <div className="mb-2 flex flex-wrap gap-1">
            {data.playstyles.map((p) => (
              <span key={p.key} className="chip border-pitch bg-[#e9f0ea] text-pitch-dark">
                {p.display_name}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {data.concerns.map((c) => (
              <span key={c.key} className="chip border-accent-red bg-[#f4e8e3] text-accent-red">
                {c.display_name}
              </span>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Data sources" eyebrow="Provenance">
        <div className="card space-y-2">
          {data.data_sources.map((s) => (
            <div key={s.name} className="text-sm">
              <span className="font-semibold text-ink">{s.name}</span>
              <span className="text-ink-muted"> — {s.role}. {s.note}</span>
              {s.url && (
                <a href={s.url} className="ml-1 font-semibold text-pitch-dark hover:underline" target="_blank" rel="noreferrer">
                  link
                </a>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Limitations" eyebrow="Analytical honesty">
        <ul className="card list-disc space-y-1 pl-6 text-sm text-ink-muted">
          {data.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
