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

/** Elige fotos concretas de la galería de Nexo (índices de getCoverImages). */
function photos(main: Parameters<typeof getCoverImages>[0], sub: string, indexes: number[]) {
  const all = getCoverImages(main, sub);
  return () => indexes.map((i) => all[i]).filter((source) => source != null && source !== PLACEHOLDER_COVER_URI);
}
function merge(...groups: (() => CoverSource[])[]) {
  return () => groups.flatMap((group) => group());
}

/** Temas reconocibles en el título → fotos que de verdad los representan.
 * El orden importa: gana el primer tema que aparece (p. ej. "intercambio de
 * idiomas + karaoke" es un intercambio). */
const TOPIC_COVERS: [RegExp, () => CoverSource[]][] = [
  [/\b(cine|cines|cineforum|cine club|pelicula\w*|film|films|documental\w*)\b/, photos("SHOWTIME", "cine", [0, 1, 2, 3])],
  [/\b(danza\w*|dance\w*|dancing|baile\w*|bailar|salsa|bachata|kizomba|tango|flamenco|ballet|swing|lindy|zumba|merengue|chotis|sevillanas)\b/, merge(photos("SHOWTIME", "espectaculo", [4]), photos("VIBES", "fiesta", [1]))],
  [/\b(club de lectura|book club|libros?|books?|lectura|reading|biblioteca|library|poesia|poetry|poetas?|escritura|writing|relatos?|novela\w*|literari\w*)\b|^["'`«“].+["'»”´],? (de|by) /, photos("DESCUBRIR", "estudio", [3, 4])],
  [/\b(intercambio\w*|language\w*|idiomas|tandem|conversation club|portugues\w*|francais)\b/, merge(photos("DESCUBRIR", "idiomas", [2, 3, 4, 0]), photos("VIBES", "otro", [0]))],
  [/\b(box(?:eo|ing)|kickboxing|muay thai)\b/, photos("SHOWTIME", "otro", [3])],
  [/\bkaraoke\b/, merge(photos("SHOWTIME", "cine", [4]), photos("VIBES", "fiesta", [2]))],
  [/\b(comedia|comedy|monologo\w*|stand ?up|impro\w*|humor|open mic|storytelling)\b/, merge(photos("SHOWTIME", "espectaculo", [1]), photos("SHOWTIME", "otro", [2]))],
  [/\b(meditacion|meditation|mindfulness|relajacion|respiracion|breathwork|budismo|tantra|espiritual\w*)\b/, photos("VIBES", "otro", [4])],
  [/\b(yoga|pilates|estiramientos|stretching)\b/, photos("AIRE_LIBRE", "otro", [4])],
  [/\b(calistenia|obstaculos|crossfit|bootcamp|entrenamiento|workout|gimnasio|gym)\b/, photos("DEPORTES", "otro", [3])],
  [/(senderis|hiking|trekking|mirador|refugio|pinares|\bcerro\b|micolog|\bwalk\b)/, photos("AIRE_LIBRE", "senderismo", [0, 1, 2, 3, 4])],
  [/\b(exposicion\w*|coleccion\w*|museo\w*|museum|galeria\w*|exhibition)\b/, photos("DESCUBRIR", "museo", [0, 1, 2, 3, 4])],
  [/\b(cena\w*|dinner)\b/, photos("FOODIES", "cenar", [0, 1, 2, 3, 4])],
  [/\b(pub crawl|bar crawl|pub quiz|quiz|trivia|afterwork|after work|tardeo\w*|copas|cocktails?|pints?|cervez\w*|cerves|birras?|beers?|drinks?|brindis|happy hour|vermut\w*|speed dating|citas|solter\w*)\b/, merge(photos("VIBES", "otro", [0]), photos("VIBES", "fiesta", [2]), photos("FOODIES", "cenar", [1]))],
  [/\b(networking|startups?|tech|emprendedor\w*|entrepreneur\w*|coworking|business|founders?|programacion|coding|developers?|software|cyber\w*|ai|ia|gpt|chat gpt|opentelemetry|wazuh|real estate|inmobiliario)\b/, photos("DESCUBRIR", "estudio", [0, 1])],
  [/\b(cata\w*|vinos?|wine\w*|tasting)\b/, photos("FOODIES", "cenar", [4, 3])],
  [/\b(tertulia\w*|charla\w*|talks?|debate\w*|discussion|conversation|coloquio)\b/, merge(photos("DESCUBRIR", "idiomas", [2]), photos("VIBES", "otro", [0, 3]))],
  [/\b(speed friending|conocer gente|make friends|new friends|nuevos amigos|nuevas amigas|newcomers?|expats?|social|mixer|quedar|quedada\w*)\b/, photos("VIBES", "otro", [0, 2, 3])],
  [/\b(free tour|visita\w* guiada\w*|ruta guiada|guided tour|ruta\w* cultural\w*|paseo\w* (?:historico|cultural)\w*|walking tour|itinerario)\b/, photos("VIBES", "otro", [2, 3])],
  [/\b(cafe|coffee|brunch|desayuno)\b/, photos("FOODIES", "cafe", [0, 1, 2, 3, 4])],
  [/\b(pintar|pintura|acuarela|dibujo|sketch\w*|collage)\b/, photos("DESCUBRIR", "museo", [2])],
  [/\b(escape room|key game|cluedo)\b/, photos("VIBES", "juegos_mesa", [3, 4])],
  [/\b(fotografia|photography|photo walk)\b/, photos("DESCUBRIR", "otro", [0])],
];

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
  const topic = TOPIC_COVERS.find(([pattern]) => pattern.test(title));
  if (topic) {
    candidates = topic[1]();
  } else if (category === "SHOWTIME") {
    // Fotos que solo encajan con un tema concreto: el estadio (f\u00fatbol), el ring
    // (boxeo) y el karaoke nunca salen al azar en otro espect\u00e1culo.
    const pick = (sub: string) => getCoverImages("SHOWTIME", sub);
    if (subcategory === "espectaculo") candidates = pick("espectaculo").slice(1);
    else if (subcategory === "otro") candidates = pick("otro").filter((_, i) => i !== 3);
    else if (subcategory === "cine") candidates = pick("cine").slice(0, 4);
  } else if (category === "DEPORTES" && subcategory === "otro") {
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
