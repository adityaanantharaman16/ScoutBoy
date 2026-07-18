"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { CompareTray, ScoutingLiveRegion } from "@/components/common/PlayerActions";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ScoutingStateProvider>
        {children}
        <CompareTray />
        <ScoutingLiveRegion />
      </ScoutingStateProvider>
    </QueryClientProvider>
  );
}
