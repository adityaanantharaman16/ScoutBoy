"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { BottomRail } from "@/components/common/BottomRail";
import { ScoutingLiveRegion } from "@/components/common/PlayerActions";
import { ClerkAuthProvider } from "@/lib/auth/clerk-session";
import { AUTH_ENABLED, DisabledAuthProvider } from "@/lib/auth/session";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";

/**
 * The account boundary, chosen once from build-time configuration.
 *
 * With no Clerk configuration, `ClerkAuthProvider` is never rendered: no
 * provider mounts, no session request is made, and every consumer of
 * `useAuthSession()` sees the `disabled` state — which is the anonymous product
 * exactly as it was before Milestone 8.4A.
 */
function AuthBoundary({ children }: { children: React.ReactNode }) {
  if (!AUTH_ENABLED) return <DisabledAuthProvider>{children}</DisabledAuthProvider>;
  return <ClerkAuthProvider>{children}</ClerkAuthProvider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <AuthBoundary>
        <ScoutingStateProvider>
          {children}
          <BottomRail />
          <ScoutingLiveRegion />
        </ScoutingStateProvider>
      </AuthBoundary>
    </QueryClientProvider>
  );
}
