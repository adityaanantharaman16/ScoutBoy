// Pure SELECTION / ORDERING helpers over already-computed backend RoleFit output.
//
// These functions only find, sort, and read stored values from the
// GET /players/{id}/ratings payload. They never multiply, renormalize, average,
// or otherwise reconstruct a RoleFit score, group contribution, or confidence.
// The rating formula lives in the backend (packages/rating_engine) and is the
// single source of truth; the UI is display-only.

import type {
  AuditBreakdown,
  AuditGroupView,
  AuditMetricBreakdownView,
  AuditPenaltiesView,
  RoleRatingSummary,
} from "@/lib/api/types";

/** The best-rated role key (flagged by the backend), falling back to the first. */
export function bestRoleKey(ratings: RoleRatingSummary[]): string | undefined {
  return (ratings.find((r) => r.is_best) ?? ratings[0])?.role_key;
}

export function findRoleSummary(
  ratings: RoleRatingSummary[],
  roleKey: string | null | undefined,
): RoleRatingSummary | undefined {
  if (!roleKey) return undefined;
  return ratings.find((r) => r.role_key === roleKey);
}

export function findRoleAudit(
  audits: AuditBreakdown[],
  roleKey: string | null | undefined,
): AuditBreakdown | undefined {
  if (!roleKey) return undefined;
  return audits.find((a) => a.role_key === roleKey);
}

/** Read the stored group breakdown for an audit (no computation). */
export function auditGroups(audit: AuditBreakdown | undefined): AuditGroupView[] {
  if (!audit) return [];
  return (audit.metric_breakdown as AuditMetricBreakdownView).groups ?? [];
}

export function auditPenalties(audit: AuditBreakdown | undefined): AuditPenaltiesView {
  return (audit?.penalties as AuditPenaltiesView) ?? {};
}

/**
 * Order groups by stored role importance (normalized_weight) descending, so the
 * most role-defining evidence leads. This is a stable sort on stored values —
 * it does not derive any new number. Tie-breaks: raw weight desc, then key asc.
 */
export function orderGroupsByWeight(groups: AuditGroupView[]): AuditGroupView[] {
  return [...groups].sort((a, b) => {
    if (b.normalized_weight !== a.normalized_weight) {
      return b.normalized_weight - a.normalized_weight;
    }
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.key.localeCompare(b.key);
  });
}

/** True when a group has no measured score (unknown), never treated as zero. */
export function isGroupUnknown(group: AuditGroupView): boolean {
  return group.group_score == null;
}
