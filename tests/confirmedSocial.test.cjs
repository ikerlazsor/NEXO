const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { createLoader } = require("./helpers/loadTs.cjs");
const policy = require("../lib/externalEventPolicy.cjs");
const {
  prepareSocialSnapshot,
} = require("../scripts/events/social-snapshot.cjs");
const {
  selectVenue,
  createVenueResolver,
} = require("../scripts/events/geocode.cjs");
const {
  ticketmasterSnapshot,
  fetchTicketmaster,
  icsSnapshot,
} = require("../scripts/events/providers.cjs");
const {
  normalizeMadridSnapshot,
} = require("../scripts/madrid-events-preview.cjs");
const now = new Date("2026-11-08T12:00:00Z");
const event = (extra = {}) => ({
  id: "e",
  title: "Concierto de jazz",
  description: null,
  provider_id: "madrid",
  source_id: "1",
  source_url: "https://www.madrid.es/event",
  status: "active",
  category: "SHOWTIME",
  subcategory: "concierto",
  start_date: "2026-11-12",
  end_date: "2026-11-12",
  starts_at: "2026-11-12T18:00:00Z",
  venue: "Sala Madrid",
  latitude: 40.4168,
  longitude: -3.7038,
  ...extra,
});

test("Madrid clocks resolve explicit winter/summer hours and reject DST gaps and repeated clocks", () => {
  assert.equal(
    policy.madridInstant("2026-11-12", "19:00"),
    "2026-11-12T18:00:00.000Z",
  );
  assert.equal(
    policy.madridInstant("2027-07-12", "19:00"),
    "2027-07-12T17:00:00.000Z",
  );
  assert.equal(policy.madridInstant("2027-03-28", "02:30"), null);
  assert.equal(policy.madridInstant("2026-10-25", "02:30"), null);
  assert.equal(
    policy.confirmedStart("2026-10-25T02:30:00+02:00", "2026-10-25", null),
    "2026-10-25T00:30:00.000Z",
  );
  assert.equal(
    policy.confirmedStart("2026-11-12 00:00:00.0", "2026-11-12", "19:00"),
    "2026-11-12T18:00:00.000Z",
  );
  assert.equal(
    policy.confirmedStart("2026-11-12 00:00:00.0", "2026-12-31", "19:00"),
    null,
  );
});
test("three calendar months clamp month ends and incomplete, past, distant or non-social records stay out", () => {
  assert.equal(
    policy.horizon(new Date("2027-01-31T12:00:00Z")).toISOString(),
    "2027-04-30T12:00:00.000Z",
  );
  assert.ok(policy.isPublishableEvent(event(), +now));
  for (const change of [
    { starts_at: null },
    { starts_at: "2026-11-08T11:59:59Z" },
    { starts_at: "2027-02-08T12:00:01Z" },
    { venue: null },
    { latitude: null },
    { longitude: 2.17 },
    { title: "Exposición permanente" },
    { title: "Taller infantil de baile" },
  ])
    assert.equal(
      policy.isPublishableEvent(event(change), +now),
      false,
      JSON.stringify(change),
    );
});
test("curation retains explicit cancellations without inventing recurring sessions or locations", async () => {
  const raw = normalizeMadridSnapshot(
    {
      "@graph": [
        {
          id: 1,
          title: "Concierto",
          dtstart: "2026-11-12 00:00:00.0",
          dtend: "2026-11-12 23:59:00.0",
          time: "19:00",
          link: "https://www.madrid.es/event",
          "event-location": "Sala Madrid",
          location: { latitude: 40.4, longitude: -3.7 },
        },
        {
          id: 2,
          title: "Concierto",
          dtstart: "2026-11-10",
          dtend: "2026-12-31",
          time: "19:00",
          link: "https://www.madrid.es/range",
        },
        {
          id: 3,
          title: "Concierto cancelado",
          dtstart: "2026-11-12",
          link: "https://www.madrid.es/cancel",
          status: "cancelado",
        },
      ],
    },
    now,
  );
  const ready = await prepareSocialSnapshot(raw, { now });
  assert.equal(ready.events.length, 2);
  assert.equal(ready.events[0].social_eligible, true);
  assert.equal(
    ready.events.find((e) => e.source_id === "1").starts_at,
    "2026-11-12T18:00:00.000Z",
  );
  assert.equal(ready.excluded.dateOrTime, 1);
  assert.ok(ready.events.some((e) => e.status === "cancelled"));
});
test("venue lookup requires one corroborated Madrid match and reuses positive/negative cache entries", async () => {
  assert.equal(policy.hasConfirmedLocation(event({ venue: "Madrid" })), false);
  assert.equal(
    policy.hasConfirmedLocation(event({ venue: "Por confirmar" })),
    false,
  );
  const place = {
    lat: "40.41",
    lon: "-3.7",
    namedetails: { name: "Bar los Manolos" },
    address: { city: "Madrid" },
    display_name: "Bar los Manolos, Madrid",
  };
  const source = event({
    venue: "Bar los Manolos",
    latitude: null,
    longitude: null,
  });
  assert.equal(selectVenue(source, [place, { ...place, lat: "40.42" }]), null);
  assert.equal(
    selectVenue(source, [{ ...place, address: { city: "Barcelona" } }]),
    null,
  );
  assert.equal(
    selectVenue(source, [{ ...place, namedetails: { name: "Otro bar" } }]),
    null,
  );
  let calls = 0;
  const waits = [];
  const locate = createVenueResolver({
    fetchImpl: async () => {
      calls++;
      return Response.json([place]);
    },
    wait: async (ms) => waits.push(ms),
  });
  assert.equal((await locate(source)).latitude, 40.41);
  await locate(source);
  assert.equal(calls, 1);
  await locate({ ...source, venue: "Bar distinto" });
  assert.equal(calls, 2);
  assert.ok(waits[0] >= 1000);
  assert.ok(waits[1] >= 1000);
});
test("Ticketmaster with time TBD is withheld; complete paging is mandatory", async () => {
  const item = {
    id: "tm-1",
    name: "Concierto Jazz",
    url: "https://www.ticketmaster.es/event/1",
    dates: {
      start: { dateTime: "2026-11-12T18:00:00Z", localDate: "2026-11-12" },
      status: { code: "onsale" },
    },
    classifications: [{ segment: { name: "Music" } }],
    _embedded: {
      venues: [
        {
          name: "Sala Madrid",
          location: { latitude: "40.41", longitude: "-3.7" },
        },
      ],
    },
  };
  const raw = ticketmasterSnapshot([
    item,
    {
      ...item,
      id: "tm-2",
      dates: { start: { ...item.dates.start, timeTBA: true } },
    },
  ]);
  const ready = await prepareSocialSnapshot(raw, { now });
  assert.equal(ready.events.length, 1);
  assert.equal(ready.events[0].source_id, "tm-1");
  await assert.rejects(
    fetchTicketmaster({
      key: "synthetic",
      now,
      fetchImpl: async () => Response.json({ page: { totalPages: 6 } }),
    }),
    /Complete.*paging/,
  );
});
test("authorised organizer calendar imports known instants, skips recurrence rules and withholds floating timezone", async () => {
  const ics =
    "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:one\r\nSUMMARY:Concierto\r\nDTSTART;TZID=Europe/Madrid:20261112T190000\r\nLOCATION:Sala Madrid\r\nGEO:40.41;-3.7\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:two\r\nSUMMARY:Concierto\r\nDTSTART:20261112T190000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:recurring\r\nRRULE:FREQ=WEEKLY\r\nDTSTART:20261112T190000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";
  const raw = icsSnapshot(ics, "https://organizer.example/calendar.ics");
  assert.equal(raw.skippedRecurring, 1);
  const ready = await prepareSocialSnapshot(raw, { now });
  assert.equal(ready.events.length, 1);
  assert.equal(ready.events[0].starts_at, "2026-11-12T18:00:00.000Z");
});
test("unified ranking favours personal taste, gives Nexo a modest advantage and never reshuffles on pagination", () => {
  const load = createLoader(),
    { buildFeedTaste } = load("lib/feedAffinity.ts");
  const { rankUnifiedFeed, retainFeedOrder } = load(
    "features/events/ranking.ts",
  );
  const ctx = {
    taste: buildFeedTaste(["Deportista"], []),
    friendIds: new Set(),
    coincidedIds: new Set(),
    coords: { latitude: 40.4168, longitude: -3.7038 },
    currentUserId: "viewer",
    now: +now,
  };
  const plans = [
    {
      id: "nexo-food",
      kind: "plan",
      plan: {
        id: "nexo-food",
        categoria: "FOODIES",
        latitud: 40.4168,
        longitud: -3.7038,
        fecha_evento: "2026-11-12T18:00:00Z",
      },
    },
    {
      id: "nexo-sport",
      kind: "plan",
      plan: {
        id: "nexo-sport",
        categoria: "DEPORTES",
        latitud: 40.4168,
        longitud: -3.7038,
        fecha_evento: "2026-11-12T18:00:00Z",
      },
    },
  ];
  const rows = rankUnifiedFeed(
    plans,
    [
      event({
        id: "sport",
        title: "Running social",
        category: "DEPORTES",
        subcategory: "running",
      }),
    ],
    ctx,
  );
  assert.equal(rows[0].id, "nexo-sport");
  assert.equal(rows[1].id, "event:sport");
  assert.equal(rows[2].id, "nexo-food");
  const historyRanked = rankUnifiedFeed(plans, [], {
    ...ctx,
    taste: buildFeedTaste([], []),
    eventHistory: { categories: { FOODIES: 3 }, seen: new Set() },
  });
  assert.equal(
    historyRanked[0].id,
    "nexo-food",
    "event interactions inform the same ranking for Nexo plans",
  );
  assert.deepEqual(
    Array.from(retainFeedOrder(["nexo-food", "nexo-sport"], rows), (r) => r.id),
    ["nexo-food", "nexo-sport", "event:sport"],
  );
});

