"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const SHORTLIST_KEY = "scoutboy.shortlist.v1";
const COMPARE_KEY = "scoutboy.compareQueue.v1";
const MAX_COMPARE = 2;

export interface PlayerRef {
  id: number;
  name: string;
}

interface ScoutingState {
  shortlistIds: number[];
  compareQueue: PlayerRef[];
  notice: string;
  isShortlisted: (id: number) => boolean;
  toggleShortlist: (player: PlayerRef) => void;
  removeShortlist: (id: number) => void;
  isQueuedForCompare: (id: number) => boolean;
  toggleCompare: (player: PlayerRef) => void;
  removeCompare: (id: number) => void;
  clearCompare: () => void;
}

const ScoutingContext = createContext<ScoutingState | null>(null);

function readNumberList(key: string): number[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((id): id is number => Number.isInteger(id) && id > 0)
      : [];
  } catch {
    return [];
  }
}

function readPlayerRefs(key: string): PlayerRef[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter((p) => p && Number.isInteger(p.id) && typeof p.name === "string")
          .slice(0, MAX_COMPARE)
      : [];
  } catch {
    return [];
  }
}

export function ScoutingStateProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [shortlistIds, setShortlistIds] = useState<number[]>([]);
  const [compareQueue, setCompareQueue] = useState<PlayerRef[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setMounted(true);
    setShortlistIds(readNumberList(SHORTLIST_KEY));
    setCompareQueue(readPlayerRefs(COMPARE_KEY));
  }, []);

  useEffect(() => {
    if (mounted) window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify(shortlistIds));
  }, [mounted, shortlistIds]);

  useEffect(() => {
    if (mounted) window.localStorage.setItem(COMPARE_KEY, JSON.stringify(compareQueue));
  }, [mounted, compareQueue]);

  const speak = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? "" : current)), 2200);
  }, []);

  const isShortlisted = useCallback(
    (id: number) => shortlistIds.includes(id),
    [shortlistIds],
  );

  const toggleShortlist = useCallback(
    (player: PlayerRef) => {
      setShortlistIds((ids) => {
        if (ids.includes(player.id)) {
          speak(`${player.name} removed from shortlist. Saved on this device.`);
          return ids.filter((id) => id !== player.id);
        }
        speak(`${player.name} added to shortlist. Saved on this device.`);
        return [...ids, player.id];
      });
    },
    [speak],
  );

  const removeShortlist = useCallback(
    (id: number) => {
      setShortlistIds((ids) => ids.filter((item) => item !== id));
      speak("Player removed from shortlist. Saved on this device.");
    },
    [speak],
  );

  const isQueuedForCompare = useCallback(
    (id: number) => compareQueue.some((p) => p.id === id),
    [compareQueue],
  );

  const toggleCompare = useCallback(
    (player: PlayerRef) => {
      setCompareQueue((queue) => {
        if (queue.some((p) => p.id === player.id)) {
          speak(`${player.name} removed from compare queue.`);
          return queue.filter((p) => p.id !== player.id);
        }
        const next = queue.length >= MAX_COMPARE ? [queue[1], player] : [...queue, player];
        speak(
          queue.length >= MAX_COMPARE
            ? `${player.name} replaced the oldest compare selection.`
            : `${player.name} added to compare queue.`,
        );
        return next;
      });
    },
    [speak],
  );

  const removeCompare = useCallback(
    (id: number) => {
      setCompareQueue((queue) => queue.filter((p) => p.id !== id));
      speak("Player removed from compare queue.");
    },
    [speak],
  );

  const clearCompare = useCallback(() => {
    setCompareQueue([]);
    speak("Compare queue cleared.");
  }, [speak]);

  const value = useMemo<ScoutingState>(
    () => ({
      shortlistIds,
      compareQueue,
      notice,
      isShortlisted,
      toggleShortlist,
      removeShortlist,
      isQueuedForCompare,
      toggleCompare,
      removeCompare,
      clearCompare,
    }),
    [
      shortlistIds,
      compareQueue,
      notice,
      isShortlisted,
      toggleShortlist,
      removeShortlist,
      isQueuedForCompare,
      toggleCompare,
      removeCompare,
      clearCompare,
    ],
  );

  return <ScoutingContext.Provider value={value}>{children}</ScoutingContext.Provider>;
}

export function useScoutingState() {
  const context = useContext(ScoutingContext);
  if (!context) throw new Error("useScoutingState must be used inside ScoutingStateProvider");
  return context;
}
