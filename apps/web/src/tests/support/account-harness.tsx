import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { vi } from "vitest";

import { AuthSessionValueProvider, type AuthSession, type AuthStatus } from "@/lib/auth/session";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";

/**
 * A controllable stand-in for the identity provider.
 *
 * ScoutBoy's product code consumes `useAuthSession()`, never Clerk directly, so
 * every account behaviour below is testable by supplying a session value - no
 * Clerk SDK mock, no network, and no test-only branch in production code. The
 * boundary injected here is exactly the one the real provider fills.
 */
export interface HarnessOptions {
  status?: AuthStatus;
  enabled?: boolean;
  accountKey?: string | null;
  token?: string | null;
  onSignIn?: () => void;
  onSignUp?: () => void;
  onSignOut?: () => void;
}

export function makeSession(options: HarnessOptions = {}): AuthSession {
  const status = options.status ?? "anonymous";
  return {
    status,
    enabled: options.enabled ?? status !== "disabled",
    accountKey: options.accountKey ?? (status === "authenticated" ? "acct_default" : null),
    getToken: async () => (options.token === undefined ? "test-token" : options.token),
    openSignIn: options.onSignIn ?? (() => {}),
    openSignUp: options.onSignUp ?? (() => {}),
    signOut: async () => options.onSignOut?.(),
  };
}

/** A fresh, retry-free QueryClient so a failed request fails once, immediately. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

export function AccountHarness({
  session,
  client,
  children,
}: {
  session: AuthSession;
  client?: QueryClient;
  children: React.ReactNode;
}) {
  const [queryClient] = useState(() => client ?? makeQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <AuthSessionValueProvider value={session}>
        <ScoutingStateProvider>{children}</ScoutingStateProvider>
      </AuthSessionValueProvider>
    </QueryClientProvider>
  );
}

/**
 * A tiny external store holding the current session.
 *
 * Sign-in, sign-out and account-switch assertions all need the SAME provider
 * tree to survive the transition - remounting would hide exactly the bugs those
 * tests exist to catch. Driving the change through an external store rather than
 * a mutable prop keeps the harness a well-behaved component while still letting
 * a test flip the session from outside React.
 */
export interface SessionController {
  get: () => AuthSession;
  set: (next: AuthSession) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createSessionController(initial: AuthSession): SessionController {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next: AuthSession) {
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function SwitchableHarness({
  controller,
  client,
  children,
}: {
  controller: SessionController;
  client?: QueryClient;
  children: React.ReactNode;
}) {
  const session = useSyncExternalStore(controller.subscribe, controller.get, controller.get);
  const [queryClient] = useState(() => client ?? makeQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <AuthSessionValueProvider value={session}>
        <ScoutingStateProvider>{children}</ScoutingStateProvider>
      </AuthSessionValueProvider>
    </QueryClientProvider>
  );
}

/** One captured request from the private API client. */
export interface FetchCall {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

/** Records every `fetch` the private client makes, with no network involved. */
export function installFetchRecorder(
  handler: (
    call: FetchCall,
  ) => { status?: number; json?: unknown } | Promise<{ status?: number; json?: unknown }>,
) {
  const calls: FetchCall[] = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    const call: FetchCall = {
      url: String(input),
      method: init?.method ?? "GET",
      authorization: headers.get("Authorization"),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const result = await handler(call);
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      json: async () => result.json ?? {},
    } as Response;
  });
  vi.stubGlobal("fetch", spy);
  return calls;
}

/** A promise a test resolves or rejects when it chooses. */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * A recorder whose responses a test hands out one at a time.
 *
 * Needed for the cross-account isolation cases: they only mean anything if a
 * request genuinely started under account A and is still in flight when the
 * session becomes account B. `handler` returns a promise the test controls, so
 * "still in flight" is a fact rather than a timing hope.
 */
export function installDeferredFetch(
  handler: (call: FetchCall) => Promise<{ status?: number; json?: unknown }>,
) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      const call: FetchCall = {
        url: String(input),
        method: init?.method ?? "GET",
        authorization: headers.get("Authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const result = await handler(call);
      const status = result.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: String(status),
        json: async () => result.json ?? {},
      } as Response;
    }),
  );
  return calls;
}
