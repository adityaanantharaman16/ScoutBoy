"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useAuthSession } from "@/lib/auth/session";
import { MOTION_EXIT_MS, usePresence } from "@/lib/motion/presence";
import { favoritesScopeLabel, useScoutingState } from "@/lib/state/scouting-state";

// Test ids are declared, not derived from the label.
//
// Milestone 8.4B replaced the "My Favorites" slot with ONE "Saved" entry rather
// than adding a second top-level item: favourites, saved Discovery views and
// saved comparison setups are three kinds of saved work, and giving each its own
// navigation entry would spend three of five slots on collections. `/shortlist`
// is unchanged and still serves every existing bookmark; the counter to the right
// still reports My Favorites specifically, because that is the number a scout
// watches while they work.
const LINKS = [
  { href: "/", label: "Discover", testId: "nav-discover" },
  { href: "/roles/touchline_winger", label: "Leaderboards", testId: "nav-leaderboards" },
  { href: "/compare", label: "Compare", testId: "nav-compare" },
  { href: "/saved", label: "Saved", testId: "nav-saved" },
  { href: "/methodology", label: "Methodology", testId: "nav-methodology" },
];

/** The read-only states of the account entry, which are chips rather than controls. */
const STATE_CHIP = "header-chip border border-line bg-paper text-ink-soft";

/**
 * The account entry, present only when this build offers accounts.
 *
 * Deliberately NOT Clerk's `<UserButton>`: its trigger is a circular avatar, and
 * ScoutBoy has no circular geometry outside genuinely curved illustration. This
 * is the same square, hairline-bounded `.btn` every other control in the header
 * uses, so the account surfaces the header owns look like the rest of the
 * product. Clerk's own sign-in / sign-up dialogs are themed through
 * `SCOUTBOY_CLERK_APPEARANCE`.
 *
 * A signed-in scout gets ONE element here: `Sign Out`. There was previously a
 * bordered chip reading "Account" beside it, and it said nothing — it named no
 * account, carried no state the counter next to it did not already carry, and
 * did nothing when pressed, while taking a slot in the busiest row of the page.
 * It is gone rather than replaced: no avatar, no username, no menu, no icon. The
 * counter immediately to its left already reports "saved to your account", which
 * is the only account fact this header has to tell.
 */
