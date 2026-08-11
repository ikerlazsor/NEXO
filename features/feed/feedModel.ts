import { ScreenKeys, setScreenScrollOffset } from "../../lib/screenState";

export const DATE_KEYS = ["all", "today", "week", "month"];

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
