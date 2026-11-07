import type { ExternalEvent } from "./types";
import { MAIN_CATEGORY_IDS, SUBCATEGORIES } from "../../lib/categories";
// Synthetic design fixtures, never loaded by the live feed or the importer.
export function previewEvents(): ExternalEvent[] {
  const date = (days: number) =>
    new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  return [
    {
      title: "Una tarde entre arte y nuevas miradas",
      category: "DESCUBRIR",
      subcategory: "museo",
      venue: "Centro cultural · Madrid",
    },
    {
      title: "Música al atardecer, buena compañía",
      category: "SHOWTIME",
      subcategory: "concierto",
      venue: "Auditorio municipal · Madrid",
    },
    {
      title: "Un paseo para descubrir otro Madrid",
      category: "AIRE_LIBRE",
      subcategory: "otro",
      venue: "Parque de Madrid",
    },
    {
      title: "Muévete a tu ritmo: encuentro deportivo",
      category: "DEPORTES",
      subcategory: "otro",
      venue: "Instalación municipal · Madrid",
    },
  ].map((e, i) => ({
    ...e,
    category: e.category as ExternalEvent["category"],
    id: `preview-${i}`,
    provider_id: "madrid",
    source_id: `synthetic-${i}`,
    source_url: "https://datos.madrid.es/",
    description: null,
    start_date: date(i + 1),
    end_date: date(i + 1),
    starts_at: null,
    schedule: null,
    latitude: null,
    longitude: null,
    price_text: null,
    status: "active",
    last_seen_at: new Date().toISOString(),
  }));
}

/** Development-only, synthetic fixture for every existing catalog pair. */
export function previewCoverCatalog(): ExternalEvent[] {
  const template = previewEvents()[0];
  return MAIN_CATEGORY_IDS.flatMap((category) =>
    SUBCATEGORIES[category].map((subcategory) => ({
      ...template,
      id: `catalog-${category}-${subcategory}`,
      source_id: `catalog-${category}-${subcategory}`,
      title: "",
      venue: "Madrid",
      category,
      subcategory,
    })),
  );
}
