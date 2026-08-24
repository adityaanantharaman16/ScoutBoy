"use client";

import { useState } from "react";

import type { EffectiveAuthSession } from "./session";

/**
 * A session generation token that is never reused for the life of the page.
 *
 * This is the 8.4A favourites defence, extracted so 8.4B's saved-work state
 * machine gets it without a second implementation to keep in step. The favourites
 * provider deliberately keeps its own copy: it is correct, it is covered by a
 * dozen named invariants, and rewiring a working synchronization state machine to
 * consume a new abstraction is how a regression gets introduced into the one
 * collection that already works. The two generations do not need to be the same
 * value - each only has to be unique within its own state machine.
 *
 * `${accountKey}#e${epoch}#a${attempt}`, where `epoch` is a monotonic counter
 * that advances on every authentication lifecycle transition: anonymous to
 * account, account to anonymous, account A to account B, and signing out then
 * back into the SAME account (which passes through two of them). It is never
 * reset.
 *
 * A token of `${accountKey}#${attempt}` was NOT unique enough. Sign out and back
 * into the same account and both parts repeat, so a response left over from the
 * previous session matched the new one's token and was allowed to land on it.
 *
 * The epoch is adjusted DURING RENDER rather than in an effect - React's
 * documented "adjust state when a prop changes" pattern, the same one
 * `usePresence` uses - so the new generation exists in the same pass that
 * observed the transition and no effect-ordering window is left for a departing
 * session's work to slip through.
 */
export function useAccountGeneration(
  session: EffectiveAuthSession,
  attempt: number,
): { token: string | null; accountKey: string | null; authenticated: boolean; resolving: boolean } {
  const status = session.effectiveStatus;
  const authenticated = status === "authenticated";
  const accountKey = authenticated ? session.accountKey : null;

  const identity = `${status}:${accountKey ?? ""}`;
  const [epoch, setEpoch] = useState(0);
  const [lastIdentity, setLastIdentity] = useState(identity);
  if (lastIdentity !== identity) {
    setLastIdentity(identity);
    setEpoch((n) => n + 1);
  }

  return {
    token: accountKey === null ? null : `${accountKey}#e${epoch}#a${attempt}`,
    accountKey,
    authenticated,
    resolving: status === "resolving",
  };
}
