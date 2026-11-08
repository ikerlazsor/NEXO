"use strict";

// Shared by the municipal importer and the mobile client. Every result uses
// an existing Nexo category/subcategory; unknown topics stay in "otro".
const RULES = [
  [
    "AIRE_LIBRE",
    "senderismo",
    /\b(senderis\w*|hiking|hike|trekking|trek|rutas? de montana|excursion\w*|mountain walk\w*)\b/,
  ],
  ["AIRE_LIBRE", "picnic", /\b(picnic|pic nic)\b/],
  ["AIRE_LIBRE", "playa", /\b(playas?|beach\w*)\b/],
  [
    "AIRE_LIBRE",
    "mirador",
    /\b(mirador\w*|viewpoint\w*|observacion de estrellas|astronomia)\b/,
  ],
  ["DEPORTES", "futbol", /\b(futbol\w*|football|soccer|futsal)\b/],
  ["DEPORTES", "baloncesto", /\b(baloncesto|basketball|basket)\b/],
  ["DEPORTES", "padel", /\b(padel|paddle tennis)\b/],
  [
    "DEPORTES",
    "otro",
    /\b(yoga|pilates|fitness|natacion|tenis|tennis|ciclismo|cycling)\b/,
  ],
  [
    "DEPORTES",
    "running",
    /\b(running|runners?|maraton\w*|media maraton|carrera\w* popular\w*|atletismo|jogging)\b/,
  ],
  [
    "VIBES",
    "juegos_mesa",
    /\b(juegos? de mesa|board games?|ajedrez|chess|ludoteca\w*)\b/,
  ],
  ["VIBES", "gaming", /\b(videojuego\w*|gaming|e sports|esports)\b/],
  [
    "VIBES",
    "compras",
    /\b(compras|shopping|mercadillo\w*|feria\w* de artesania)\b/,
  ],
  ["VIBES", "fiesta", /\b(fiesta\w*|party|parties|discoteca\w*|dj set)\b/],
  ["FOODIES", "cafe", /\b(cafes?|cafeteria\w*|coffee)\b/],
  ["FOODIES", "tapas", /\b(tapas|tapeo|pinchos|pintxos)\b/],
  ["FOODIES", "cenar", /\b(cena\w*|dinner)\b/],
  [
    "FOODIES",
    "comer",
    /\b(comida\w*|comer|almuerzo\w*|brunch|lunch|cocina\w*|cooking)\b/,
  ],
  [
    "SHOWTIME",
    "cine",
    /\b(cine\w*|cinema\w*|film\w*|pelicula\w*|proyeccion\w*|documental\w*)\b/,
  ],
  [
    "SHOWTIME",
    "teatro",
    /\b(teatro\w*|theat\w*|dramaturgia|obra teatral|titeres|marionetas)\b/,
  ],
  [
    "SHOWTIME",
    "concierto",
    /\b(concierto\w*|concert\w*|recital\w*|musica\w*|music|jazz|orquesta\w*|opera)\b/,
  ],
  [
    "SHOWTIME",
    "espectaculo",
    /\b(espectaculo\w*|show|danza\w*|dance|circo\w*|magia|comedia|monologo\w*)\b/,
  ],
  [
    "DESCUBRIR",
    "museo",
    /\b(museo\w*|museum\w*|exposicion\w*|exhibition\w*|galeria\w*|arte|art)\b/,
  ],
  [
    "DESCUBRIR",
    "idiomas",
    /\b(idioma\w*|language\w*|ingles|english|frances|french|aleman|german|italiano|italian|intercambio linguistico)\b/,
  ],
  [
    "DESCUBRIR",
    "estudio",
    /\b(lectura\w*|reading|libro\w*|book\w*|literatura|estudio\w*|study|charla\w*|conferencia\w*|debate\w*|taller\w*|workshop\w*)\b/,
  ],
  [
    "DESCUBRIR",
    "viajes",
    /\b(viaje\w*|travel\w*|turismo|tour\w*|visita\w* guiada\w*|ruta\w* cultural\w*|paseo\w* historico\w*)\b/,
  ],
];
const GENERAL = [
  [
    "DEPORTES",
    /\b(deport\w*|sport\w*|yoga|pilates|fitness|natacion|tenis|tennis|ciclismo|cycling)\b/,
  ],
  [
    "AIRE_LIBRE",
    /\b(naturaleza|nature|jardin\w*|garden\w*|aire libre|outdoor\w*|paseo\w*|walk\w*|ruta\w*)\b/,
  ],
  ["FOODIES", /\b(gastronom\w*|degustacion\w*|cata\w*|food|tasting)\b/],
  ["VIBES", /\b(ocio|juego\w*|leisure)\b/],
];
function normalize(value) {
  if (Array.isArray(value))
    value = value.filter((v) => typeof v === "string").join(" ");
  if (typeof value !== "string") return "";
  return value
    .slice(0, 8000)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_/.-]/g, " ");
}
function classifyExternalEvent(title, type, description) {
  // A specific title wins over a generic provider type or incidental description.
  for (const raw of [title, type, description]) {
    const value = normalize(raw);
    const match = RULES.find(([, , pattern]) => pattern.test(value));
    if (match) return { category: match[0], subcategory: match[1] };
    const general = GENERAL.find(([, pattern]) => pattern.test(value));
    if (general) return { category: general[0], subcategory: "otro" };
  }
  return { category: "DESCUBRIR", subcategory: "otro" };
}
module.exports = { classifyExternalEvent };
