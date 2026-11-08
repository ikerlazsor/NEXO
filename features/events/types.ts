import type { MainCategoryId } from "../../lib/categories";
export type EventSection = "forYou" | "plans" | "agenda";
export type ExternalEvent = {
  id: string;
  provider_id: string;
  source_id: string;
  source_url: string;
  title: string;
  description: string | null;
  category: MainCategoryId;
  /** Optional while older servers are rolled forward to the subcategory migration. */
  subcategory?: string | null;
  start_date: string;
  end_date: string;
  starts_at: string | null;
  schedule: string | null;
  venue: string | null;
  address?: string | null;
  social_eligible?: boolean;
  location_verified?: boolean;
  location_source?: string | null;
  latitude: number | null;
  longitude: number | null;
  price_text: string | null;
  status: "active" | "cancelled" | "expired" | "stale";
  last_seen_at: string;
};
export type EventFilters = {
  categories?: string[];
  subcategories?: string[];
  query?: string;
  latitude?: number;
  longitude?: number;
  radius?: number;
  from?: string;
  until?: string;
};
export type EventSocialSummary = {
  count: number;
  joined: boolean;
  people: EventPerson[];
};
export type EventCursor = { date: string; id: string };
export type EventInteractionTaste = {
  categories: Partial<Record<MainCategoryId, number>>;
  seen: Set<string>;
};
export type EventMessage = {
  id: string;
  event_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  client_id: string;
};
export type EventPerson = {
  user_id: string;
  joined_at: string;
  nombre?: string;
  avatar_url?: string | null;
};
