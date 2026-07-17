import type { ContextPanel as ContextPanelType } from "@/lib/api/types";

function Mult({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-medium">{value == null ? "—" : `×${value.toFixed(2)}`}</span>
    </div>
  );
}

function Value({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-right text-sm font-medium">{value ?? "—"}</span>
    </div>
  );
}

export function ContextPanel({ context }: { context: ContextPanelType | null | undefined }) {
  if (!context) return <div className="card text-sm text-slate-400">No context data.</div>;
  const coverage =
    context.competition_coverage_pct == null && context.matches_covered == null
      ? null
      : context.competition_coverage_pct == null
      ? "Selective"
      : `${Math.round(context.competition_coverage_pct * 100)}%`;
  return (
    <div className="card space-y-3" data-testid="context-panel">
      <div className="space-y-1.5">
        <Value label="Source" value={context.data_source} />
        <Value label="Data type" value={context.data_type} />
        <Value label="Last updated" value={context.data_last_updated} />
      </div>

      <div className="space-y-1.5 border-t border-white/10 pt-2">
        <Value label="Appearances" value={context.appearances} />
        <Value label="Starts" value={context.starts} />
        <Value label="Matches covered" value={context.matches_covered} />
        <Value label="Competition coverage" value={coverage} />
      </div>

      <div className="space-y-1.5 border-t border-white/10 pt-2">
        <Value label="Sample confidence" value={context.sample_size_confidence ?? context.sample_confidence} />
        <Value label="Coverage confidence" value={context.coverage_confidence} />
        <Value label="League adjustment" value={context.league_adjustment_confidence} />
        <Value label="Role similarity" value={context.role_similarity_confidence} />
        <Value label="Overall evidence" value={context.overall_rating_confidence} />
      </div>

      <div className="space-y-1.5 border-t border-white/10 pt-2">
        <Mult label="League strength" value={context.league_strength} />
        <Mult label="Team strength" value={context.team_strength} />
        <Mult label="Opposition quality" value={context.opposition_quality} />
        <Mult label="Competition stakes" value={context.competition_stakes} />
        <Mult label="Role usage" value={context.role_usage} />
        <Mult label="Sample reliability" value={context.sample_reliability} />
      </div>
      <div className="flex items-center justify-between border-t border-white/10 pt-1.5">
        <span className="text-sm text-slate-400">Minutes</span>
        <span className="text-sm font-medium">{context.minutes ?? "—"}</span>
      </div>
      {context.limitations?.slice(0, 2).map((item) => (
        <p key={item} className="pt-1 text-xs text-slate-500">
          {item}
        </p>
      ))}
      {context.translation_risk && (
        <p className="pt-1 text-xs text-slate-500">{context.translation_risk}</p>
      )}
      {context.attribution && (
        <p className="pt-1 text-xs text-slate-500">{context.attribution}</p>
      )}
    </div>
  );
}
