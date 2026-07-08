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
  if (audits.length === 0) return <p className="text-sm text-slate-500">No audit data.</p>;

  return (
    <div className="space-y-2" data-testid="audit-accordion">
      {audits.map((a) => {
        const isOpen = open === a.role_key;
        const groups = (a.metric_breakdown as AuditMetricBreakdownView).groups ?? [];
        const penalties = a.penalties as AuditPenaltiesView;
        return (
          <div key={a.role_key} className="card">
            <button
              className="flex w-full items-center justify-between text-left"
              onClick={() => setOpen(isOpen ? null : a.role_key)}
            >
              <span className="font-medium">{a.role_key.replace(/_/g, " ")}</span>
              <span className="text-xs text-accent-soft">{isOpen ? "hide" : "why this score"}</span>
            </button>
            {isOpen && (
              <div className="mt-3 space-y-3">
                {a.explanation_text && <p className="text-sm text-slate-300">{a.explanation_text}</p>}
                <div>
                  <div className="label mb-1">Metric groups</div>
                  <div className="space-y-1">
                    {groups.map((g) => (
                      <div key={g.key} className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">
                          {g.key.replace(/_/g, " ")}{" "}
                          <span className="text-slate-600">({Math.round(g.weight * 100)}%)</span>
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
                    <div className="label mb-1 text-rose-300">Risk penalties</div>
                    {penalties.items!.map((p, i) => (
                      <p key={i} className="text-xs text-slate-400">
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
