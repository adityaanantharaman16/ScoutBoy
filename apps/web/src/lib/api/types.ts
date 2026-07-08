// API types for ScoutBoy — LOCKED to the backend OpenAPI contract.
//
// The top-level response shapes below are ALIASES of the generated schema in
// `schema.gen.ts` (produced by `pnpm gen:api` from docs/api_contracts/openapi.json).
// This means a backend contract change surfaces here as a compile error rather than
// silent drift. The only hand-authored types are (a) the generic `Paginated<T>`
// wrapper and (b) small typed "views" into free-form JSON blob fields that the API
// intentionally types as flexible objects (audit breakdowns, why_applied).

import type { components } from "./schema.gen";

type S = components["schemas"];

// ---- top-level responses (locked to OpenAPI) ----
export type PlayerSearchCard = S["PlayerSearchCard"];
export type PlayerCard = S["PlayerCardResponse"];
export type PlayerIdentity = S["PlayerIdentity"];
export type SubStat = S["SubStat"];
export type FaceStat = S["FaceStat"];
export type RoleRatingSummary = S["RoleRatingSummary"];
export type PlaystyleBadge = S["PlaystyleBadge"];
export type MarketPanel = S["MarketPanel"];
export type StrengthConcern = S["StrengthConcern"];
export type ContextPanel = S["ContextPanel"];
export type DataSource = S["DataSource"];
export type AuditBreakdown = S["AuditBreakdown"];
export type RoleRatingDetail = S["RoleRatingDetail"];
export type RoleRankingRow = S["RoleRankingRow"];
export type RoleLeaderboard = S["RoleLeaderboard"];
export type CompareSide = S["CompareSide"];
export type CompareResponse = S["CompareResponse"];
export type SimilarPlayer = S["SimilarPlayer"];
export type SimilarGroup = S["SimilarGroup"];
export type SimilarResponse = S["SimilarResponse"];
export type Methodology = S["MethodologyResponse"];
export type PlayerPlaystylesResponse = S["PlayerPlaystylesResponse"];

// ---- generic pagination wrapper (FastAPI emits a concrete Paginated_X_ per type;
// this generic mirrors that shape so hooks can stay generic over the item type) ----
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ---- FE-only display helper unions (backend types these as plain strings) ----
export type Confidence = "unknown" | "low" | "medium" | "high";
export type MarketLabel = "undervalued" | "fair" | "inflated" | "high-risk" | "unknown";

// ---- typed views into free-form JSON fields (API stores these as flexible JSON) ----
export interface WhyApplied {
  text?: string;
  supporting_metrics?: Array<{ display: string; score: number }>;
  [k: string]: unknown;
}

export interface AuditGroupView {
  key: string;
  weight: number;
  normalized_weight: number;
  group_score: number | null;
  metrics: Array<{ display: string; score: number | null; present: boolean }>;
}

export interface AuditMetricBreakdownView {
  raw_score?: number;
  groups?: AuditGroupView[];
}

export interface AuditPenaltiesView {
  total?: number;
  items?: Array<{ key: string; metric?: string; explanation: string }>;
}

export interface CompareStatRow {
  metric: string;
  display: string;
  unit: string;
  a_per90: number | null;
  a_score: number | null;
  b_per90: number | null;
  b_score: number | null;
}
