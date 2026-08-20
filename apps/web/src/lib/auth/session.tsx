"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { AUTH_ENABLED } from "./config";

/**
 * ScoutBoy's own account boundary.
 *
 * Product components ask this, never Clerk. That is deliberate: `useAuth`,
 * `useClerk`, `<SignedIn>` and friends appear in exactly one file
 * (`clerk-session.tsx`), so the rest of the app has no opinion about who the
 * identity provider is, renders identically when there is none at all, and stays
 * unit-testable without mocking a third-party SDK.
 */

export type AuthStatus =
  /** This build has no identity provider. There is no account to have. */
  | "disabled"
  /** A provider exists and has not yet told us whether anyone is signed in. */
  | "resolving"
  /** A provider exists and nobody is signed in. The full guest product. */
  | "anonymous"
  /** A verified account. */
  | "authenticated";

/**
 * The raw status, plus the one state the provider itself cannot report.
 *
 * `unavailable` is what "resolving" becomes once it has gone on too long: the
 * provider's script never loaded, or its API never answered. It is a distinct
 * state rather than a flavour of `resolving`, because the two demand opposite
 * treatment — `resolving` means "wait a moment", `unavailable` means "stop
 * waiting and tell the truth about the device".
 */
export type EffectiveAuthStatus = AuthStatus | "unavailable";

export interface AuthSession {
  status: AuthStatus;
  /** Whether this build offers accounts at all. Build-time, never per-user. */
  enabled: boolean;
  /**
   * A stable, opaque key for the signed-in account, or null.
   *
   * Used to scope private React Query caches and to stamp account-favourites
   * state, so one account's data is structurally unable to render under
   * another's.
   */
  accountKey: string | null;
  /** A freshly minted session token, or null when there is no session. */
  getToken: () => Promise<string | null>;
  openSignIn: () => void;
  openSignUp: () => void;
  signOut: () => Promise<void>;
}

export interface EffectiveAuthSession extends AuthSession {
  /**
   * The status every surface must branch on.
   *
   * THE single source of account-resolution truth. Before this existed, the
   * favourites provider ran its own bounded timer while the navigation entry and
   * the account suggestion read `status` directly — so a stalled provider left
   * the header saying "Checking account" forever while the counter had already
   * (correctly) fallen back to device-local wording. Two timers, two opinions,
   * one contradiction on screen. There is now one timer, here, and one answer.
   */
  effectiveStatus: EffectiveAuthStatus;
}

/**
 * How long "we do not know yet" is allowed to last.
 *
 * Generous next to a healthy provider load (a few hundred milliseconds) and
 * short next to a scout's patience, so a returning account holder never reaches
 * it under normal conditions.
 */
export const RESOLVE_TIMEOUT_MS = 5000;

const noop = () => {};

export const DISABLED_SESSION: EffectiveAuthSession = {
  status: "disabled",
  effectiveStatus: "disabled",
  enabled: false,
  accountKey: null,
  getToken: async () => null,
  openSignIn: noop,
  openSignUp: noop,
  signOut: async () => {},
};

const AuthSessionContext = createContext<EffectiveAuthSession>(DISABLED_SESSION);

/**
 * Publishes a session, and owns the ONE resolution timer in the application.
 *
 * The timer is armed only while the raw status is `resolving`, and it is
 * disarmed and reset the moment the provider answers — so a late resolution
 * (the script finally loading, a slow session lookup returning) transitions
 * straight into the real anonymous or authenticated state and the normal
 * load/merge flow runs from there.
 */
export function AuthSessionValueProvider({
  value,
  children,
}: {
  value: AuthSession;
  children: React.ReactNode;
}) {
  const resolving = value.status === "resolving";
  const [expired, setExpired] = useState(false);
  const [wasResolving, setWasResolving] = useState(resolving);

  // Adjusted during render, not in an effect (the same pattern `usePresence`
  // uses): the moment the provider answers, the latch is dropped in the SAME
  // pass, so a late resolution cannot be shadowed by a stale "unavailable" for
  // one commit. A provider that stalls, recovers, and stalls again is therefore
  // timed afresh each time.
  if (wasResolving !== resolving) {
    setWasResolving(resolving);
    if (expired) setExpired(false);
  }

  useEffect(() => {
    if (!resolving) return;
    const timer = window.setTimeout(() => setExpired(true), RESOLVE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [resolving]);

  const session = useMemo<EffectiveAuthSession>(
    () => ({
      ...value,
      effectiveStatus: resolving && expired ? "unavailable" : value.status,
    }),
    [value, resolving, expired],
  );

  return <AuthSessionContext.Provider value={session}>{children}</AuthSessionContext.Provider>;
}

/**
 * The current account state.
 *
 * Defaults to `disabled` with no provider above it, so a component rendered in
 * isolation — in a unit test, or in an auth-free build — behaves exactly as the
 * anonymous product does rather than throwing.
 */
export function useAuthSession(): EffectiveAuthSession {
  return useContext(AuthSessionContext);
}

/**
 * The provider used when this build has no identity provider configured.
 *
 * Renders no Clerk component and starts no session work, so an anonymous
 * deployment carries no runtime dependency on an account system.
 */
export function DisabledAuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthSessionContext.Provider value={DISABLED_SESSION}>{children}</AuthSessionContext.Provider>
  );
}

/** Re-exported so callers can branch on configuration without a second import. */
export { AUTH_ENABLED };
