"use strict";
const { classifyExternalEvent } = require("../../lib/externalEventClassification.cjs");
const { calendarDay, confirmedStart } = require("../../lib/externalEventPolicy.cjs");
const { publisherUrl } = require("./providers.cjs");

function pageEventFacts(html, sourceUrl) {
  const host = new URL(sourceUrl).hostname;
  if (!["www.meetup.com", "www.eventbrite.es", "www.eventbrite.com"].includes(host)) return null;
  const script = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].find(match => /\bid=["']__NEXT_DATA__["']/i.test(match[1]));
  if (!script) return null;
  let data;
  try { data = JSON.parse(script[2]).props?.pageProps; } catch { return null; }
  if (host === "www.meetup.com") {
    const e = data?.event;
    if (!e || e.eventType === "ONLINE") return null;
    return { title: e.title, url: e.eventUrl, starts_at: e.dateTime, latitude: e.venue?.lat, longitude: e.venue?.lng };
  }
  const e = data?.context?.basicInfo;
  if (!e || e.isProtected || e.isOnline || !e.isListed || e.isSeries || e.isParentEvent) return null;
  return { title: e.name, url: e.url, starts_at: e.startDate?.utc, latitude: e.venue?.address?.latitude, longitude: e.venue?.address?.longitude };
}
const canonicalUrl = value => {
  const url = publisherUrl(value);
  if (!url) return null;
  const parsed = new URL(url); parsed.search = ""; parsed.hash = "";
  return parsed.href.replace(/\/$/, "");
};

/** Read public structured event facts from a reviewed organizer page. Never
 * infer an occurrence from prose, opening hours or a recurring landing page. */
function jsonLdSnapshot(html, sourceUrl) {
  if (!publisherUrl(sourceUrl)) throw new Error("Invalid publisher origin");
  const rows = [];
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const types = [value['@type']].flat();
    if (types.some(type => typeof type === 'string' && /(?:^|\/)\w*Event$/.test(type))) rows.push(value);
    else {
      if (value['@graph']) visit(value['@graph']);
      if (value.itemListElement) for (const item of value.itemListElement) visit(item.item || item);
      if (value.mainEntity) visit(value.mainEntity);
    }
  };
  for (const script of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    let document;
    try { document = JSON.parse(script[1]); } catch { throw new Error('Invalid publisher structured data; no partial snapshot'); }
    visit(document);
  }
  if (!rows.length) throw new Error('No structured event records; publisher format requires review');
  const pageFacts = pageEventFacts(html, sourceUrl);
  const occurrences = new Map();
  for (const row of rows) {
    const identity = row['@id'] || publisherUrl(row.url || sourceUrl);
    const dates = occurrences.get(identity) || new Set(); dates.add(row.startDate); occurrences.set(identity, dates);
  }
  const events = new Map();
  let rejected = 0, excluded = 0;
  for (const row of rows) {
    const title = typeof row.name === 'string' ? row.name.trim().slice(0, 300) : '';
    const url = publisherUrl(row.url || row['@id'] || sourceUrl);
    if (!title || !url) { rejected++; continue; }
    if (row.eventSchedule || /OnlineEventAttendanceMode$/.test(row.eventAttendanceMode || '')) { excluded++; continue; }
    // JSON-LD must provide the UTC offset; the server's timezone is no evidence.
    const start = typeof row.startDate === 'string' && /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(row.startDate)
      ? confirmedStart(row.startDate, null, null) : null;
    const status = /EventCancelled$/.test(row.eventStatus || '') ? 'cancelled' : /EventPostponed$|EventRescheduled$/.test(row.eventStatus || '') ? 'stale' : 'active';
    if (!start) { excluded++; continue; }
    const location = Array.isArray(row.location) ? (row.location.length === 1 ? row.location[0] : null) : row.location;
    const address = location && typeof location === 'object' ? location.address : null;
    const addressText = typeof address === 'string' ? address : address ? [address.streetAddress, address.postalCode, address.addressLocality].filter(v => typeof v === 'string').join(', ') : null;
    const samePageEvent = pageFacts && pageFacts.title === title && canonicalUrl(pageFacts.url) === canonicalUrl(url) && Date.parse(pageFacts.starts_at) === Date.parse(start);
    // Public venue facts only, matched to the exact JSON-LD event. Never import
    // external attendees, member profiles, tokens, marketing copy or photos.
    const point = location?.geo || (samePageEvent ? pageFacts : null);
    const latitude = point?.latitude != null && String(point.latitude).trim() !== '' ? Number(point.latitude) : null;
    const longitude = point?.longitude != null && String(point.longitude).trim() !== '' ? Number(point.longitude) : null;
    const day = calendarDay(new Date(start));
    // One canonical URL can list several separately dated sessions.
    const identity = row['@id'] || url;
    const sourceId = occurrences.get(identity)?.size > 1 ? `${identity}#${start}` : identity;
    events.set(sourceId, {
      source_id: sourceId, source_url: url, title,
      description: null, ...classifyExternalEvent(title),
      start_date: day, end_date: day, starts_at: start, schedule: null,
      venue: typeof location === 'string' ? location : typeof location?.name === 'string' ? location.name : addressText,
      address: addressText,
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      price_text: row.isAccessibleForFree === true ? 'Gratis' : null,
      status,
    });
  }
  return { events: [...events.values()], rawCount: rows.length, rejected, expired: 0, duplicates: rows.length - events.size - rejected - excluded, excludedStructured: excluded };
}
module.exports = { jsonLdSnapshot };
