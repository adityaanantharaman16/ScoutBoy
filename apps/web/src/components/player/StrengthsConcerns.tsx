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
        <div className="label mb-2 text-pitch-dark">Strengths</div>
        {strengths.length === 0 && <p className="text-xs text-ink-soft">None stand out.</p>}
        <ul className="space-y-2">
          {strengths.map((s, i) => (
            <li key={i} className="text-sm">
              <span className="font-semibold text-pitch-dark">{s.label}</span>
              <span className="text-ink-muted"> — {s.detail}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <div className="label mb-2 text-accent-red">Concerns</div>
        {concerns.length === 0 && <p className="text-xs text-ink-soft">None flagged.</p>}
        <ul className="space-y-2">
          {concerns.map((s, i) => (
            <li key={i} className="text-sm">
              <span className="font-semibold text-accent-red">{s.label}</span>
              <span className="text-ink-muted"> — {s.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
