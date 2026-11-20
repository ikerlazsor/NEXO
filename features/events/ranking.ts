import {
  personalityPreferredCategories,
  scoreFeedPlanRanked,
  type AffinityPlan,
  type RankContext,
  type FeedTaste,
} from "../../lib/feedAffinity";
import type { ExternalEvent, EventInteractionTaste } from "./types";
import type { FeedScores } from "../../lib/feedScores";

const feedScoreKey = (kind: "plan" | "event", id: string) => `${kind}:${id}`;
import { isParticipatoryActivity, isPublishableEvent } from "../../lib/externalEventPolicy.cjs";

/** Las quedadas participativas (yoga, running, idiomas...) son lo que hace la app
 * social; van por delante de conciertos o teatro con la misma afinidad. */
export const PARTICIPATORY_EVENT_BOOST = 18;
/** Extra por ser un plan creado por un usuario de Nexo (no scrapeado). */
export const USER_PLAN_BONUS = 70;
const FRIEND_JOINED = 42;
const FRIEND_JOINED_CAP = 120;

/** Asistentes conocidos fuera de Nexo (attendance_hint): pesan poco, máx. 8. */
export function popularityBoost(count: unknown): number {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(8, 2.5 * Math.log2(1 + n));
}

/** Gente de Nexo apuntada: mismo peso en planes y eventos (igual que feedAffinity). */
export function nexoPeopleBoost(count: unknown): number {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(80, (70 * Math.log2(1 + n)) / Math.log2(17));
}

type EventSocial = Record<string, { count?: number; people?: { user_id?: string }[] } | undefined>;

export function rankUnifiedFeed<
  T extends { id: string; kind: string; plan?: AffinityPlan; membership?: string },
>(
  social: T[],
  events: ExternalEvent[],
  context: RankContext & {
    eventHistory?: EventInteractionTaste;
    joinedEvents?: Set<string>;
    /** Nexo: cuántos van a cada evento y quiénes (get_event_social_summaries). */
    eventSocial?: EventSocial;
    /** Orden del servidor (get_feed_scores). Si hay, manda sobre el local. */
    serverScores?: FeedScores | null;
  },
) {
  const rows: (T | { kind: "event"; id: string; event: ExternalEvent })[] = [
    ...social.filter((row) => row.kind === "plan"),
    ...dedupeSameSlotEvents(events)
      .filter((event) => isPublishableEvent(event, context.now ?? Date.now()))
      .map((event) => ({
        kind: "event" as const,
        id: `event:${event.id}`,
        event,
      })),
  ];
  const server = context.serverScores || null;
  const serverOf = (row: (typeof rows)[number]) =>
    server?.[row.kind === "event" && "event" in row ? feedScoreKey("event", row.event.id) : feedScoreKey("plan", row.id)];
  const friendsInEvent = (eventId: string) =>
    (context.eventSocial?.[eventId]?.people || []).filter((p) => !!p.user_id && context.friendIds.has(p.user_id)).length;
  const localScore = (row: (typeof rows)[number]) => {
    const category =
      row.kind === "event" && "event" in row
        ? row.event.category
        : (row as T).plan?.categoria;
    const history = context.eventHistory?.categories || {};
    const interactionBoost =
      (16 * (history[category as keyof typeof history] || 0)) /
      Math.max(1, ...Object.values(history));
    if (row.kind === "event" && "event" in row) {
      const e = row.event;
      const friends = friendsInEvent(e.id);
      return (
        interactionBoost +
        (isParticipatoryActivity(e.title, e.subcategory ?? "") ? PARTICIPATORY_EVENT_BOOST : 0) +
        popularityBoost(e.attendance_hint) +
        nexoPeopleBoost(context.eventSocial?.[e.id]?.count) +
        (friends > 0 ? Math.min(FRIEND_JOINED_CAP, (FRIEND_JOINED * (1 - 0.7 ** friends)) / 0.3) : 0) +
        scoreFeedPlanRanked(
          {
            id: row.id,
            categoria: e.category,
            tipo_deporte: e.subcategory,
            fecha_evento: e.starts_at,
            latitud: e.latitude,
            longitud: e.longitude,
          },
          context,
        )
      );
    }
    // La gente apuntada ya cuenta dentro de scoreFeedPlanRanked.
    return scoreFeedPlanRanked((row as T).plan || {}, context) + USER_PLAN_BONUS + interactionBoost;
  };
  const scores = new Map(rows.map((row) => [row.id, serverOf(row)?.s ?? localScore(row)]));
  const localPriority = (row: (typeof rows)[number]) => {
    if (row.kind === "event" && "event" in row) {
      if (context.joinedEvents?.has(row.event.id)) return 0;
      return friendsInEvent(row.event.id) > 0 ? 1 : 2;
    }
    const socialRow = row as T;
    const plan = socialRow.plan;
    if (context.currentUserId && (plan?.creador_id === context.currentUserId || socialRow.membership === "joined")) return 0;
    if ((plan?.creador_id && context.friendIds.has(plan.creador_id)) || plan?.participantsList?.some(p => !!p.id && context.friendIds.has(p.id))) return 1;
    return 2;
  };
  // Lo local refleja al momento lo que acabas de hacer (unirte, salir); el servidor
  // aporta lo que la app no ve (amigos en eventos). Gana el grupo más alto.
  const priority = (row: (typeof rows)[number]) => Math.min(localPriority(row), serverOf(row)?.t ?? 2);
  return rows.sort(
    (a, b) => priority(a) - priority(b) || scores.get(b.id)! - scores.get(a.id)! || a.id.localeCompare(b.id),
  );
}

