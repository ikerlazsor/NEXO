"use strict";
const {
  identityTitle,
  hasConfirmedLocation,
} = require("../../lib/externalEventPolicy.cjs");
const venueKey = (event) =>
  identityTitle(`${event.venue || ""} ${event.address || ""} Madrid`);
function selectVenue(event, results) {
  const wanted = identityTitle(event.venue)
    .split(" ")
    .filter((w) => w.length > 2);
  const candidates = results.filter((result) => {
    const lat = Number(result.lat),
      lon = Number(result.lon);
    if (
      !hasConfirmedLocation({
        venue: event.venue,
        latitude: lat,
        longitude: lon,
      })
    )
      return false;
    const name = identityTitle(
      result.namedetails?.name || result.name || result.display_name || "",
    );
    const nameMatch =
      wanted.length > 0 &&
      wanted.filter((word) => name.split(" ").includes(word)).length /
        wanted.length >=
        0.8;
    const city = identityTitle(
      result.address?.city ||
        result.address?.town ||
        result.address?.municipality ||
        "",
    );
    const address = identityTitle(event.address || "");
    const addressMatch =
      address.length > 8 &&
      identityTitle(result.display_name || "").includes(address);
    return city === "madrid" && (nameMatch || addressMatch);
  });
  // Never choose between ambiguous bars/venues with the same name.
  if (candidates.length !== 1) return null;
  return {
    latitude: Number(candidates[0].lat),
    longitude: Number(candidates[0].lon),
    location_source: "openstreetmap",
  };
}
function createVenueResolver({
  fetchImpl = fetch,
  cache = new Map(),
  save = async () => {},
  maxRequests = 15,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  // Also space the first request from the preceding import's final lookup.
  let requests = 0,
    lastAt = Date.now();
  const deadline = Date.now() + 10000;
  return async (event) => {
    if (!event.venue) return null;
    const key = venueKey(event);
    if (cache.has(key)) return cache.get(key);
    if (requests >= maxRequests || Date.now() >= deadline - 1000) return null;
    requests++;
    await wait(Math.max(0, 1100 - (Date.now() - lastAt)));
    lastAt = Date.now();
    const url = new URL("https://nominatim.openstreetmap.org/search");
    for (const [name, value] of Object.entries({
      q: `${event.venue}, ${event.address || ""}, Madrid, España`,
      format: "jsonv2",
      addressdetails: "1",
      namedetails: "1",
      limit: "5",
      countrycodes: "es",
      viewbox: "-4.7,41.3,-2.6,39.7",
      bounded: "1",
    }))
      url.searchParams.set(name, value);
    try {
      const response = await fetchImpl(url.toString(), {
        headers: {
          "User-Agent": "NexoEvents/1.0 (+https://github.com/ikerlazsor/NEXO)",
          accept: "application/json",
        },
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(4000, deadline - Date.now())),
        ),
        redirect: "error",
      });
      if (!response.ok) return null;
      const result = selectVenue(event, await response.json());
      cache.set(key, result);
      await save(key, result);
      return result;
    } catch {
      return null;
    }
  };
}
module.exports = { venueKey, selectVenue, createVenueResolver };
