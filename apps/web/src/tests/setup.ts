import "@testing-library/jest-dom/vitest";

import { beforeEach, vi } from "vitest";

/**
 * jsdom implements no media queries, so `window.matchMedia` is undefined. The
 * motion layer guards for that (see `lib/motion/presence.ts`), but a stub lets
 * behaviour tests actually exercise both motion preferences rather than only the
 * default.
 *
 * Use `setReducedMotion(true)` inside a test to assert reduced-motion behaviour.
 * Every test starts at `false` (no preference).
 */
let reducedMotion = false;

export function setReducedMotion(value: boolean) {
  reducedMotion = value;
}

beforeEach(() => {
  reducedMotion = false;
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: vi.fn((query: string) => ({
    matches: query.includes("prefers-reduced-motion: reduce") ? reducedMotion : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
