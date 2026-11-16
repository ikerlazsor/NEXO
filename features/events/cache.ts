import { diskGet, diskSet } from "../../lib/diskCache";
import type { ExternalEvent, EventFilters, EventSocialSummary } from "./types";

type Page = { events: ExternalEvent[]; at: number };
const pages = new Map<string, Page>();
const details = new Map<string, ExternalEvent>();
let socialScope: string | null = null;
let social: Record<string, { value: EventSocialSummary; at: number }> = {};
export function rememberEventSocial(scope: string | null, values: Record<string, EventSocialSummary>): void {
  if (scope !== socialScope) { socialScope = scope; social = {}; }
  for (const [id, value] of Object.entries(values)) social[id] = { value, at: Date.now() };
  const oldest = Object.entries(social).sort((a, b) => a[1].at - b[1].at);
  for (const [id] of oldest.slice(0, Math.max(0, oldest.length - 300))) delete social[id];
}
export function peekEventSocial(scope: string | null, id: string): EventSocialSummary | null {
  const entry = social[id];
  return scope === socialScope && entry && Date.now() - entry.at < 120000 ? entry.value : null;
}

export function eventQueryKey(filters: EventFilters): string {
  return JSON.stringify({
    categories: filters.categories?.length ? [...filters.categories].sort() : undefined,
    subcategories: filters.subcategories?.length ? [...filters.subcategories].sort() : undefined,
    query: filters.query?.trim() || undefined,
    from: filters.from || undefined,
    until: filters.until || undefined,
    ...(filters.radius != null ? { radius: filters.radius, latitude: filters.latitude, longitude: filters.longitude } : {}),
  });
}
export function rememberEvent(event: ExternalEvent): void {
  if (details.size >= 300) details.delete(details.keys().next().value!);
  details.set(event.id, event);
}
export function peekEvent(id: string): ExternalEvent | null {
  return details.get(id) ?? null;
}
export function peekEventPage(key: string): Page | undefined { return pages.get(key); }
export function rememberEventPage(key: string, events: ExternalEvent[]): void {
  events.forEach(rememberEvent);
  if (pages.size >= 12) pages.delete(pages.keys().next().value!);
  const page = { events, at: Date.now() };
  pages.set(key, page);
  // Public event facts only; no user membership, history or profile data on disk.
  if (key === "{}") void diskSet("social-events:v2", page);
}
export async function hydrateEventPage(key: string): Promise<Page | undefined> {
  if (pages.has(key)) return pages.get(key);
  if (key !== "{}") return undefined;
  const page = await diskGet<Page>("social-events:v2", 24 * 60 * 60 * 1000);
  if (page && Array.isArray(page.events) && !pages.has(key)) {
    pages.set(key, page);
    page.events.forEach(rememberEvent);
  }
  return pages.get(key);
}
