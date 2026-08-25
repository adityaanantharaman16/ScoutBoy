"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Loading, PageHeader, ScopeBanner } from "@/components/common";
import { ComparisonsPanel } from "@/components/saved/ComparisonsPanel";
import { FavoritesPanel, favoritesScopeLead } from "@/components/saved/FavoritesPanel";
import { ViewsPanel } from "@/components/saved/ViewsPanel";
import { SCOPE_BANNER } from "@/lib/constants";
import { favoritesScopeLabel, useScoutingState } from "@/lib/state/scouting-state";
import { savedScopeLabel, useSavedWork } from "@/lib/state/saved-work";

/** The three sections, and the one order they appear in everywhere. */
const SECTIONS = ["favorites", "views", "comparisons"] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_LABELS: Record<Section, string> = {
  favorites: "My Favorites",
  views: "Views",
  comparisons: "Comparisons",
};

/**
 * The section a URL means.
 *
 * Favorites is the default, so `/saved` lands where the old `/shortlist` did and
 * a returning scout's habit still works. Anything unrecognised falls back to it
 * rather than rendering an empty surface or a 404 — a hand-edited or stale
 * `?section=` is a link that still has a sensible meaning.
 */
function parseSection(raw: string | null): Section {
  return (SECTIONS as readonly string[]).includes(raw ?? "") ? (raw as Section) : "favorites";
}

/**
 * One section's count, or nothing.
 *
 * `null` means genuinely unknown — the session has not resolved, or an account's
 * collection has not arrived — and it renders as NO number rather than as zero. A
 * returning account holder must never read "Views 0" for the moment before their
 * real collection appears.
 */
function CountBadge({ count }: { count: number | null }) {
  if (count === null) return null;
  return (
    <span className="mono ml-1.5 text-pitch-dark" data-testid="section-count">
      {count}
    </span>
  );
}

function SavedPageInner() {
  const params = useSearchParams();
  const pathname = usePathname();
  const section = parseSection(params.get("section"));

  const { favorites } = useScoutingState();
  const { views, comparisons } = useSavedWork();

  /**
   * Switching section is deliberate navigation, so it PUSHES.
   *
   * Back therefore returns to the section a scout came from, and a link to a
   * section is a real link. Favorites writes the bare `/saved`, so the default
   * has one canonical URL rather than two spellings of it.
   */
  const open = (next: Section) => {
    window.history.pushState(null, "", next === "favorites" ? pathname : `${pathname}?section=${next}`);
  };

  const counts: Record<Section, number | null> = {
    favorites: favorites.count,
    views: views.count,
    comparisons: comparisons.count,
  };

  const scope =
    section === "favorites"
      ? favoritesScopeLabel(favorites.mode)
      : section === "views"
        ? savedScopeLabel(views.mode)
        : savedScopeLabel(comparisons.mode);

  const lead =
    section === "favorites"
      ? favoritesScopeLead(favorites.mode)
      : section === "views"
        ? "Saved Discovery views: the filter and sort setup you kept so you can return to the same cohort. Opening one restores its criteria and sort, and always starts on page 1."
        : "Saved comparison setups: two players in the order you chose, and the role you selected. Opening one loads current ScoutBoy analysis; no score, conclusion or snapshot is stored.";

  return (
    <div>
      <ScopeBanner text={SCOPE_BANNER} />
      <PageHeader
        eyebrow="Saved work"
        title="Saved"
        lead={lead}
        meta={`${SECTION_LABELS[section]} · ${scope}`}
      />

      {/*
        Three sharp, equal-weight controls — not tabs with panels, and not three
        stacked collections.

        A `tablist` was considered and rejected: these are URL-addressable
        sections that create history entries, so they behave like navigation
        rather than like tabs, and announcing them as tabs would promise
        arrow-key semantics that would then fight the browser's own history. They
        are buttons in a labelled group, with `aria-current` naming the open one —
        the same pattern the primary navigation uses for the active route.

        Only one section renders at a time, so the page cannot become one
        extremely long scroll of every collection at once.
      */}
      <nav
        aria-label="Saved work sections"
        className="mb-5 flex flex-wrap gap-2"
        data-testid="saved-sections"
      >
        {SECTIONS.map((key) => {
          const active = key === section;
          return (
            <button
              key={key}
              type="button"
              className={`btn px-3 py-2 text-sm ${active ? "btn-on" : ""}`}
              aria-current={active ? "true" : undefined}
              data-testid={`saved-section-${key}`}
              data-active={active ? "true" : "false"}
              onClick={() => open(key)}
            >
              {SECTION_LABELS[key]}
              <CountBadge count={counts[key]} />
            </button>
          );
        })}
      </nav>

      <section aria-label={`${SECTION_LABELS[section]} saved work`} data-testid="saved-section-panel">
        {section === "favorites" && <FavoritesPanel />}
        {section === "views" && <ViewsPanel />}
        {section === "comparisons" && <ComparisonsPanel />}
      </section>
    </div>
  );
}

export default function SavedPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SavedPageInner />
    </Suspense>
  );
}
