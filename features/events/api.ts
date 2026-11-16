import { supabase } from "../../lib/supabase";
import { getPublicProfiles } from "../../lib/profileData";
import { withRequestDeadline } from "../../lib/requestDeadline";
import { eventQueryKey, rememberEvent, rememberEventPage } from "./cache";
import { publicCatalog } from "./publicCatalog";
import { getChatFileObjectName } from "../../lib/chatUpload";
import type { Message } from "../chat/chatModel";
import type { MessageReaction } from "../../lib/messageReactions";
import type {
  ExternalEvent,
  EventCursor,
  EventFilters,
  EventInteractionTaste,
  EventMessage,
  EventPerson,
  EventSocialSummary,
} from "./types";

type Result<T> = { data: T | null; error: unknown };
async function request<T>(
  build: (signal: AbortSignal) => PromiseLike<Result<T>>,
  signal?: AbortSignal,
) {
  const result = await withRequestDeadline(build, signal);
  if (result.error) throw result.error;
  return result.data;
}
const pendingPages = new Map<string, Promise<ExternalEvent[]>>();
export async function fetchEventPage(
  filters: EventFilters,
  cursor: EventCursor | null,
  signal?: AbortSignal,
): Promise<ExternalEvent[]> {
  const filterKey = eventQueryKey(filters);
  const key = JSON.stringify([filterKey, cursor]);
  let pending = pendingPages.get(key);
  if (!pending) {
    const canonical = JSON.parse(filterKey) as EventFilters;
    pending = request<ExternalEvent[]>(
      (deadline) =>
        publicCatalog
          .rpc("get_external_events_page_filtered", {
            p_after_date: cursor?.date ?? null,
            p_after_id: cursor?.id ?? null,
            p_categories: canonical.categories ?? null,
            p_subcategories: canonical.subcategories ?? null,
            p_query: canonical.query ?? null,
            p_lat: canonical.latitude ?? null,
            p_lon: canonical.longitude ?? null,
            p_radius: canonical.radius ?? null,
            p_from: canonical.from ?? null,
            p_until: canonical.until ?? null,
          })
          .abortSignal(deadline),
    ).then(data => {
      const page = data || [];
      page.forEach(rememberEvent);
      if (!cursor) rememberEventPage(filterKey, page);
      return page;
    }).finally(() => pendingPages.delete(key));
    pendingPages.set(key, pending);
  }
  // A screen leaving cancels its subscription, not another screen's prefetch.
  return signal ? withAbort(pending, signal) : pending;
}
export async function fetchEvent(
  id: string,
  signal?: AbortSignal,
): Promise<ExternalEvent> {
  const event = await request<ExternalEvent>(
    (deadline) =>
      supabase
        .rpc("get_external_event", { p_event: id })
        .abortSignal(deadline)
        .single(),
    signal,
  );
  if (!event) throw new Error("event_not_found");
  rememberEvent(event);
  return event;
}
export async function setEventMembership(eventId: string, join: boolean) {
  await request((deadline) =>
    supabase
      .rpc("set_event_membership", { p_event: eventId, p_join: join })
      .abortSignal(deadline),
  );
}
export async function fetchEventSocialSummaries(
  ids: string[],
  signal?: AbortSignal,
): Promise<Record<string, EventSocialSummary>> {
  if (!ids.length) return {};
  return (
    (await request<Record<string, EventSocialSummary>>(
      (deadline) =>
        supabase
          .rpc("get_event_social_summaries", { p_events: ids.slice(0, 100) })
          .abortSignal(deadline),
      signal,
    )) || {}
  );
}
export function eventJoinErrorKey(error: unknown): string {
  const value = error as { message?: string; code?: string; name?: string };
  const message = value?.message || "";
  if (
    /account_required|JWT|not authenticated/i.test(message) ||
    value?.code === "PGRST301"
  )
    return "events.signInAgain";
  if (/event_unavailable|event_not_found/.test(message))
    return "events.unavailableJoin";
  if (/membership_limit/.test(message)) return "events.joinLimit";
  if (/timeout|abort|network|fetch/i.test(message + value?.name))
    return "events.joinNetwork";
  return "events.error";
}
export async function trackEvent(id: string, kind: "view" | "official") {
  await request((deadline) =>
    supabase
      .rpc("track_event_interaction", { p_event: id, p_kind: kind })
      .abortSignal(deadline),
  ).catch(() => {});
}
export async function fetchEventMembership(
  id: string,
  userId: string,
  signal?: AbortSignal,
): Promise<boolean> {
  return !!(await request(
    (deadline) =>
      supabase
        .from("external_event_participants")
        .select("event_id")
        .eq("event_id", id)
        .eq("user_id", userId)
        .abortSignal(deadline)
        .maybeSingle(),
    signal,
  ));
}
export async function fetchEventPersonalization(
  userId: string,
  signal?: AbortSignal,
) {
  return withRequestDeadline(async (deadline) => {
    const [members, interactions] = await Promise.all([
      supabase
        .from("external_event_participants")
        .select("event_id,external_events!inner(starts_at,status)")
        .eq("user_id", userId)
        .eq("external_events.status", "active")
        .gt("external_events.starts_at", new Date().toISOString())
        .limit(100)
        .abortSignal(deadline),
      supabase
        .from("external_event_interactions")
        .select("event_id,kind,external_events(category)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(300)
        .abortSignal(deadline),
    ]);
    if (members.error) throw members.error;
    if (interactions.error) throw interactions.error;
    const history: EventInteractionTaste = { categories: {}, seen: new Set() };
    for (const row of interactions.data || []) {
      history.seen.add(row.event_id);
      const relation = row.external_events as unknown as {
        category: ExternalEvent["category"];
      } | null;
      if (relation?.category)
        history.categories[relation.category] =
          (history.categories[relation.category] || 0) +
          (row.kind === "join" ? 3 : row.kind === "official" ? 2 : 1);
    }
    return {
      joined: new Set((members.data || []).map((row) => String(row.event_id))),
      history,
    };
  }, signal);
}
export async function fetchEventPeople(
  id: string,
  before?: { joined_at: string; user_id: string },
  signal?: AbortSignal,
): Promise<EventPerson[]> {
  return withRequestDeadline(async (deadline) => {
    let query = supabase
      .from("external_event_participants")
      .select("user_id,joined_at")
      .eq("event_id", id)
      .order("joined_at")
      .order("user_id")
      .limit(30);
    if (before)
      query = query.or(
        `joined_at.gt.${before.joined_at},and(joined_at.eq.${before.joined_at},user_id.gt.${before.user_id})`,
      );
    const { data, error } = await query.abortSignal(deadline);
    if (error) throw error;
    const people = data || [];
    const profiles = await withAbort(
      getPublicProfiles(people.map((person) => person.user_id)).catch(() => []),
      deadline,
    );
    const map = new Map(profiles.map((profile) => [profile.id, profile]));
    return people.map((person) => ({
      ...person,
      nombre: map.get(person.user_id)?.nombre ?? "Usuario de Nexo",
      avatar_url: map.get(person.user_id)?.avatar_url,
    }));
  }, signal);
}
export async function fetchEventMessages(
  id: string,
  before?: { created_at: string; id: string },
  signal?: AbortSignal,
): Promise<EventMessage[]> {
  return (
    (await request<EventMessage[]>((deadline) => {
      let query = supabase
        .from("external_event_messages")
        .select("*")
        .eq("event_id", id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(40);
      if (before)
        query = query.or(
          `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`,
        );
      return query.abortSignal(deadline);
    }, signal)) || []
  );
}
export async function sendEventMessage(
  id: string,
  clientId: string,
  body: string,
  type: Message['tipo'] = 'texto',
  file: string | null = null,
) {
  await request((deadline) =>
    supabase
      .rpc("send_event_chat_message", {
        p_event: id,
        p_client: clientId,
        p_body: body,
        p_type: type,
        p_file: getChatFileObjectName(file),
      })
      .abortSignal(deadline),
  );
}
export async function fetchEventReactions(id: string, signal?: AbortSignal): Promise<MessageReaction[]> {
  return (await request<MessageReaction[]>(deadline => supabase.rpc('get_event_chat_reactions', { p_event: id }).abortSignal(deadline), signal)) || [];
}
export async function toggleEventReaction(id: string, message: string, emoji: string) {
  await request(deadline => supabase.rpc('toggle_event_chat_reaction', { p_event: id, p_message: message, p_emoji: emoji }).abortSignal(deadline));
}
export async function deleteEventMessage(id: string, message: string) {
  await request(deadline => supabase.rpc('delete_event_chat_message', { p_event: id, p_message: message }).abortSignal(deadline));
}
export function subscribeEventChat(id: string, onChange: () => void): () => void {
  const channel = supabase.channel(`event-chat:${id}`).on('postgres_changes', {
    event: '*', schema: 'public', table: 'external_event_messages', filter: `event_id=eq.${id}`,
  }, onChange).subscribe();
  return () => { void supabase.removeChannel(channel); };
}
export type EventChatThread = { event: ExternalEvent; last_message: EventMessage | null; unread: number; muted: boolean };
export async function fetchEventChatThreads(): Promise<EventChatThread[]> {
  return (await request<EventChatThread[]>(deadline => supabase.rpc('get_event_chat_threads').abortSignal(deadline))) || [];
}
export async function setEventChatPreferences(id: string, values: { read?: boolean; hidden?: boolean; muted?: boolean }) {
  await request(deadline => supabase.rpc('set_event_chat_preferences', {
    p_event: id, p_read: values.read ?? false, p_hidden: values.hidden ?? null, p_muted: values.muted ?? null,
  }).abortSignal(deadline));
}
export async function reportEventMessage(
  messageId: string,
  userId: string,
  reason: string,
) {
  try {
    await request((deadline) =>
      supabase
        .from("external_event_reports")
        .insert({ message_id: messageId, reporter_id: userId, reason })
        .abortSignal(deadline),
    );
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") throw error;
  }
}
function withAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("request_aborted"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
