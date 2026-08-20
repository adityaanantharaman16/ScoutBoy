"use client";

import { ClerkProvider, useAuth, useClerk } from "@clerk/nextjs";
import { useMemo } from "react";

import { SCOUTBOY_CLERK_APPEARANCE } from "./clerk-appearance";
import { CLERK_PUBLISHABLE_KEY } from "./config";
import { AuthSessionValueProvider, type AuthSession } from "./session";

/**
 * The ONLY module in ScoutBoy that imports Clerk's React API.
 *
 * Everything else consumes `useAuthSession()`, so the product's components have
 * no knowledge of the provider and keep working unchanged when there is none.
 * It is rendered exclusively from `providers.tsx`, and only when
 * `AUTH_ENABLED` is true, so a build without a publishable key never mounts a
 * Clerk provider or starts a session request.
 */

function ClerkSessionBridge({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const clerk = useClerk();

  const value = useMemo<AuthSession>(() => {
    const status = !isLoaded ? "resolving" : isSignedIn ? "authenticated" : "anonymous";
    return {
      status,
      enabled: true,
      // Clerk's user id: opaque, stable, and the same value the backend derives
      // from the token's `sub`. Used only as a cache-partition key.
      accountKey: status === "authenticated" ? (userId ?? null) : null,
      // Minted per call. Never cached here, never stored anywhere.
      getToken: async () => (status === "authenticated" ? await getToken() : null),
      openSignIn: () => clerk.openSignIn({ appearance: SCOUTBOY_CLERK_APPEARANCE }),
      openSignUp: () => clerk.openSignUp({ appearance: SCOUTBOY_CLERK_APPEARANCE }),
      signOut: async () => {
        await clerk.signOut();
      },
    };
  }, [isLoaded, isSignedIn, userId, getToken, clerk]);

  return <AuthSessionValueProvider value={value}>{children}</AuthSessionValueProvider>;
}

/**
 * DELIBERATELY NO `proxy.ts` / `clerkMiddleware()`.
 *
 * Clerk's Next.js quickstart installs middleware, and the first implementation
 * here did. It was removed after it failed at runtime with "Missing secretKey":
 * `clerkMiddleware()` performs the server-side session handshake against Clerk's
 * Backend API, so it REQUIRES `CLERK_SECRET_KEY` on every deployment that runs
 * it.
 *
 * ScoutBoy has no server-side Clerk needs at all. It never calls `auth()` or
 * `currentUser()`, protects no Next.js route (every route is public), and reads
 * no session during server rendering - the private surface is FastAPI, which
 * authorizes from a bearer token it verifies itself against Clerk's public JWKS.
 * Keeping the middleware would therefore have added a mandatory secret, an edge
 * function on every request, and a new class of deployment failure, in exchange
 * for nothing this product uses.
 *
 * What that costs: no server-side handshake. Session lifetime and token refresh
 * are handled by Clerk's browser SDK, exactly as they are in a plain
 * `@clerk/clerk-react` single-page app. `dynamic={false}` keeps the provider
 * static so no route is forced out of Next's caching, and no server component
 * ever tries to resolve a session that has no middleware to resolve it.
 *
 * If ScoutBoy ever needs server-rendered private content, the middleware and a
 * `CLERK_SECRET_KEY` come back together, and that is a deliberate decision to
 * make at that point rather than a cost to pay now.
 */
export function ClerkAuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      appearance={SCOUTBOY_CLERK_APPEARANCE}
      dynamic={false}
    >
      <ClerkSessionBridge>{children}</ClerkSessionBridge>
    </ClerkProvider>
  );
}
