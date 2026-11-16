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
  // Repair older broad/mistaken classifications using explicit activity names.
  const titleMatch = classifyExternalEvent(event.title);
  if (titleMatch.category !== "DESCUBRIR" || titleMatch.subcategory !== "otro" || /\b(fotograf[ií]a|photography)\b/i.test(event.title)) return titleMatch;
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
  let candidates = photos.length ? photos : getCoverImages(category, "otro");
  const title = event.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (category === "DEPORTES" && subcategory === "otro") {
    // Reuse the existing outdoor-yoga photo even though it lives in a mixed
    // catalogue. Other sports never borrow a combat/climbing photo at random.
    if (/\byoga\b/.test(title)) return getCoverImages("AIRE_LIBRE", "otro")[4];
    const index = /\b(jiu.?jitsu|bjj|judo)\b/.test(title) ? 4 : /\b(escalada|climbing|boulder)\b/.test(title) ? 1 : /\b(pesas|halterofilia|crossfit)\b/.test(title) ? 3 : 0;
    candidates = [candidates[index] ?? candidates[0]];
  } else if (subcategory === "otro") {
    const socialPhotos = getCoverImages("VIBES", "otro");
    const neutralGroup = [socialPhotos[0], socialPhotos[2], socialPhotos[3]];
    if (category === "VIBES") {
      candidates = /\b(meditacion|meditation)\b/.test(title) ? [socialPhotos[4]] : neutralGroup;
    } else if (category === "DESCUBRIR") {
      // This mixed catalogue is camera / diving / desert / road trip.
      candidates = /\b(fotografia|photography)\b/.test(title) ? [candidates[0]] : /\b(buceo|diving)\b/.test(title) ? [candidates[1], candidates[4]] : neutralGroup;
    } else if (category === "AIRE_LIBRE") {
      candidates = candidates.slice(0, 4); // Yoga is selected explicitly above.
    }
  }
  let hash = 2166136261;
  for (const character of `${event.provider_id}:${event.source_id}:${category}:${subcategory}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  return candidates[hash % candidates.length];
}
