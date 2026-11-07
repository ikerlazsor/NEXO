import { classifyExternalEvent } from "../../lib/externalEventClassification.cjs";
import {
  getCoverImages,
  PLACEHOLDER_COVER_URI,
  SUBCATEGORIES,
  type CoverSource,
} from "../../lib/categories";
import type { ExternalEvent } from "./types";

export function eventClassification(
  event: Pick<
    ExternalEvent,
    "category" | "subcategory" | "title" | "description"
  >,
) {
  const inferred = classifyExternalEvent(event.title, null, event.description);
  const category = event.category;
  const subcategory =
    event.subcategory && SUBCATEGORIES[category].includes(event.subcategory)
      ? event.subcategory
      : inferred.category === category
        ? inferred.subcategory
        : "otro";
  return { category, subcategory };
}

/** Same bundled photos as plans, selected stably so a card never changes on scroll. */
export function eventCoverSource(
  event: Pick<
    ExternalEvent,
    | "category"
    | "subcategory"
    | "title"
    | "description"
    | "provider_id"
    | "source_id"
  >,
): CoverSource {
  const { category, subcategory } = eventClassification(event);
  const photos = getCoverImages(category, subcategory).filter(
    (source) => source !== PLACEHOLDER_COVER_URI,
  );
  const candidates = photos.length ? photos : getCoverImages(category, "otro");
  let hash = 2166136261;
  for (const character of `${event.provider_id}:${event.source_id}:${category}:${subcategory}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  return candidates[hash % candidates.length];
}
