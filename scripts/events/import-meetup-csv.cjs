#!/usr/bin/env node
"use strict";
/**
 * Prepara un CSV exportado de Meetup como quedadas de Nexo (proveedor nexo_curated).
 *
 *   node scripts/events/import-meetup-csv.cjs <csv> <outDir> [knownCoords.json]
 *
 * Escribe en outDir:
 *  - items.json   eventos limpios, clasificados, con coordenadas y sin duplicados
 *  - report.json  qué se descartó y por qué
 *  - geocode-cache.json  caché de direcciones (para no repetir peticiones)
 *
 * No toca la base de datos: el SQL se genera con meetup-csv-to-sql.cjs.
 */
const fs = require("node:fs");
const path = require("node:path");
const { classifyExternalEvent } = require("../../lib/externalEventClassification.cjs");
const { identityTitle } = require("../../lib/externalEventPolicy.cjs");

/** CSV RFC 4180 (comillas dobles, saltos de línea dentro de campos). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  const keys = header.map((h) => h.replace(/^﻿/, "").trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

const norm = (v) => identityTitle(v);
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]+/gu;
/** Letras «decorativas» de Unicode (𝔼𝕝 𝕃𝕚𝕓𝕣𝕠) → letras normales. */
const plainLetters = (t) => t.normalize("NFKC");

function cleanTitle(t) {
  return plainLetters(t).replace(EMOJI, " ").replace(/\s*[|·]\s*$/g, "").replace(/\s{2,}/g, " ").replace(/^[\s\-–|·:]+|[\s\-–|·:]+$/g, "").trim();
}