test("postponed and tentative activities remain unavailable even when a provider retains an old clock", async () => {
  const ticket = ticketmasterSnapshot([
    {
      id: "postponed",
      name: "Concierto social",
      url: "https://www.ticketmaster.es/synthetic",
      dates: {
        status: { code: "postponed" },
        start: { dateTime: "2026-11-12T18:00:00Z", localDate: "2026-11-12" },
      },
      classifications: [{ segment: { name: "Music" } }],
      _embedded: {
        venues: [
          {
            name: "Sala Madrid",
            location: { latitude: 40.42, longitude: -3.7 },
          },
        ],
      },
    },
  ]);
  assert.equal(ticket.events[0].starts_at, null);
  assert.equal(ticket.events[0].status, "stale");
  const calendar = icsSnapshot(
    "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:tentative\r\nSUMMARY:Concierto social\r\nSTATUS:TENTATIVE\r\nDTSTART:20261112T180000Z\r\nLOCATION:Sala Madrid\r\nGEO:40.42;-3.7\r\nEND:VEVENT\r\nEND:VCALENDAR",
    "https://organizer.example/calendar.ics",
  );
  const ready = await prepareSocialSnapshot(
    { ...ticket, events: [...ticket.events, ...calendar.events] },
    { now },
  );
  assert.equal(
    ready.events.length,
    2,
    "withheld statuses reach the existing source alias immediately",
  );
  assert.ok(
    ready.events.every((event) => !policy.isPublishableEvent(event, +now)),
  );
});
