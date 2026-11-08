"use strict";
const {
  classifyExternalEvent,
} = require("../../lib/externalEventClassification.cjs");
const {
  calendarDay,
  horizon,
  madridInstant,
} = require("../../lib/externalEventPolicy.cjs");
const MAX_BYTES = 8 * 1024 * 1024;
function publisherUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname;
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      (parsed.port && parsed.port !== "443") ||
      /^(localhost|0\.|127\.|169\.254\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(
        host,
      ) ||
      /\.(local|localhost|internal)$/i.test(host)
    )
      return null;
    return parsed.href;
  } catch {
    return null;
  }
}
async function readDocument(
  url,
  fetchImpl = fetch,
  accept = "application/json",
) {
  if (!publisherUrl(url)) throw new Error("Invalid publisher origin");
  const response = await fetchImpl(url, {
    redirect: "error",
    headers: { accept },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Publisher HTTP ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (accept === "application/json" && !/json/i.test(type))
    throw new Error("Publisher response is not JSON");
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Publisher body exceeds size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}
function ticketmasterSnapshot(rows) {
  const events = [];
  let rejected = 0;
  for (const row of rows) {
    const start = row.dates?.start,
      venue = row._embedded?.venues?.[0];
    if (!row.id || !row.name || !publisherUrl(row.url)) {
      rejected++;
      continue;
    }
    const confirmed =
      start?.dateTime &&
      row.dates?.status?.code !== "postponed" &&
      !start.dateTBA &&
      !start.dateTBD &&
      !start.timeTBA &&
      Number.isFinite(Date.parse(start.dateTime));
    const segment = row.classifications?.[0]?.segment?.name || "";
    const theme = row.classifications?.[0]?.genre?.name || "";
    const context = /music/i.test(segment)
      ? "Concierto"
      : /sport/i.test(segment)
        ? "Deportes"
        : /arts|theatre/i.test(segment)
          ? "Teatro"
          : segment;
    const startAt = confirmed ? new Date(start.dateTime).toISOString() : null;
    const day = startAt ? calendarDay(new Date(startAt)) : start?.localDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) {
      rejected++;
      continue;
    }
    const location = venue?.location;
    const latitude = Number(location?.latitude),
      longitude = Number(location?.longitude);
    const price = row.priceRanges?.[0];
    events.push({
      source_id: String(row.id),
      source_url: row.url,
      title: row.name.slice(0, 300),
      // Only factual classification/prices, not copied marketing descriptions/photos.
      description: `${context}${theme ? ` · ${theme}` : ""}`,
      ...classifyExternalEvent(`${context} ${row.name}`),
      start_date: day,
      end_date: day,
      starts_at: startAt,
      schedule: null,
      venue: venue?.name || null,
      address:
        [venue?.address?.line1, venue?.city?.name].filter(Boolean).join(", ") ||
        null,
      latitude:
        location?.latitude != null && Number.isFinite(latitude)
          ? latitude
          : null,
      longitude:
        location?.longitude != null && Number.isFinite(longitude)
          ? longitude
          : null,
      social_eligible: /music|sport|arts.*theatre|film/i.test(segment),
      price_text:
        price &&
        Number.isFinite(price.min) &&
        /^[A-Z]{3}$/.test(price.currency || "")
          ? `${price.min}${Number.isFinite(price.max) && price.max > price.min ? `–${price.max}` : ""} ${price.currency}`
          : null,
      status:
        row.dates?.status?.code === "cancelled"
          ? "cancelled"
          : row.dates?.status?.code === "postponed"
            ? "stale"
            : "active",
    });
  }
  return { events, rawCount: rows.length, rejected, expired: 0, duplicates: 0 };
}
async function fetchTicketmaster({ key, now = new Date(), fetchImpl = fetch }) {
  if (!key) throw new Error("Ticketmaster credential missing");
  const rows = [];
  let pages = 1;
  for (let page = 0; page < pages; page++) {
    const url = new URL(
      "https://app.ticketmaster.com/discovery/v2/events.json",
    );
    for (const [name, value] of Object.entries({
      apikey: key,
      city: "Madrid",
      countryCode: "ES",
      startDateTime: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
      endDateTime: horizon(now)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z"),
      size: "200",
      page: String(page),
      sort: "date,asc",
    }))
      url.searchParams.set(name, value);
    const data = JSON.parse(await readDocument(url.toString(), fetchImpl));
    if (!data.page || !Number.isInteger(data.page.totalPages))
      throw new Error("Unverified Ticketmaster response format");
    pages = data.page.totalPages;
    if (pages > 5)
      throw new Error(
        "Complete Ticketmaster snapshot exceeds paging limit; no partial import",
      );
    rows.push(...(data._embedded?.events || []));
  }
  return ticketmasterSnapshot(rows);
}
function icsSnapshot(document, sourceUrl) {
  if (!document.includes("BEGIN:VCALENDAR"))
    throw new Error("Publisher feed is not iCalendar");
  const unfolded = document.replace(/\r?\n[ \t]/g, "");
  const events = [];
  let rejected = 0,
    skippedRecurring = 0;
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const values = {};
    for (const line of block.split(/\r?\n/)) {
      const match = /^([A-Z-]+)(;[^:]*)?:(.*)$/.exec(line);
      if (match)
        values[match[1]] = { value: match[3], parameters: match[2] || "" };
    }
    if (values.RRULE || values.RDATE) {
      skippedRecurring++;
      continue;
    }
    const raw = values.DTSTART?.value,
      timezone = values.DTSTART?.parameters || "";
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(?:\d{2})?(Z)?$/.exec(
      raw || "",
    );
    const day = match ? `${match[1]}-${match[2]}-${match[3]}` : null;
    const start = match
      ? match[6]
        ? new Date(`${day}T${match[4]}:${match[5]}:00Z`).toISOString()
        : /TZID=Europe\/Madrid/.test(timezone)
          ? madridInstant(day, `${match[4]}:${match[5]}`)
          : null
      : null;
    const title = values.SUMMARY?.value
      ?.replace(/\\n/g, " ")
      .replace(/\\([,;\\])/g, "$1");
    if (!values.UID?.value || !title || !day) {
      rejected++;
      continue;
    }
    const geo = (values.GEO?.value || "").split(";").map(Number);
    const madridDay = start ? calendarDay(new Date(start)) : day;
    events.push({
      source_id: `${values.UID.value}${values["RECURRENCE-ID"] ? `:${values["RECURRENCE-ID"].value}` : ""}`,
      source_url: publisherUrl(values.URL?.value) || sourceUrl,
      title: title.slice(0, 300),
      description: null,
      ...classifyExternalEvent(title),
      start_date: madridDay,
      end_date: madridDay,
      starts_at: start,
      schedule: null,
      venue: values.LOCATION?.value?.replace(/\\([,;\\])/g, "$1") || null,
      address: null,
      latitude: geo.length === 2 && Number.isFinite(geo[0]) ? geo[0] : null,
      longitude: geo.length === 2 && Number.isFinite(geo[1]) ? geo[1] : null,
      price_text: null,
      status:
        values.STATUS?.value === "CANCELLED"
          ? "cancelled"
          : values.STATUS?.value === "TENTATIVE"
            ? "stale"
            : "active",
    });
  }
  return {
    events,
    rawCount: unfolded.split("BEGIN:VEVENT").length - 1,
    rejected,
    expired: 0,
    duplicates: 0,
    skippedRecurring,
  };
}
module.exports = {
  readDocument,
  ticketmasterSnapshot,
  fetchTicketmaster,
  icsSnapshot,
};
