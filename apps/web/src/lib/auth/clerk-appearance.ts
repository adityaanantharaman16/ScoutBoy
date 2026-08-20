import type { ComponentProps } from "react";

import type { ClerkProvider } from "@clerk/nextjs";

/**
 * Derived from the provider's own prop rather than imported from
 * `@clerk/types`, which is a transitive package this workspace does not depend
 * on directly. Type-only, so nothing here reaches the bundle: an auth-free
 * build compiles this file away entirely, and a Clerk upgrade that renames a
 * theme key becomes a compile error here instead of a silently unstyled dialog.
 */
type Appearance = NonNullable<ComponentProps<typeof ClerkProvider>["appearance"]>;

/**
 * ScoutBoy's design system, expressed in the vocabulary Clerk's `appearance`
 * prop understands.
 *
 * Clerk renders real DOM inside our page for sign-in, sign-up and the account
 * menu, so those surfaces have to obey the same rules every other control does:
 * Inter, warm paper, pitch green, hairline borders, 90-degree corners, our focus
 * ring, our target sizes. Left at its defaults Clerk ships rounded cards, pill
 * buttons, soft shadows and its own font stack, all of which would read as a
 * different product bolted on.
 *
 * Every value below references the SAME CSS custom property `globals.css`
 * declares, rather than duplicating a hex code, so a future palette change moves
 * these surfaces with everything else instead of leaving them behind.
 *
 * KNOWN LIMITATION, documented rather than papered over: this reaches the
 * components Clerk renders inside ScoutBoy. Clerk's own hosted pages - its
 * Account Portal, and any provider-hosted step an OAuth or verification flow
 * redirects to - are served from Clerk's domain and cannot be themed from here.
 * See docs/milestone_8_4a_optional_accounts.md, "Provider-owned surfaces".
 */
export const SCOUTBOY_CLERK_APPEARANCE: Appearance = {
  variables: {
    colorPrimary: "#1c5a3c",
    colorPrimaryForeground: "#ffffff",
    colorForeground: "#182219",
    colorMutedForeground: "#5f6b61",
    colorBackground: "#fcfbf6",
    colorInput: "#fcfbf6",
    colorInputForeground: "#182219",
    // The control border token, which is what carries SC 1.4.11 non-text
    // contrast on a panel-on-paper fill.
    colorBorder: "#8d866f",
    // Matches `:focus-visible { outline: 2px solid var(--pitch) }`.
    colorRing: "#1c5a3c",
    colorDanger: "#9c2e22",
    colorSuccess: "#1c5a3c",
    colorWarning: "#9a5a0b",
    fontFamily: '"InterVariable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontFamilyButtons: '"InterVariable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: "0.9375rem",
    // Square, like every other rectangle in production.
    borderRadius: "0",
  },
  elements: {
    // Flat, hairline-bounded card: no elevation, no gradient, no curve.
    card: {
      backgroundColor: "var(--panel)",
      border: "1px solid var(--line)",
      boxShadow: "none",
    },
    cardBox: { boxShadow: "none", border: "1px solid var(--line)" },
    modalContent: { boxShadow: "none" },
    popoverBox: {
      border: "1px solid var(--line-strong)",
      boxShadow: "none",
      backgroundColor: "var(--panel)",
    },
    headerTitle: { color: "var(--ink)", fontWeight: 800, letterSpacing: "-0.02em" },
    headerSubtitle: { color: "var(--ink-soft)" },
    // Mirrors `.btn-primary`: pitch fill, square, comfortable 44px target.
    formButtonPrimary: {
      backgroundColor: "var(--pitch)",
      border: "1px solid var(--pitch)",
      color: "#fff",
      fontWeight: 600,
      minHeight: "44px",
      textTransform: "none",
      boxShadow: "none",
    },
    // Mirrors `.btn`.
    socialButtonsBlockButton: {
      backgroundColor: "var(--panel)",
      border: "1px solid var(--line-strong)",
      color: "var(--ink)",
      minHeight: "44px",
      boxShadow: "none",
    },
    // Mirrors `.input`.
    formFieldInput: {
      backgroundColor: "var(--panel)",
      border: "1px solid var(--line-strong)",
      color: "var(--ink)",
      minHeight: "44px",
      boxShadow: "none",
    },
    formFieldLabel: { color: "var(--ink-muted)", fontWeight: 600 },
    footerActionLink: { color: "var(--pitch-dark)", fontWeight: 600 },
    dividerLine: { backgroundColor: "var(--line)" },
    dividerText: { color: "var(--ink-soft)" },
    userButtonPopoverActionButton: { minHeight: "44px", color: "var(--ink)" },
    // Clerk's default trigger is a circular avatar, and ScoutBoy has no
    // circular geometry outside genuinely curved illustration. `NavBar` uses a
    // plain square button and never mounts `<UserButton>`, so these two are
    // belt-and-braces for any Clerk surface that renders one of its own.
    avatarBox: { borderRadius: "0" },
    badge: { borderRadius: "0" },
  },
  options: {
    // No provider branding block inside our page.
    logoPlacement: "none",
    socialButtonsPlacement: "bottom",
    // No ornamental loading animation; the product has no shimmer anywhere.
    shimmer: false,
  },
};
