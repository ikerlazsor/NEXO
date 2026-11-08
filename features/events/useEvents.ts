import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  fetchEventPage,
  fetchEventPersonalization,
  setEventMembership,
  fetchEventSocialSummaries,
} from "./api";
import { isPublishableEvent } from "../../lib/externalEventPolicy.cjs";
import {
  publishEventMembership,
  subscribeEventMembership,
} from "./membershipBus";
import type {
  ExternalEvent,
  EventCursor,
  EventFilters,
  EventInteractionTaste,
  EventSocialSummary,
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
  const currentKey = useRef(key);
  currentKey.current = key;
  const stableFilters = useMemo(() => JSON.parse(key) as EventFilters, [key]);
  const [events, setEvents] = useState<ExternalEvent[]>([]);
  const [social, setSocial] = useState<{
    scope: string | null;
    values: Record<string, EventSocialSummary>;
  }>({ scope: userId, values: {} });
  const [resultKey, setResultKey] = useState(key);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(false),
    [hasMore, setHasMore] = useState(true);
  const scope = enabled ? userId : null;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [personal, setPersonal] = useState(() => ({
    scope,
    joined: new Set<string>(),
    history: emptyHistory(),
  }));
  // Account changes must hide the previous viewer's state in this render,
  // before focus/effect cleanup has a chance to run.
  const joined = useMemo(
    () => (personal.scope === scope ? personal.joined : new Set<string>()),
    [personal, scope],
  );
  const history = personal.scope === scope ? personal.history : emptyHistory();
  const [mutation, setMutation] = useState<{
    scope: string;
    id: string;
  } | null>(null);
  const joinLock = useRef<typeof mutation>(null);
  const cursor = useRef<EventCursor | null>(null),
    controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    inFlight = useRef(false);
  const memberEpoch = useRef(0),
    memberController = useRef<AbortController | null>(null);
  const socialEpoch = useRef(0),
    socialController = useRef<AbortController | null>(null);
  const refreshPersonal = useCallback(() => {
    const epoch = ++memberEpoch.current;
    memberController.current?.abort();
    if (!scope || joinLock.current?.scope === scope) return;
    const abort = new AbortController();
    memberController.current = abort;
    const timeout = setTimeout(() => abort.abort(), 12000);
    void fetchEventPersonalization(scope, abort.signal)
      .then((result) => {
        if (
          epoch === memberEpoch.current &&
          currentScope.current === scope &&
          !abort.signal.aborted
        )
          setPersonal({ scope, ...result });
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
    return () => {
      memberEpoch.current++;
      abort.abort();
      clearTimeout(timeout);
    };
  }, [scope]);
  useFocusEffect(refreshPersonal);
  const visibleEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          isPublishableEvent(event) &&
          (!stableFilters.subcategories?.length ||
            stableFilters.subcategories.includes(event.subcategory || "otro")),
      ),
    [events, stableFilters],
  );
  const socialIds = visibleEvents
    .slice(0, 100)
    .map((e) => e.id)
    .join(",");
  const refreshSocial = useCallback(() => {
    const epoch = ++socialEpoch.current;
    socialController.current?.abort();
    if (!enabled || !socialIds) return;
    const abort = new AbortController();
    socialController.current = abort;
    void fetchEventSocialSummaries(socialIds.split(","), abort.signal)
      .then((values) => {
        if (
          epoch === socialEpoch.current &&
          !abort.signal.aborted &&
          currentScope.current === scope
        )
          setSocial({ scope, values });
      })
      .catch(() => {});
    return () => abort.abort();
  }, [socialIds, scope, enabled]);
  useFocusEffect(refreshSocial);
  useEffect(
    () => () => {
      socialEpoch.current++;
      socialController.current?.abort();
    },
    [],
  );
  useEffect(
    () =>
      subscribeEventMembership((change) => {
        if (change.userId !== scope) return;
        setPersonal((prev) => {
          const own =
            prev.scope === scope
              ? prev
              : { scope, joined: new Set<string>(), history: emptyHistory() };
          const copy = new Set(own.joined);
          if (change.joined) copy.add(change.eventId);
          else copy.delete(change.eventId);
          return { ...own, joined: copy };
        });
        setSocial((prev) => {
          if (prev.scope !== scope || !prev.values[change.eventId]) return prev;
          const summary = prev.values[change.eventId];
          return {
            scope,
            values: {
              ...prev.values,
              [change.eventId]: {
                ...summary,
                joined: change.joined,
                count: Math.max(
                  0,
                  summary.count +
                    (summary.joined === change.joined
                      ? 0
                      : change.joined
                        ? 1
                        : -1),
                ),
              },
            },
          };
        });
        refreshSocial();
      }),
    [scope, refreshSocial],
  );
  const load = useCallback(
    async (reset = false) => {
      if (
        !enabled ||
        currentKey.current !== key ||
        (inFlight.current && !reset)
      )
        return;
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
        if (
          epoch !== generation.current ||
          currentKey.current !== key ||
          abort.signal.aborted
        )
          return;
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
    setResultKey(key);
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
      if (
        !scope ||
        currentScope.current !== scope ||
        joinLock.current?.scope === scope
      )
        return false;
      const operation = { scope, id };
      joinLock.current = operation;
      setMutation(operation);
      // A snapshot fetched before this change cannot overwrite its result.
      memberEpoch.current++;
      memberController.current?.abort();
      try {
        const next = !joined.has(id);
        await setEventMembership(id, next);
        if (currentScope.current === scope)
          publishEventMembership({ userId: scope, eventId: id, joined: next });
        if (joinLock.current === operation && currentScope.current === scope)
          setPersonal((prev) => {
            const own =
              prev.scope === scope
                ? prev
                : { scope, joined: new Set<string>(), history: emptyHistory() };
            const copy = new Set(own.joined);
            if (next) copy.add(id);
            else copy.delete(id);
            return { ...own, joined: copy };
          });
        return currentScope.current === scope;
      } finally {
        if (joinLock.current === operation) {
          joinLock.current = null;
          setMutation(null);
        }
      }
    },
    [scope, joined],
  );
  return {
    events: resultKey === key ? visibleEvents : [],
    social: social.scope === scope ? social.values : {},
    loading,
    error,
    hasMore,
    joined,
    history,
    busy: mutation?.scope === scope ? mutation.id : null,
    toggleJoin,
    refresh: () => load(true),
    loadMore: () => (hasMore ? load(false) : Promise.resolve()),
  };
}
