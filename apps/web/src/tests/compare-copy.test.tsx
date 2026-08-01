import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CompareQueueButton, PlayerActionRail } from "@/components/common/PlayerActions";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";

const { useAllPlayersLiteMock, useCompareMock, searchParamsRef } = vi.hoisted(() => ({
  useAllPlayersLiteMock: vi.fn(),
  useCompareMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams() },
}));

vi.mock("@/lib/api/hooks", () => ({
  useAllPlayersLite: useAllPlayersLiteMock,
  useCompare: useCompareMock,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
  usePathname: () => "/compare",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
}));

import ComparePage from "@/app/compare/page";

beforeEach(() => {
  // compare-queue state is device-local; clear it so cases stay independent
  window.localStorage.clear();
  searchParamsRef.current = new URLSearchParams();
  useCompareMock.mockReset();
  useCompareMock.mockReturnValue({ isLoading: false, isError: false, data: undefined });
  useAllPlayersLiteMock.mockReturnValue({
    data: {
      items: [
        { id: 11, canonical_name: "Anton Keller" },
        { id: 22, canonical_name: "Jack Whitmore" },
      ],
    },
  });
});

// ---------------------------------------------------------------------------
// The shared compare action reads exactly "Compare"
// ---------------------------------------------------------------------------
describe("Shared compare action copy", () => {
  function renderButton() {
    return render(
      <ScoutingStateProvider>
        <CompareQueueButton player={{ id: 11, name: "Anton Keller" }} />
      </ScoutingStateProvider>,
    );
  }

  it("shows exactly Compare, with no visible vs prefix", () => {
    renderButton();
    const button = screen.getByRole("button");
    expect(button.textContent).toBe("Compare");
    expect(button).not.toHaveTextContent("vs");
  });

  it("keeps the player-specific accessible label and pressed state", () => {
    renderButton();
    const button = screen.getByRole("button");
    expect(button).toHaveAccessibleName("Add Anton Keller to compare queue");
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button.textContent).toBe("Queued");
    expect(button).toHaveAccessibleName("Remove Anton Keller from compare queue");
  });

  it("shows the same bare Compare label on the discovery action rail", () => {
    render(
      <ScoutingStateProvider>
        <PlayerActionRail player={{ id: 11, name: "Anton Keller" }} />
      </ScoutingStateProvider>,
    );
    const action = screen.getByTestId("compare-action");
    expect(action.textContent).toBe("Compare");
    expect(action).toHaveAccessibleName("Add Anton Keller to compare queue");
  });
});

// ---------------------------------------------------------------------------
// Player 1 / Player 2 presentation; player_a / player_b contract
// ---------------------------------------------------------------------------
describe("Compare page player numbering", () => {
  it("labels the two selectors Player 1 and Player 2", () => {
    render(<ComparePage />);
    expect(screen.getByText("Player 1")).toBeInTheDocument();
    expect(screen.getByText("Player 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Player 1")).toBe(screen.getByTestId("compare-a"));
    expect(screen.getByLabelText("Player 2")).toBe(screen.getByTestId("compare-b"));
  });

  it("shows no Player A or Player B copy anywhere on the surface", () => {
    const { container } = render(<ComparePage />);
    expect(container.textContent).not.toMatch(/Player [AB]\b/);
  });

  it("keeps the stable test ids and the a / b query parameters", () => {
    searchParamsRef.current = new URLSearchParams("a=11&b=22");
    render(<ComparePage />);
    expect(screen.getByTestId("compare-a")).toHaveValue("11");
    expect(screen.getByTestId("compare-b")).toHaveValue("22");
    // the request itself is unchanged: (a, b, role)
    expect(useCompareMock).toHaveBeenLastCalledWith(11, 22, undefined);
  });
});

// ---------------------------------------------------------------------------
// Source-level guard: no user-visible Player A / Player B copy survives
// ---------------------------------------------------------------------------
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXCLUDED = ["tests", join("app", "design-pilots")];

function productionFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(SRC, full);
    if (EXCLUDED.some((d) => rel === d || rel.startsWith(d + sep))) continue;
    if (entry.isDirectory()) out.push(...productionFiles(full));
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Comparison copy — source guard", () => {
  it("leaves no user-facing Player A / Player B string in production source", () => {
    const offenders = productionFiles().filter((f) =>
      /Player [AB]\b/.test(stripComments(readFileSync(f, "utf8"))),
    );
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it("leaves no visible vs glyph on the shared compare actions", () => {
    const actions = readFileSync(join(SRC, "components", "common", "PlayerActions.tsx"), "utf8");
    expect(stripComments(actions)).not.toMatch(/>vs</);
  });

  it("keeps the player_a / player_b API contract untouched", () => {
    // the generated schema and the request builder both still speak player_a/_b
    const schema = readFileSync(join(SRC, "lib", "api", "schema.gen.ts"), "utf8");
    const hooks = readFileSync(join(SRC, "lib", "api", "hooks.ts"), "utf8");
    for (const source of [schema, hooks]) {
      expect(source).toMatch(/player_a/);
      expect(source).toMatch(/player_b/);
    }
    expect(hooks).toContain('{ player_a: a, player_b: b, role_key: roleKey }');
  });
});
