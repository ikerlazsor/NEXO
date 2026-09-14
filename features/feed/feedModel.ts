import { ScreenKeys, setScreenScrollOffset } from "../../lib/screenState";

export const DATE_KEYS = ["all", "today", "week"];

export function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function feedDateBounds(from = new Date()): { min: Date; max: Date } {
  const min = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const max = new Date(from.getFullYear(), from.getMonth() + 5, from.getDate());
  min.setHours(0, 0, 0, 0);
  max.setHours(23, 59, 59, 999);
  return { min, max };
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
  }
  if (
    typeof value === "string" &&
    value &&
    value !== "Todos" &&
    value !== "all"
  ) {
    return [value];
  }
  return [];
}

export function toggleInList(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

let feedScrollTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Subida al tope del feed: una sola animación nativa.
 * (El RAF frame-a-frame congelaba FlashList, peor en Expo Go.)
 */
export function smoothScrollListToTop(
  scrollToOffset:
    | ((opts: { offset: number; animated?: boolean }) => void)
    | undefined,
  fromOffset: number,
  onDone?: () => void,
) {
  if (feedScrollTimer) {
    clearTimeout(feedScrollTimer);
    feedScrollTimer = null;
  }

  setScreenScrollOffset(ScreenKeys.FEED, 0);

  if (!scrollToOffset || fromOffset <= 16) {
    scrollToOffset?.({ offset: 0, animated: false });
    onDone?.();
    return;
  }

  scrollToOffset({ offset: 0, animated: true });
  const waitMs = Math.min(650, Math.max(280, 220 + Math.sqrt(fromOffset) * 10));
  feedScrollTimer = setTimeout(() => {
    feedScrollTimer = null;
    setScreenScrollOffset(ScreenKeys.FEED, 0);
    onDone?.();
  }, waitMs);
}
