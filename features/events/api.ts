import { supabase } from "../../lib/supabase";
import { getPublicProfiles } from "../../lib/profileData";
import type {
  ExternalEvent,
  EventCursor,
  EventFilters,
  EventInteractionTaste,
  EventMessage,
  EventPerson,
} from "./types";
export async function fetchEventPage(
  filters: EventFilters,
  cursor: EventCursor | null,
  signal?: AbortSignal,
): Promise<ExternalEvent[]> {
  const { data, error } = await supabase
    .rpc("get_external_events_page", {
      p_after_date: cursor?.date ?? null,
      p_after_id: cursor?.id ?? null,
      p_categories: filters.categories ?? null,
      p_query: filters.query ?? null,
      p_lat: filters.latitude ?? null,
      p_lon: filters.longitude ?? null,
      p_radius: filters.radius ?? null,
      p_from: filters.from ?? null,
      p_until: filters.until ?? null,
    })
    .abortSignal(signal ?? AbortSignal.timeout(12000));
  if (error) throw error;
  return data || [];
}
export async function fetchEvent(id: string): Promise<ExternalEvent> {
  const { data, error } = await supabase
    .rpc("get_external_event", { p_event: id })
    .abortSignal(AbortSignal.timeout(12000))
    .single();
  if (error) throw error;
  return data as ExternalEvent;
}
export async function setEventMembership(eventId: string, join: boolean) {
  const { error } = await supabase
    .rpc("set_event_membership", {
      p_event: eventId,
      p_join: join,
    })
    .abortSignal(AbortSignal.timeout(12000));
  if (error) throw error;
}
export async function trackEvent(id: string, kind: "view" | "official") {
  // Analytics failure never blocks navigation or the social join operation.
  await supabase.rpc("track_event_interaction", { p_event: id, p_kind: kind });
}
export async function fetchEventPersonalization(userId: string) {
  const [members, interactions] = await Promise.all([
    supabase
      .from("external_event_participants")
      .select("event_id")
      .eq("user_id", userId)
      .limit(100),
    supabase
      .from("external_event_interactions")
      .select("event_id,kind,external_events(category)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(300),
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
    joined: new Set((members.data || []).map((x) => String(x.event_id))),
    history,
  };
}
export async function fetchEventPeople(
  id: string,
  before?: { joined_at: string; user_id: string },
): Promise<EventPerson[]> {
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
  const { data, error } = await query;
  if (error) throw error;
  const people = data || [];
  const profiles = await getPublicProfiles(people.map((p) => p.user_id));
  const map = new Map(profiles.map((p) => [p.id, p]));
  return people.map((p) => ({
    ...p,
    nombre: map.get(p.user_id)?.nombre ?? "Usuario de Nexo",
    avatar_url: map.get(p.user_id)?.avatar_url,
  }));
}
export async function fetchEventMessages(
  id: string,
  before?: { created_at: string; id: string },
): Promise<EventMessage[]> {
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
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
export async function sendEventMessage(
  id: string,
  clientId: string,
  body: string,
) {
  const { error } = await supabase
    .rpc("send_event_message", {
      p_event: id,
      p_client: clientId,
      p_body: body,
    })
    .abortSignal(AbortSignal.timeout(12000));
  if (error) throw error;
}
export async function reportEventMessage(
  messageId: string,
  userId: string,
  reason: string,
) {
  const { error } = await supabase
    .from("external_event_reports")
    .insert({ message_id: messageId, reporter_id: userId, reason });
  if (error && error.code !== "23505") throw error;
}