function AccountEntry() {
  const { effectiveStatus, enabled, openSignIn, signOut } = useAuthSession();
  if (!enabled) return null;

  // The SAME resolution state the favourites counter uses. Reading raw `status`
  // here is what previously left the header on "Checking account" indefinitely
  // while the counter had already fallen back to device-local wording.
  if (effectiveStatus === "resolving") {
    return (
      <span className={STATE_CHIP} data-testid="account-entry-resolving">
        Checking account
      </span>
    );
  }

  // The provider never answered. Offering "Sign in" here would be offering a
  // control that cannot open, so the state is reported instead. Same chip, same
  // geometry, honest copy.
  if (effectiveStatus === "unavailable") {
    return (
      <span className={STATE_CHIP} data-testid="account-entry-unavailable">
        Accounts unavailable
      </span>
    );
  }

  if (effectiveStatus === "authenticated") {
    // The wrapper is the entry SLOT, not a second control: it carries the state
    // marker every account test and the anonymous-deployment E2E assertion reads,
    // and contributes no box of its own.
    return (
      <div className="flex items-center" data-testid="account-entry-authenticated">
        <button
          type="button"
          className="btn header-chip"
          data-testid="account-sign-out"
          onClick={() => {
            void signOut();
          }}
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="btn header-chip"
      data-testid="account-sign-in"
      onClick={openSignIn}
    >
      Sign In
    </button>
  );
}

export function NavBar() {
  const pathname = usePathname();
  const { shortlistIds, favorites } = useScoutingState();
  const [open, setOpen] = useState(false);
  // Holds the menu displayed for its 120ms exit only. `aria-expanded` below stays
  // bound to `open`, never to `visible`, so the announced state is correct the
  // instant the toggle is pressed and is never sequenced behind the animation.
  // Under reduced motion `visible` follows `open` in the same commit.
  const { visible, leaving } = usePresence(open, MOTION_EXIT_MS);

  return (
    <header className="border-b border-line bg-paper-panel">
      <nav
        className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3"
        aria-label="Primary"
      >
        {/* Typographic wordmark: weight + tight tracking carry it, no logo asset,
            no descriptor beside it. The link, its target, its accessible purpose
            and its position in the nav flow are unchanged. */}
        <Link
          href="/"
          className="text-xl font-extrabold tracking-[-0.03em] text-ink no-underline"
        >
          ScoutBoy
        </Link>

        {/* Menu toggle for mobile/tablet. Inline links appear only at lg+, where
            the labels + counter fit on one line without awkward wrapping. */}
        <button
          type="button"
          className="btn ml-auto px-2.5 py-1.5 text-xs lg:hidden"
          aria-expanded={open}
          aria-controls="primary-nav-links"
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          data-testid="nav-menu-toggle"
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true">{open ? "✕" : "☰"}</span>
          <span>Menu</span>
        </button>

        {/* Below lg this is the toggled menu; at lg+ it is the permanent desktop
            navigation (`lg:flex`), which the motion classes never reach — they are
            scoped to `max-width: 1023px` in globals.css, so the desktop nav is
            bit-for-bit unchanged. */}
        <div
          id="primary-nav-links"
          className={`${visible ? "flex" : "hidden"} ${
            leaving ? "nav-menu-exit" : open ? "nav-menu-enter" : ""
          } order-last w-full flex-wrap gap-1 text-sm lg:order-none lg:flex lg:w-auto`}
          data-testid="nav-menu-panel"
        >
          {LINKS.map((l) => {
            const active =
              l.href === "/"
                ? pathname === "/" || pathname === "/players"
                : // `/shortlist` is the legacy route for the same surface, so it
                  // marks Saved as the current page rather than leaving the whole
                  // navigation with nothing highlighted.
                  l.href === "/saved"
                  ? pathname.startsWith("/saved") || pathname.startsWith("/shortlist")
                  : pathname.startsWith(`/${l.href.split("/")[1]}`);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`nav-link px-2.5 py-1.5 font-semibold no-underline hover:bg-paper-muted hover:text-ink ${
                  active ? "text-pitch-dark shadow-[inset_0_-2px_0_var(--pitch)]" : "text-ink-muted"
                }`}
                data-testid={l.testId}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {l.label}
              </Link>
            );
          })}
        </div>

        {/* The right-hand group: My Favorites, then the account control.

            One container rather than two independently pushed elements. They are
            read together — "how many, where they live, and how to leave" — so
            they are laid out together, share `.header-chip`'s box, and sit one
            8px gap apart. Previously the counter carried its own `ml-auto` and
            the entry simply followed it, which left their relationship to
            whatever the flex line happened to do.

            Below `sm` the pair owns one full line and `justify-end` pushes its
            contents to the right edge. From `sm` to `lg`, the menu toggle's
            `ml-auto` takes the free space and this group rides beside it; at
            `lg+` the toggle is `display: none`, so `lg:ml-auto` here does the
            pushing instead. This avoids two competing automatic margins on the
            same flex line.

            `flex-wrap` with `justify-end` is what keeps 320px honest: the pair
            stacks, right-aligned, instead of forcing the page wider. */}
        <div
          className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto lg:ml-auto"
          data-testid="header-account-group"
        >
          {/* My Favorites counter — always visible, never wraps internally. The
              scope phrase is derived from where the list actually lives, so it
              says "saved on this device" for a guest and "saved to your account"
              for an account holder, and never claims either one while the session
              is still resolving or a sync has failed.

              While resolving, the NUMBER is withheld rather than shown as 0: a
              returning account holder must not read "My Favorites 0" for a frame
              before their real list arrives. */}
          <div
            className="header-chip border border-line bg-paper text-ink-muted"
            data-testid="favorites-counter"
            data-favorites-mode={favorites.mode}
          >
            {favorites.count === null ? (
              <>My Favorites · {favoritesScopeLabel(favorites.mode)}</>
            ) : (
              <>
                My Favorites{" "}
                <span className="font-mono text-pitch-dark">{shortlistIds.length}</span> ·{" "}
                {favoritesScopeLabel(favorites.mode)}
              </>
            )}
          </div>

          <AccountEntry />
        </div>
      </nav>
    </header>
  );
}