/** Texto plano: sin markdown, emojis ni teléfonos personales. */
function cleanDescription(d) {
  return d
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1")
    .replace(/[*_#`>]+/g, "")
    .replace(EMOJI, " ")
    .replace(/(?:\+|00)\s?\d{2}[\s.-]?\d{3}[\s.-]?\d{2,3}[\s.-]?\d{2,3}(?:[\s.-]?\d{2,3})?/g, "")
    .replace(/\b[6-9]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 1500);
}

/** Reglas específicas de Meetup (primero el título; gana la primera que encaja). */
const RULES = [
  [/\b(intercambio\w*|language\w*|idiomas?|tandem|conversation club|english speaking|spanish speaking|sprakutbyte|rencontre|french culture|portugues\w*|portuguese|francais|frances|italiano|chino espanol)\b/, "DESCUBRIR", "idiomas"],
  [/\b(juegos? de mesa|board ?games?|ajedrez|chess|catan|rol\b|dungeons|werewolves|hombres lobo|party game|escape room|key game)\b/, "VIBES", "juegos_mesa"],
  [/\b(fifa|videojuegos?|video ?games?|gaming|playstation|nintendo)\b/, "VIBES", "gaming"],
  [/\b(pub quiz|quiz|trivia)\b/, "VIBES", "otro"],
  [/\bkaraoke\b/, "VIBES", "fiesta"],
  [/\b(mirador)\b/, "AIRE_LIBRE", "mirador"],
  [/\b(senderismo|hiking|hike|trekking|ruta\w* (?:por|de|a|al|en) (?:la )?(?:sierra|monte|montana|cascada|pinar)|monte|montana|sierra|cascada|excursion\w*|picos?|pena\w*|lagunas?|navacerrada|refugio|poza|bosque|valle|castanar|micolog\w*|camino de)\b/, "AIRE_LIBRE", "senderismo"],
  [/\b(picnic)\b/, "AIRE_LIBRE", "picnic"],
  [/\b(running|run club|corredores|correr|trail)\b/, "DEPORTES", "running"],
  [/\b(padel)\b/, "DEPORTES", "padel"],
  [/\b(futbol|football|soccer|pachanga)\b/, "DEPORTES", "futbol"],
  [/\b(baloncesto|basket\w*)\b/, "DEPORTES", "baloncesto"],
  [/\b(yoga|pilates|calistenia|calisthenics|crossfit|bootcamp|escalada|climbing|boulder|volley\w*|voleibol|tenis|tennis|bici\w*|cycling|patinaje)\b/, "DEPORTES", "otro"],
  [/\b(salsa|bachata|kizomba|baile\w*|bailar|dance|dancing|swing|lindy|tango|zouk|wcs|west coast)\b/, "VIBES", "fiesta"],
  [/\b(club de lectura|book club|lectura|libros?|books?|poesia|poetry|escritura|writing|tertulias? literarias?)\b/, "DESCUBRIR", "estudio"],
  [/\b(teatro|theatre|theater)\b/, "SHOWTIME", "teatro"],
  [/\b(cine|pelicula\w*|film|movie\w*|cinefor\w*)\b/, "SHOWTIME", "cine"],
  [/\b(comedia|comedy|monologo\w*|stand ?up|impro\w*|open mic|storytelling)\b/, "SHOWTIME", "espectaculo"],
  [/\b(concierto\w*|jam|musica en directo|live music)\b/, "SHOWTIME", "concierto"],
  [/\b(museo\w*|museum|exposicion\w*|exhibition|visita\w* guiada\w*|ruta guiada|paseo del arte|free tour|walking tour|tour (?:historico|cultural))\b/, "DESCUBRIR", "museo"],
  [/\b(cena\w*|dinner|cenar)\b/, "FOODIES", "cenar"],
  [/\b(tapas|tapeo|vermut\w*|vermouth|mercado|gastro\w*|picoteo)\b/, "FOODIES", "tapas"],
  [/\b(brunch|cafe|coffee|desayuno|breakfast)\b/, "FOODIES", "cafe"],
  [/\b(comida|lunch|almuerzo|paella|cocido)\b/, "FOODIES", "comer"],
  [/\b(cata\w*|vinos?|wine\w*|tasting|cerveza artesana|craft beer|quesos?|sangria|degustacion|panettone)\b/, "FOODIES", "otro"],
  [/\b(speed dating|citas|solter\w*|singles?)\b/, "VIBES", "otro"],
  [/\b(pub crawl|bar crawl|fiesta|party|discoteca)\b/, "VIBES", "fiesta"],
  [/\b(networking|startups?|tech|emprend\w*|entrepreneur\w*|ai|ia|developers?|coding|programacion|business|inmobiliari\w*|real estate|talks?|charlas?|cyber\w*|macroeconomic\w*|geopolitic\w*|qa meetup|browserstack|oratoria|wazuh)\b/, "DESCUBRIR", "estudio"],
  [/\b(meditacion|meditation|mindfulness|budismo|buddhism|respiracion|breathwork)\b/, "VIBES", "otro"],
  [/\b(viajes?|travel\w*|escapada\w*|weekend trip)\b/, "DESCUBRIR", "viajes"],
  [/\b(fotografia|photography|photo walk)\b/, "DESCUBRIR", "otro"],
  [/\b(international|internacional|conocer gente|make friends|meet new people|new friends|nuevos amigos|expats?|newcomers?|social|soical|tertulia\w*|afterwork|after work|drinks|copas|cocktails?|tardeo|small talk|conversation|quedar|quedada\w*|brindis)\b/, "VIBES", "otro"],
];

const BOOK_GROUP = /\b(lectura|libro|libros|book|books|literari\w*|reading|noema|tertulias? culturales)\b/;
const BOOK_TITLE = /^["'«“„].+["'»”´],? (de|by) |, de [A-Z]\.|, by [A-Z]/;
function classify(title, description, group = "") {
  if (BOOK_TITLE.test(title.trim()) || (BOOK_GROUP.test(norm(group)) && !/\b(cine|teatro|ruta|senderismo|cena|tapeo)\b/.test(norm(title))))
    return { category: "DESCUBRIR", subcategory: "estudio" };
  for (const text of [norm(title)]) {
    const rule = RULES.find(([re]) => re.test(text));
    if (rule) return { category: rule[1], subcategory: rule[2] };
  }
  return classifyExternalEvent(title, null, description);
}

/** Clave de serie: el título sin fechas, días ni números (mismo grupo de Meetup). */
const DAY_WORDS = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|june|july|august|september|october|november|december|ene|feb|mar|abr|jun|jul|ago|sep|sept|oct|nov|dic|dec|jan|aug|semanal|weekly|cada|every|todos|los|las|de|del|la|el|this|next|esta|este|hoy|today|tonight|noche|night)\b/g;
function seriesKey(title, group) {
  const base = norm(title).replace(/\b\d+(st|nd|rd|th|º|ª)?\b/g, " ").replace(DAY_WORDS, " ").replace(/\s+/g, " ").trim();
  return base && base.length >= 8 ? base : null;
}

function tokens(title) {
  return new Set(norm(title).split(" ").filter((w) => w.length > 2));
}
function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.max(1, a.size + b.size - inter);
}

/** Noviembre-diciembre: Madrid está en CET (+01:00). */
function madridIso(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const month = Number(date.slice(5, 7));
  const offset = month >= 4 && month <= 10 ? "+02:00" : "+01:00";
  return new Date(`${date}T${time.padStart(5, "0")}:00${offset}`).toISOString();
}

const GENERIC_VENUE = /^(madrid|comunidad de madrid|online|virtual|por confirmar|tbd|to be announced|needs a location)$/i;
const UNSUITABLE = /\b(online|virtual|webinar|zoom|ninos|infantil|kids)\b/;

function addressVariants(it) {
  const simple = it.address
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(loc(al)?|planta|piso|bajo|sala|puerta|esquina|pasaje)\b[^,]*/gi, " ")
    .replace(/\b\d+\s*(º|ª)[^,]*/gi, " ")
    .split(",").map((p) => p.trim()).filter(Boolean);
  const street = simple.slice(0, 2).join(", ");
  return [...new Set([
    it.address,
    `${street}, Madrid`,
    `${it.venue}, ${street}, Madrid`,
    `${it.venue}, Madrid`,
  ])];
}

