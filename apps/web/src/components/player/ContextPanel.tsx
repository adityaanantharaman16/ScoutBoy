import type { ContextPanel as ContextPanelType } from "@/lib/api/types";

function Mult({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-medium">{value == null ? "—" : `×${value.toFixed(2)}`}</span>
    </div>
  );
}

export function ContextPanel({ context }: { context: ContextPanelType | null | undefined }) {
  if (!context) return <div className="card text-sm text-slate-400">No context data.</div>;
  return (
    <div className="card space-y-1.5" data-testid="context-panel">
      <Mult label="League strength" value={context.league_strength} />
      <Mult label="Team strength" value={context.team_strength} />
      <Mult label="Opposition quality" value={context.opposition_quality} />
      <Mult label="Competition stakes" value={context.competition_stakes} />
      <Mult label="Role usage" value={context.role_usage} />
      <Mult label="Sample reliability" value={context.sample_reliability} />
      <div className="flex items-center justify-between border-t border-white/10 pt-1.5">
        <span className="text-sm text-slate-400">Minutes</span>
        <span className="text-sm font-medium">{context.minutes ?? "—"}</span>
      </div>
      {context.translation_risk && (
        <p className="pt-1 text-xs text-slate-500">{context.translation_risk}</p>
      )}
    </div>
  );
}
