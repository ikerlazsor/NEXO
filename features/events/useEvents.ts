import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  fetchEventPage,
  fetchEventPersonalization,
  setEventMembership,
} from "./api";
import type {
  ExternalEvent,
  EventCursor,
  EventFilters,
  EventInteractionTaste,
} from "./types";
const cache = new Map<string, { events: ExternalEvent[]; at: number }>();
const emptyHistory = (): EventInteractionTaste => ({
  categories: {},
  seen: new Set(),
});
export function useEvents(
  filters: EventFilters,
  userId: string | null,
  enabled = true,
) {
  const key = JSON.stringify(filters);
  const stableFilters = useMemo(() => JSON.parse(key) as EventFilters, [key]);
  const [events, setEvents] = useState<ExternalEvent[]>([]);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(false),
    [hasMore, setHasMore] = useState(true);
  const [joined, setJoined] = useState<Set<string>>(new Set()),
    [history, setHistory] = useState(emptyHistory);
  const [busy, setBusy] = useState<string | null>(null);
  const cursor = useRef<EventCursor | null>(null),
    controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    inFlight = useRef(false);
  const memberEpoch = useRef(0);
  const refreshPersonal = useCallback(() => {
    const epoch = ++memberEpoch.current;
    setJoined(new Set());
    setHistory(emptyHistory());
    if (!userId || !enabled) return;
    void fetchEventPersonalization(userId)
      .then((result) => {
        if (epoch === memberEpoch.current) {
          setJoined(result.joined);
          setHistory(result.history);
        }
      })
      .catch(() => {});
    return () => {
      memberEpoch.current++;
    };
  }, [userId, enabled]);
  useFocusEffect(refreshPersonal);
  const load = useCallback(
    async (reset = false) => {
      if (!enabled || (inFlight.current && !reset)) return;
      if (reset) {
        generation.current++;
        controller.current?.abort();
        cursor.current = null;
      }
      const epoch = generation.current;
      const abort = new AbortController();
      controller.current = abort;
      inFlight.current = true;
      setLoading(true);
      setError(false);
      const timeout = setTimeout(() => abort.abort(), 12000);
      try {
        const page = await fetchEventPage(
          stableFilters,
          reset ? null : cursor.current,
          abort.signal,
        );
        if (epoch !== generation.current || abort.signal.aborted) return;
        const last = page[page.length - 1];
        if (last) cursor.current = { date: last.start_date, id: last.id };
        setHasMore(page.length === 30);
        setEvents((previous) => {
          const next = reset
            ? page
            : [
                ...previous,
                ...page.filter((e) => !previous.some((p) => p.id === e.id)),
              ];
          if (reset) {
            if (cache.size >= 12) cache.delete(cache.keys().next().value!);
            cache.set(key, { events: page, at: Date.now() });
          }
          return next;
        });
      } catch {
        if (epoch === generation.current) setError(true);
      } finally {
        clearTimeout(timeout);
        if (epoch === generation.current) {
          inFlight.current = false;
          setLoading(false);
        }
      }
    },
    [stableFilters, key, enabled],
  );
  useEffect(() => {
    const requestGeneration = generation;
    requestGeneration.current++;
    controller.current?.abort();
    inFlight.current = false;
    cursor.current = null;
    setHasMore(true);
    setLoading(false);
    const cached = cache.get(key);
    setEvents(cached?.events ?? []);
    setError(false);
    if (cached) {
      const last = cached.events[cached.events.length - 1];
      if (last) cursor.current = { date: last.start_date, id: last.id };
      setHasMore(cached.events.length === 30);
    }
    const timer = setTimeout(() => {
      if (enabled && (!cached || Date.now() - cached.at > 120000))
        void load(true);
    }, 200);
    return () => {
      clearTimeout(timer);
      requestGeneration.current++;
      controller.current?.abort();
      inFlight.current = false;
    };
  }, [key, load, enabled]);
  const toggleJoin = useCallback(
    async (id: string) => {
      if (!userId || busy) return;
      const epoch = memberEpoch.current;
      setBusy(id);
      try {
        const next = !joined.has(id);
        await setEventMembership(id, next);
        if (epoch === memberEpoch.current)
          setJoined((prev) => {
            const copy = new Set(prev);
            if (next) copy.add(id);
            else copy.delete(id);
            return copy;
          });
      } finally {
        setBusy(null);
      }
    },
    [userId, busy, joined],
  );
  return {
    events,
    loading,
    error,
    hasMore,
    joined,
    history,
    busy,
    toggleJoin,
    refresh: () => load(true),
    loadMore: () => (hasMore ? load(false) : Promise.resolve()),
  };
}
