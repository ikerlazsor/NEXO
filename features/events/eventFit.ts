import { feedFitPercent, type FeedTaste } from "../../lib/feedAffinity";
import { eventClassification } from "./covers";
import type { ExternalEvent } from "./types";

/**
 * Encaje personal de un evento externo (scraping/agenda), con la misma fórmula
 * que los planes de Nexo: categoría, subcategoría y horario frente a tus gustos.
 */
export function eventFitPercent(
  event: Pick<ExternalEvent, "id" | "category" | "subcategory" | "title" | "description" | "starts_at">,
  taste: Pick<FeedTaste, "personalityTags" | "viewerAge"> | null | undefined,
): number | null {
  const { category, subcategory } = eventClassification(event);
  return feedFitPercent(
    {
      categoria: category,
      tipo_deporte: subcategory,
      fecha_evento: event.starts_at ?? null,
      solo_chicas: false,
    },
    {
      personalityTags: taste?.personalityTags ?? [],
      viewerAge: taste?.viewerAge ?? null,
      viewerGenero: null,
    },
    event.id,
  );
}
