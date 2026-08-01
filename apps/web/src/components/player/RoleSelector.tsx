"use client";

import { useRef } from "react";

import { ConfidenceMeter } from "@/components/player/ConfidenceMeter";
import type { RoleRatingSummary } from "@/lib/api/types";
import { formatScore, scoreColor } from "@/lib/formatters";

// Accessible WAI-ARIA tabs pattern for choosing the active RoleFit role.
// Automatic activation: arrow / Home / End move selection AND focus together.
//
// Tabs are dimensionally uniform within a breakpoint: an equal-column grid on
// tablet/desktop and an equal-width, horizontally scrollable single row on
// mobile. The selected state changes colour/border/inset-rule only — never size
// — so activating a tab cannot reflow the strip. The "best role" is intentionally
// NOT badged here (it would widen one tab); it is disclosed in the selected-role
// summary and the peer-ranked roles section instead.
export function RoleSelector({
  ratings,
  selectedKey,
  onSelect,
  panelId,
}: {
  ratings: RoleRatingSummary[];
  selectedKey: string;
  onSelect: (key: string) => void;
  panelId: string;
}) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusTab(index: number) {
    const clamped = (index + ratings.length) % ratings.length;
    onSelect(ratings[clamped].role_key);
    tabRefs.current[clamped]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        focusTab(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        focusTab(index - 1);
        break;
      case "Home":
        e.preventDefault();
        focusTab(0);
        break;
      case "End":
        e.preventDefault();
        focusTab(ratings.length - 1);
        break;
    }
  }

  return (
    <div
      role="tablist"
      aria-label="RoleFit roles"
      aria-orientation="horizontal"
      className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4"
      data-testid="role-selector"
    >
      {ratings.map((r, i) => {
        const selected = r.role_key === selectedKey;
        return (
          <button
            key={r.role_key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`role-tab-${r.role_key}`}
            data-testid={`role-tab-${r.role_key}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            className={`flex w-40 shrink-0 snap-start flex-col gap-1 border px-3 py-2 text-left transition sm:w-auto ${
              selected
                ? "border-pitch bg-[#e9f0ea] text-pitch-dark shadow-[inset_0_-2px_0_var(--pitch)]"
                : "border-line bg-paper-panel text-ink-muted hover:border-line-strong"
            }`}
            onClick={() => onSelect(r.role_key)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span className="truncate font-semibold text-ink">{r.display_name}</span>
            <span className="flex items-center justify-between gap-2">
              <span className={`tracking-tight text-lg font-bold ${scoreColor(r.final_score)}`}>
                {formatScore(r.final_score)}
              </span>
              <ConfidenceMeter level={r.confidence} showWord={false} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