/** Membership updates/pagination cannot shuffle cards the reader has already seen. */
export function retainFeedOrder<T extends { id: string }>(
  previous: string[],
  ranked: T[],
): T[] {
  const byId = new Map(ranked.map((row) => [row.id, row]));
  const result = previous.flatMap((id) => {
    const row = byId.get(id);
    byId.delete(id);
    return row ? [row] : [];
  });
  return [...result, ...ranked.filter((row) => byId.has(row.id))];
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function eventDistanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * r) / 2) ** 2 +
    Math.cos(a.latitude * r) *
      Math.cos(b.latitude * r) *
      Math.sin(((b.longitude - a.longitude) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(clamp(h)));
}
export function externalEventScore(
  event: ExternalEvent,
  taste: FeedTaste,
  history: EventInteractionTaste,
  coords: { latitude: number; longitude: number } | null,
  now: number,
) {
  const preferred = personalityPreferredCategories(
    taste.personalityTags,
  ).includes(event.category)
    ? 1
    : 0;
  const counts = Object.values(taste.preferredCategories);
  const category = clamp(
    preferred * 0.6 +
      ((taste.preferredCategories[event.category] || 0) /
        Math.max(1, ...counts)) *
        0.4,
  );
  // Unknown coordinates are neutral; they must never imply zero distance.
  const proximity =
    coords && event.latitude != null && event.longitude != null
      ? 1 /
        (1 +
          eventDistanceKm(coords, {
            latitude: event.latitude,
            longitude: event.longitude,
          }) /
            10)
      : 0.5;
  const days = Math.max(
    0,
    (Date.parse(`${event.start_date}T12:00:00Z`) - now) / 86400000,
  );
  const date = 1 / (1 + days / 14);
  const interactions =
    (history.categories[event.category] || 0) /
    Math.max(1, ...Object.values(history.categories));
  const discovery = history.seen.has(event.id) ? 0 : 1;
  return (
    0.35 * category +
    0.25 * proximity +
    0.2 * date +
    0.15 * interactions +
    0.05 * discovery
  );
}
export function rankExternalEvents(
  events: ExternalEvent[],
  taste: FeedTaste,
  history: EventInteractionTaste,
  coords: { latitude: number; longitude: number } | null,
  now = Date.now(),
) {
  const remaining = dedupeSameSlotEvents([...new Map(events.map((e) => [e.id, e])).values()]).filter(
    (e) => e.status === "active",
  );
  const scores = new Map(
    remaining.map((e) => [
      e.id,
      externalEventScore(e, taste, history, coords, now),
    ]),
  );
  const result: ExternalEvent[] = [];
  while (remaining.length) {
    const recent = result.slice(-3);
    remaining.sort((a, b) => {
      const adjusted = (e: ExternalEvent) =>
        (scores.get(e.id) || 0) -
        recent.filter((x) => x.category === e.category).length * 0.1;
      return (
        adjusted(b) - adjusted(a) ||
        a.start_date.localeCompare(b.start_date) ||
        a.id.localeCompare(b.id)
      );
    });
    result.push(remaining.shift()!);
  }
  return result;
}
// Social order comes unchanged from feedAffinity/buildFeedRows. External scores
// are never compared against its different score scale.
export function interleaveSocialRows<T>(
  social: T[],
  events: ExternalEvent[],
  isPlan: (row: T) => boolean,
  sectionOf?: (row: T) => "protected" | "open" | null,
): (T | { kind: "event"; id: string; event: ExternalEvent })[] {
  const count = social.filter(isPlan).length;
  const interval = count >= 6 ? 3 : 1;
  const cap = count >= 6 ? Math.floor(count / 3) : events.length;
  const output: (T | { kind: "event"; id: string; event: ExternalEvent })[] =
    [];
  let planCount = 0,
    index = 0;
  let protectedSection = false;
  for (const row of social) {
    output.push(row);
    const section = sectionOf?.(row);
    if (section) {
      protectedSection = section === "protected";
      planCount = 0;
    }
    if (
      !protectedSection &&
      isPlan(row) &&
      ++planCount % interval === 0 &&
      index < Math.min(cap, events.length)
    ) {
      const event = events[index++];
      output.push({ kind: "event", id: `event:${event.id}`, event });
    }
  }
  if (count < 6)
    for (; index < events.length; index++) {
      const event = events[index];
      output.push({ kind: "event", id: `event:${event.id}`, event });
    }
  return output;
}

/** Quita eventos repetidos: mismo sitio y misma hora (p. ej. el mismo intercambio
 * anunciado en dos idiomas). Se queda con el que más gente apuntada tiene. */
export function dedupeSameSlotEvents<E extends { id: string; starts_at?: string | null; venue?: string | null; attendance_hint?: number | null }>(events: E[]): E[] {
  const best = new Map<string, E>();
  const out: E[] = [];
  for (const e of events) {
    const venue = (e.venue || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const t = e.starts_at ? Date.parse(e.starts_at) : NaN;
    if (!venue || !Number.isFinite(t)) { out.push(e); continue; }
    const key = `${venue}|${Math.round(t / 60000)}`;
    const prev = best.get(key);
    if (!prev) { best.set(key, e); out.push(e); continue; }
    if ((e.attendance_hint ?? 0) > (prev.attendance_hint ?? 0)) {
      best.set(key, e);
      out[out.indexOf(prev)] = e;
    }
  }
  return out;
}
