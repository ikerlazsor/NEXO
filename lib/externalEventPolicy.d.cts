export function calendarDay(now: Date): string;
export function horizon(now?: Date): Date;
export function madridInstant(day: string, clock: string): string | null;
export function confirmedStart(
  start: string,
  end: string | null,
  clock: string | null,
): string | null;
export function hasConfirmedLocation(event: {
  venue: string | null;
  latitude: number | null;
  longitude: number | null;
}): boolean;
export function isSocialActivity(title: string, description?: string): boolean;
export function isPublishableEvent(
  event: {
    title: string;
    description?: string | null;
    status: string;
    starts_at: string | null;
    venue: string | null;
    latitude: number | null;
    longitude: number | null;
    social_eligible?: boolean;
  },
  now?: number,
): boolean;
export function identityTitle(value: string): string;
