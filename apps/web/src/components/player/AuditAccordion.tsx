"use client";

import { useState } from "react";

import type {
  AuditBreakdown,
  AuditMetricBreakdownView,
  AuditPenaltiesView,
} from "@/lib/api/types";
import { scoreColor } from "@/lib/formatters";

export function AuditAccordion({ audits }: { audits: AuditBreakdown[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (audits.length === 0) return <p className="text-sm text-ink-soft">No audit data.</p>;

  return (
    <div className="space-y-2" data-testid="audit-accordion">
      {audits.map((a) => {
        const isOpen = open === a.role_key;
        const groups = (a.metric_breakdown as AuditMetricBreakdownView).groups ?? [];
        const penalties = a.penalties as AuditPenaltiesView;
        return (
          <div key={a.role_key} className="card">
            <button
              className="flex w-full items-center justify-between gap-3 text-left"
              onClick={() => setOpen(isOpen ? null : a.role_key)}
              aria-expanded={isOpen}
            >
              <span className="font-semibold text-ink">{a.role_key.replace(/_/g, " ")}</span>
              <span className="text-xs font-semibold text-pitch-dark">{isOpen ? "hide" : "why this score"}</span>
            </button>
            {isOpen && (
              <div className="mt-3 space-y-3">
                {a.explanation_text && <p className="text-sm text-ink-muted">{a.explanation_text}</p>}
                <div>
                  <div className="label mb-1">Metric groups</div>
                  <div className="space-y-1">
                    {groups.map((g) => (
                      <div key={g.key} className="flex items-center justify-between text-sm">
                        <span className="text-ink-muted">
                          {g.key.replace(/_/g, " ")}{" "}
                          <span className="text-ink-soft">({Math.round(g.weight * 100)}%)</span>
                        </span>
                        <span className={`font-medium ${scoreColor(g.group_score)}`}>
                          {g.group_score == null ? "unknown" : Math.round(g.group_score)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                {(penalties.items?.length ?? 0) > 0 && (
                  <div>
                    <div className="label mb-1 text-accent-red">Risk penalties</div>
                    {penalties.items!.map((p, i) => (
                      <p key={i} className="text-xs text-ink-muted">
                        {p.explanation}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
