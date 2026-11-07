import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import { getPublicProfiles } from "../../lib/profileData";
import { fetchEventMembership, fetchEventMessages, sendEventMessage } from "./api";
import type { EventMessage } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const empty = (scope: string) => ({
  scope,
  messages: [] as EventMessage[],
  names: {} as Record<string, string>,
  text: "",
  member: false,
  failed: false,
  sending: false,
  more: false,
});
type ChatState = ReturnType<typeof empty>;

export function useEventChat(id: string, userId: string | null) {
  const scope = JSON.stringify([id, userId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [state, setState] = useState(() => empty(scope));
  const visible = state.scope === scope ? state : empty(scope);
  const active = useRef(false),
    generation = useRef(0),
    request = useRef<AbortController | null>(null),
    olderLoaded = useRef(false),
    sending = useRef<object | null>(null),
    pending = useRef<{ scope: string; id: string; body: string } | null>(null);

  const refresh = useCallback(async (older?: EventMessage) => {
    if (!userId || !UUID.test(id) || !active.current || currentScope.current !== scope || request.current) return;
    const epoch = generation.current;
    const abort = new AbortController();
    request.current = abort;
    const timeout = setTimeout(() => abort.abort(), 12000);
    const current = () => active.current && currentScope.current === scope && epoch === generation.current && !abort.signal.aborted;
    const update = (fn: (previous: ChatState) => ChatState) => {
      if (current()) setState((previous) => fn(previous.scope === scope ? previous : empty(scope)));
    };
    try {
      const member = await fetchEventMembership(id, userId, abort.signal);
      if (!current()) return;
      if (!member) {
        pending.current = null;
        olderLoaded.current = false;
        update(() => empty(scope));
        generation.current++;
        return;
      }
      update((previous) => ({ ...previous, member: true }));
      const page = await fetchEventMessages(id, older, abort.signal);
      if (!current()) return;
      if (older) olderLoaded.current = true;
      update((previous) => {
        // Keep older pages while polling the newest page. Opening history must
        // never suspend delivery of new messages.
        const messages = older || olderLoaded.current
          ? [...new Map([...previous.messages, ...page].map((message) => [message.id, message])).values()]
              .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
          : page;
        return {
          ...previous,
          messages,
          more: older || !olderLoaded.current ? page.length === 40 : previous.more,
          failed: false,
        };
      });
      // Names enhance the bubbles; a slow profile service must not delay chat
      // messages, pagination or the next membership check.
      void getPublicProfiles([...new Set(page.map((message) => message.sender_id))])
        .then((profiles) => update((previous) => ({
          ...previous,
          names: { ...previous.names, ...Object.fromEntries(profiles.map((profile) => [profile.id, profile.nombre || "Nexo"])) },
        })))
        .catch(() => {});
    } catch {
      // A timeout is actionable; cleanup/account changes invalidate the epoch.
      if (active.current && currentScope.current === scope && epoch === generation.current)
        setState((previous) => ({ ...(previous.scope === scope ? previous : empty(scope)), failed: true }));
    } finally {
      clearTimeout(timeout);
      if (request.current === abort) request.current = null;
    }
  }, [id, userId, scope]);

  useFocusEffect(useCallback(() => {
    active.current = true;
    generation.current++;
    request.current?.abort();
    request.current = null;
    olderLoaded.current = false;
    if (pending.current?.scope !== scope) pending.current = null;
    sending.current = null;
    setState((previous) => ({ ...empty(scope), text: previous.scope === scope ? previous.text : "" }));
    void refresh();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 10000);
    return () => {
      active.current = false;
      generation.current++;
      request.current?.abort();
      request.current = null;
      clearInterval(timer);
    };
  }, [refresh, scope]));

  const setText = (text: string) => {
    if (currentScope.current === scope)
      setState((previous) => ({ ...(previous.scope === scope ? previous : empty(scope)), text }));
  };
  const send = async () => {
    const body = visible.text.trim();
    if (!body || !userId || !visible.member || !active.current || currentScope.current !== scope || sending.current) return;
    const operation = {};
    const epoch = generation.current;
    const current = () => active.current && currentScope.current === scope && generation.current === epoch && sending.current === operation;
    sending.current = operation;
    setState((previous) => ({ ...previous, sending: true }));
    if (pending.current?.scope !== scope || pending.current.body !== body)
      pending.current = { scope, id: Crypto.randomUUID(), body };
    try {
      await sendEventMessage(id, pending.current.id, body);
      if (!current()) return;
      pending.current = null;
      setState((previous) => ({ ...previous, text: "" }));
      // Supersede an older poll so its snapshot cannot hide this new message.
      generation.current++;
      request.current?.abort();
      request.current = null;
      await refresh();
    } catch (error) {
      if (current()) throw error;
    } finally {
      if (sending.current === operation) {
        sending.current = null;
        if (currentScope.current === scope)
          setState((previous) => ({ ...previous, sending: false }));
      }
    }
  };
  return { ...visible, setText, refresh, send };
}
