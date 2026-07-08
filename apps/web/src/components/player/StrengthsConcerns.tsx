import type { StrengthConcern } from "@/lib/api/types";

export function StrengthsConcerns({
  strengths,
  concerns,
}: {
  strengths: StrengthConcern[];
  concerns: StrengthConcern[];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="card">
        <div className="label mb-2 text-emerald-300">Strengths</div>
        {strengths.length === 0 && <p className="text-xs text-slate-500">None stand out.</p>}
        <ul className="space-y-2">
          {strengths.map((s, i) => (
            <li key={i} className="text-sm">
              <span className="font-medium text-emerald-200">{s.label}</span>
              <span className="text-slate-400"> — {s.detail}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <div className="label mb-2 text-rose-300">Concerns</div>
        {concerns.length === 0 && <p className="text-xs text-slate-500">None flagged.</p>}
        <ul className="space-y-2">
          {concerns.map((s, i) => (
            <li key={i} className="text-sm">
              <span className="font-medium text-rose-200">{s.label}</span>
              <span className="text-slate-400"> — {s.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
