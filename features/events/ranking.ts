import {
  personalityPreferredCategories,
  scoreFeedPlanRanked,
  type AffinityPlan,
  type RankContext,
  type FeedTaste,
} from "../../lib/feedAffinity";
import type { ExternalEvent, EventInteractionTaste } from "./types";
import { isPublishableEvent } from "../../lib/externalEventPolicy.cjs";

export function rankUnifiedFeed<
  T extends { id: string; kind: string; plan?: AffinityPlan },
>(
  social: T[],
  events: ExternalEvent[],
  context: RankContext & { eventHistory?: EventInteractionTaste },
) {
  const rows: (T | { kind: "event"; id: string; event: ExternalEvent })[] = [
    ...social.filter((row) => row.kind === "plan"),
    ...events
      .filter((event) => isPublishableEvent(event, context.now ?? Date.now()))
      .map((event) => ({
        kind: "event" as const,
        id: `event:${event.id}`,
        event,
      })),
  ];
  const score = (row: (typeof rows)[number]) => {
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
      return (
        interactionBoost +
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
    return (
      scoreFeedPlanRanked((row as T).plan || {}, context) +
      24 +
      interactionBoost
    );
  };
  const scores = new Map(rows.map((row) => [row.id, score(row)]));
  return rows.sort(
    (a, b) => scores.get(b.id)! - scores.get(a.id)! || a.id.localeCompare(b.id),
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
  const remaining = [...new Map(events.map((e) => [e.id, e])).values()].filter(
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
