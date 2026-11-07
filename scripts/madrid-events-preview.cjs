#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const DATASET_URL =
  "https://datos.madrid.es/dataset/206974-0-agenda-eventos-culturales-100";
function text(value, max = 300) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
function field(row, keys) {
  for (const key of keys)
    if (row[key] !== null && row[key] !== undefined && row[key] !== "")
      return row[key];
  return null;
}
function httpsLink(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || (url.port && url.port !== "443"))
      return null;
    if (
      url.protocol === "http:" &&
      (url.hostname === "madrid.es" || url.hostname.endsWith(".madrid.es"))
    )
      url.protocol = "https:";
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
function readRows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["@graph", "records", "data"])
    if (Array.isArray(payload?.[key])) return payload[key];
  throw new Error(
    "Formato desconocido: se esperaba una lista o un objeto con @graph/data/records.",
  );
}
function dateOnly(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/u.exec(value.trim());
  if (!match) return null;
  // A malformed clock must not silently turn into a plausible all-day event.
  const suffix = value.trim().slice(10);
  if (
    suffix &&
    !/^[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?$/i.test(
      suffix,
    )
  )
    return null;
  const date = new Date(`${match[1]}T12:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === match[1]
    ? match[1]
    : null;
}
function madridCalendarDate(value) {
  const day = dateOnly(value);
  if (!day) return null;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return day;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Madrid",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date)
    : null;
}
function classifyMadridEvent(title, type) {
  const value = `${type || ""} ${title}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/deport|running|yoga|futbol|baloncesto|padel/.test(value))
    return "DEPORTES";
  if (/senderismo|paseo|ruta|naturaleza|jardin/.test(value))
    return "AIRE_LIBRE";
  if (/gastronom|cocina|degustacion/.test(value)) return "FOODIES";
  if (/cine|teatro|concierto|musica|danza|espectaculo/.test(value))
    return "SHOWTIME";
  if (/juegos|baile|fiesta/.test(value)) return "VIBES";
  return "DESCUBRIR";
}
function normalizeMadridSnapshot(payload, now = new Date()) {
  const rows = readRows(payload);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const events = new Map();
  let rejected = 0,
    expired = 0,
    duplicates = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      rejected++;
      continue;
    }
    const startRaw = field(row, [
      "dtstart",
      "DTSTART",
      "fecha-inicio",
      "fecha_inicio",
    ]);
    const start = madridCalendarDate(startRaw);
    const endRaw = field(row, ["dtend", "DTEND", "fecha-fin", "fecha_fin"]);
    const end = endRaw == null ? start : madridCalendarDate(endRaw);
    if (end && end < today) {
      expired++;
      continue;
    }
    const rawId = field(row, ["id", "@id", "ID-EVENTO", "id-evento"]);
    const id =
      typeof rawId === "string" ||
      (typeof rawId === "number" && Number.isFinite(rawId))
        ? String(rawId).trim()
        : "";
    const title = text(field(row, ["title", "TITLE", "titulo", "TITULO"]), 300);
    const sourceUrl = httpsLink(
      field(row, ["link", "LINK", "CONTENT-URL", "content-url", "url"]),
    );
    if (
      !start ||
      !end ||
      end < start ||
      !id ||
      id.length > 500 ||
      !title ||
      !sourceUrl
    ) {
      rejected++;
      continue;
    }
    const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(startRaw));
    const exact = hasOffset ? new Date(startRaw) : null;
    if (exact && !Number.isFinite(exact.getTime())) {
      rejected++;
      continue;
    }
    const loc = field(row, [
      "event-location",
      "EVENT-LOCATION",
      "location",
      "LOCALIZACION",
    ]);
    const venue =
      typeof loc === "string"
        ? text(loc, 300)
        : text(loc?.["location-name"] || loc?.name, 300);
    const geo = row.location || row.geo || {};
    const coordinate = (v, max) =>
      (typeof v === "number" ||
        (typeof v === "string" &&
          /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v.trim()))) &&
      Number.isFinite(Number(v)) &&
      Math.abs(Number(v)) <= max
        ? Number(v)
        : null;
    const statusValue = String(
      field(row, ["status", "estado", "event-status"]) || "",
    )
      .trim()
      .toLowerCase();
    const event = {
      source_id: id,
      source_url: sourceUrl,
      title,
      description:
        text(field(row, ["description", "DESCRIPTION", "descripcion"]), 4000) ||
        null,
      category: classifyMadridEvent(
        title,
        field(row, ["@type", "type", "categoria"]),
      ),
      start_date: start,
      end_date: end,
      starts_at: exact?.toISOString() || null,
      schedule: text(field(row, ["time", "TIME", "horario"]), 500) || null,
      venue: venue || null,
      latitude: coordinate(geo.latitude ?? row.latitude, 90),
      longitude: coordinate(geo.longitude ?? row.longitude, 180),
      price_text: text(field(row, ["price", "PRICE", "precio"]), 500) || null,
      status:
        /^(cancelled|canceled|cancelado|cancelada|suspendido|suspendida)$/.test(
          statusValue,
        )
          ? "cancelled"
          : "active",
    };
    if (
      events.has(id) &&
      JSON.stringify(events.get(id)) !== JSON.stringify(event)
    )
      throw new Error(`Conflicting duplicate source ID: ${id}`);
    if (events.has(id)) duplicates++;
    events.set(id, event);
  }
  return {
    rawCount: rows.length,
    rejected,
    expired,
    duplicates,
    events: [...events.values()].sort(
      (a, b) =>
        a.start_date.localeCompare(b.start_date) ||
        a.source_id.localeCompare(b.source_id),
    ),
  };
}
// Backwards-compatible read-only preview; joining belongs to Nexo, never to the provider.
function normalizeMadridEvents(payload, now = new Date()) {
  return normalizeMadridSnapshot(payload, now).events.map((e) => ({
    ...e,
    source: "Ayuntamiento de Madrid",
    sourceDataset: DATASET_URL,
    sourceId: e.source_id,
    sourceUrl: e.source_url,
    eventDate: e.start_date,
    startsAt: e.starts_at,
    timeUnverified: !e.starts_at,
    registrationMode: "external",
    inAppJoinEnabled: false,
    organizerVerifiedByNexo: false,
  }));
}
if (require.main === module) {
  try {
    const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const result = normalizeMadridSnapshot(payload);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = {
  normalizeMadridEvents,
  normalizeMadridSnapshot,
  readRows,
  httpsLink,
  dateOnly,
  classifyMadridEvent,
  DATASET_URL,
};