async function geocode(address, hintLat, cache) {
  const key = norm(address);
  if (cache[key] !== undefined) return cache[key];
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: address, format: "jsonv2", limit: "3", countrycodes: "es",
    viewbox: "-4.7,41.3,-2.6,39.7", bounded: "1",
  }).toString();
  await new Promise((r) => setTimeout(r, 1200));
  let result = null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "NexoEventsImport/1.0 (+https://appnexo.es)", "Accept-Language": "es" } });
    if (res.ok) {
      const list = await res.json();
      const ok = list.find((r) => {
        const lat = Number(r.lat), lon = Number(r.lon);
        if (!(lat >= 39.7 && lat <= 41.3 && lon >= -4.7 && lon <= -2.6)) return false;
        return !Number.isFinite(hintLat) || Math.abs(lat - hintLat) < 0.01;
      });
      if (ok) result = [Number(Number(ok.lat).toFixed(6)), Number(Number(ok.lon).toFixed(6))];
    }
  } catch { /* sin red: se reintenta en la próxima ejecución */ return null; }
  cache[key] = result;
  return result;
}

async function main() {
  const [csvPath, outDir, knownPath] = process.argv.slice(2);
  if (!csvPath || !outDir) throw new Error("uso: import-meetup-csv.cjs <csv> <outDir> [knownCoords.json]");
  fs.mkdirSync(outDir, { recursive: true });
  const known = knownPath && fs.existsSync(knownPath) ? JSON.parse(fs.readFileSync(knownPath, "utf8")) : {};
  const cachePath = path.join(outDir, "geocode-cache.json");
  const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : {};
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const now = Date.now();
  const dropped = [];
  const drop = (r, reason) => dropped.push({ id: r["ID evento"], title: r["Evento"], date: r["Fecha"], reason });

  let items = [];
  for (const r of rows) {
    const title = cleanTitle(r["Evento"] || "");
    const starts = madridIso(r["Fecha"], r["Hora inicio"]);
    const venue = (r["Lugar"] || "").trim();
    if (r["Estado"] !== "ACTIVE") { drop(r, "no activo"); continue; }
    if (r["Modalidad"] !== "PHYSICAL") { drop(r, "no presencial"); continue; }
    if (!title || !starts) { drop(r, "sin título u hora"); continue; }
    if (Date.parse(starts) <= now) { drop(r, "ya ha empezado"); continue; }
    if (!venue || GENERIC_VENUE.test(venue)) { drop(r, "sin sitio concreto"); continue; }
    if (UNSUITABLE.test(norm(title))) { drop(r, "online o infantil"); continue; }
    let endDate = r["Fecha"];
    const endsAt = madridIso(r["Fecha"], r["Hora fin"] || "");
    if (endsAt && Date.parse(endsAt) < Date.parse(starts)) {
      endDate = new Date(Date.parse(r["Fecha"] + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
    }
    const description = cleanDescription(r["Descripción"] || "");
    items.push({
      source_id: r["ID evento"],
      source_url: r["URL evento"],
      title,
      description: description || null,
      ...classify(title, description, r["Grupo"]),
      start_date: r["Fecha"],
      end_date: endDate,
      starts_at: starts,
      venue: cleanTitle(venue),
      address: (r["Dirección"] || "").replace(/,\s*Spain$/i, "").replace(/,\s*España$/i, "").trim() || null,
      hint_lat: Number(r["Latitud"]),
      attendance_hint: Math.max(0, Math.min(100000, Number(r["Inscritos"]) || 0)) || null,
      series_key: seriesKey(title, r["Grupo"]),
      group: r["Grupo"],
    });
  }

  // 1) Mismo evento publicado varias veces (otro grupo u otro idioma).
  items.sort((a, b) => (b.attendance_hint || 0) - (a.attendance_hint || 0) || a.source_id.localeCompare(b.source_id));
  const kept = [];
  for (const it of items) {
    const t = Date.parse(it.starts_at);
    const tk = tokens(it.title);
    const dup = kept.find((k) => {
      const dt = Math.abs(Date.parse(k.starts_at) - t);
      if (k.start_date !== it.start_date) return false;
      if (norm(k.title) === norm(it.title)) return true;
      if (dt <= 5 * 60000 && norm(k.venue) === norm(it.venue)) return true;
      return dt <= 60 * 60000 && jaccard(tokens(k.title), tk) >= 0.6;
    });
    if (dup) dropped.push({ id: it.source_id, title: it.title, date: it.start_date, reason: `duplicado de ${dup.source_id} (${dup.title})` });
    else kept.push(it);
  }
  items = kept;

  // 2) Coordenadas: las ya verificadas en Nexo, las de otro evento en el mismo
  // sitio o geocodificando la dirección (completa, simplificada o el local).
  const final = [];
  const venueCoords = new Map();
  for (const it of items) if (known[it.source_id]) venueCoords.set(norm(it.venue), known[it.source_id]);
  for (const it of items) {
    let coords = known[it.source_id] || null;
    let source = coords ? "geocoded" : null;
    if (!coords && venueCoords.has(norm(it.venue))) { coords = venueCoords.get(norm(it.venue)); source = "geocoded"; }
    if (!coords && it.address && !/^madrid$/i.test(it.address)) {
      for (const q of addressVariants(it)) {
        coords = await geocode(q, it.hint_lat, cache);
        if (coords) break;
      }
      source = coords ? "geocoded" : null;
      fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));
    }
    if (coords) venueCoords.set(norm(it.venue), coords);
    if (!coords) { dropped.push({ id: it.source_id, title: it.title, date: it.start_date, reason: "dirección sin localizar" }); continue; }
    const { hint_lat, group, ...rest } = it;
    final.push({ ...rest, latitude: coords[0], longitude: coords[1], location_source: source });
  }
  final.sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  const series = {};
  for (const it of final) if (it.series_key) series[it.series_key] = (series[it.series_key] || 0) + 1;
  fs.writeFileSync(path.join(outDir, "items.json"), JSON.stringify(final, null, 1));
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({
    csv_rows: rows.length,
    imported: final.length,
    dropped,
    series_with_several_dates: Object.entries(series).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]),
    by_category: final.reduce((acc, it) => ((acc[`${it.category}:${it.subcategory}`] = (acc[`${it.category}:${it.subcategory}`] || 0) + 1), acc), {}),
  }, null, 1));
  console.log(`CSV: ${rows.length} · importables: ${final.length} · descartados: ${dropped.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
