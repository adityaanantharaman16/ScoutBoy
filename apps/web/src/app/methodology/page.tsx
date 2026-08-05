"use client";

import { DisplayTag, ErrorState, LedgerSkeleton, PageHeader, ScopeBanner } from "@/components/common";
import { CalibrationPanel } from "@/components/methodology/CalibrationPanel";
import { useMethodology } from "@/lib/api/hooks";
import type { Methodology } from "@/lib/api/types";
import { titleCase } from "@/lib/formatters";

const SECTIONS = [
  { id: "formula", title: "Formula & versions" },
  { id: "calibration", title: "Calibration & evidence" },
  { id: "context", title: "Context adjustments" },
  { id: "roles", title: "Role registry" },
  { id: "playstyles", title: "Playstyles & concerns" },
  { id: "sources", title: "Data sources" },
  { id: "limitations", title: "Limitations" },
];

const FAMILIES = [
  { key: "ATT", label: "Attackers" },
  { key: "MID", label: "Midfielders" },
  { key: "DEF", label: "Defenders" },
  { key: "GK", label: "Goalkeepers" },
];

function DocSection({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="section-rule mb-3 pb-2">
        <div className="label mb-1">{eyebrow}</div>
        <h2 className="tracking-tight text-2xl font-bold leading-tight text-ink">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/** Flat, scannable role registry grouped by position family (replaces the
 *  repetitive role-card grid). Descriptions and stored group weights are kept. */
function RoleRegistry({ roles }: { roles: Methodology["roles"] }) {
  const seen = new Set<string>();
  const families = FAMILIES.map((fam) => ({
    ...fam,
    roles: roles.filter((r) => r.position_group === fam.key),
  })).filter((f) => f.roles.length > 0);
  families.forEach((f) => f.roles.forEach((r) => seen.add(r.role_key)));
  const others = roles.filter((r) => !seen.has(r.role_key));
  const groups = [...families, ...(others.length ? [{ key: "OTHER", label: "Other", roles: others }] : [])];

  return (
    <div className="space-y-5">
      {groups.map((fam) => (
        <div key={fam.key}>
          <div className="label mb-2">
            {fam.label} · {fam.roles.length}
          </div>
          <div
            className="divide-y divide-line overflow-hidden border border-line bg-paper-panel"
          >
            {fam.roles.map((r) => (
              <div key={r.role_key} className="px-3.5 py-3" data-testid={`role-registry-${r.role_key}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="tracking-tight text-lg font-bold text-ink">{r.display_name}</span>
                  <span className="shrink-0 text-[11px] text-ink-soft">{r.position_group}</span>
                </div>
                {r.description && <p className="mt-0.5 text-xs text-ink-muted">{r.description}</p>}
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.groups.map((g) => (
                    <DisplayTag key={g.key} variant="neutral">
                      {titleCase(g.key)} {Math.round(g.weight * 100)}%
                    </DisplayTag>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MethodologyPage() {
  const { data, isLoading, isError, error } = useMethodology();

  return (
    <div>
      <ScopeBanner text={data?.scope ?? "Prototype scope - see limitations below."} />
      <PageHeader
        eyebrow="Technical note"
        title="Methodology"
        lead="How ScoutBoy scores RoleFit, labels playstyles, models market ranges, and - just as important - where it is uncertain or unproven."
        meta={data ? (data.last_updated ? `Last updated ${data.last_updated}` : "Last updated: not provided") : undefined}
      />

      {isLoading && <LedgerSkeleton rows={7} label="Loading methodology…" />}
      {isError && <ErrorState message={(error as Error)?.message ?? "Failed to load methodology."} />}

      {data && (
        <div className="grid gap-6 lg:grid-cols-[minmax(190px,220px)_minmax(0,1fr)] lg:items-start">
          {/* Static verification index (anchors only, no accordion/animation). */}
          <nav
            aria-label="Contents"
            className="border border-line bg-paper-panel p-3 lg:sticky lg:top-4"
            data-testid="methodology-contents"
          >
            <div className="label mb-2">Verify</div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm lg:flex-col lg:gap-y-2">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="font-semibold text-pitch-dark hover:underline">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 space-y-8">
            <DocSection id="formula" eyebrow="Formula & versions" title="RoleFit rating">
              <div className="card">
                <p className="text-sm text-ink-muted">
                  Each role is scored from peer-group percentiles of weighted metric groups, then
                  adjusted for context and confidence. The authoritative formula (contained here, not
                  reconstructed in the browser):
                </p>
                {/* The formula is deliberately contained in its own horizontally
                    scrolling block rather than wrapped, so the authoritative
                    expression is never visually broken. A scrollable region must
                    therefore be reachable and operable by keyboard (WCAG 2.2
                    SC 2.1.1): `tabIndex={0}` makes it focusable so arrow keys can
                    scroll it, and the group role + label announce what it is
                    instead of leaving an unnamed focus stop. */}
                <pre
                  className="mono mt-2 max-w-full overflow-x-auto border border-line bg-paper-muted p-3 text-xs text-pitch-dark"
                  tabIndex={0}
                  role="group"
                  aria-label="RoleFit formula (scrollable)"
                  data-testid="methodology-formula"
                >
                  {data.formula}
                </pre>
                <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-ink-soft">Rating</dt>
                  <dd className="mono text-ink">{data.rating_version}</dd>
                  <dt className="text-ink-soft">Playstyles</dt>
                  <dd className="mono text-ink">{data.playstyle_version}</dd>
                  <dt className="text-ink-soft">Market</dt>
                  <dd className="mono text-ink">{data.market_version}</dd>
                </dl>
              </div>
            </DocSection>

            <DocSection id="calibration" eyebrow="Model evaluation" title="Calibration & evidence">
              <CalibrationPanel calibration={data.calibration} />
            </DocSection>

            <DocSection id="context" eyebrow="Multipliers" title="Context adjustments">
              <div className="card space-y-1.5">
                {data.context_dimensions.map((c) => (
                  <div key={c.key} className="text-sm">
                    <span className="font-semibold text-pitch-dark">{titleCase(c.key)}</span>
                    <span className="text-ink-muted"> - {c.explanation}</span>
                  </div>
                ))}
              </div>
            </DocSection>

            <DocSection
              id="roles"
              eyebrow="Config-driven weights"
              title={`Role registry (${data.roles.length})`}
            >
              <RoleRegistry roles={data.roles} />
            </DocSection>

            <DocSection id="playstyles" eyebrow="Observed labels" title="Playstyles & concerns">
              <div className="card space-y-3">
                <div>
                  <div className="label mb-1.5">Playstyles</div>
                  <div className="flex flex-wrap gap-1">
                    {data.playstyles.map((p) => (
                      <DisplayTag key={p.key} variant="playstyle">
                        {p.display_name}
                      </DisplayTag>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="label mb-1.5">Concerns</div>
                  <div className="flex flex-wrap gap-1">
                    {data.concerns.map((c) => (
                      <DisplayTag key={c.key} variant="concern">
                        {c.display_name}
                      </DisplayTag>
                    ))}
                  </div>
                </div>
              </div>
            </DocSection>

            <DocSection id="sources" eyebrow="Provenance" title="Data sources">
              <div className="card space-y-2">
                {data.data_sources.map((s) => (
                  <div key={s.name} className="text-sm">
                    <span className="font-semibold text-ink">{s.name}</span>
                    <span className="text-ink-muted"> - {s.role}. {s.note}</span>
                    {s.url && (
                      <a
                        href={s.url}
                        className="ml-1 font-semibold text-pitch-dark hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        link
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </DocSection>

            <DocSection id="limitations" eyebrow="Analytical honesty" title="Limitations">
              <ul className="card list-disc space-y-1 pl-6 text-sm text-ink-muted">
                {data.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </DocSection>
          </div>
        </div>
      )}
    </div>
  );
}
