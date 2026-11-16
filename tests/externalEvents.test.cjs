const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const path = require("node:path");
const {
  normalizeMadridSnapshot,
} = require("../scripts/madrid-events-preview.cjs");
const now = new Date("2026-11-06T12:00:00Z");
const row = (extra = {}) => ({
  id: 1,
  title: "Taller de lectura",
  dtstart: "2026-11-07 00:00:00.0",
  dtend: "2026-11-08 23:59:00.0",
  link: "https://www.madrid.es/evento",
  ...extra,
});
test("retains ongoing date ranges and preserves unknown time, price and images", () => {
  const s = normalizeMadridSnapshot(
    { "@graph": [row({ dtstart: "2026-11-01 00:00:00.0" })] },
    now,
  );
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0].starts_at, null);
  assert.equal(s.events[0].price_text, null);
  assert.equal(s.events[0].category, "DESCUBRIR");
  assert.equal("image_url" in s.events[0], false);
});
test("validates real calendar dates, coordinates, unsafe URLs and conflicting duplicates", () => {
  assert.equal(
    normalizeMadridSnapshot(
      [row({ dtstart: "2026-02-30", dtend: "2026-12-31" })],
      now,
    ).rejected,
    1,
  );
  assert.equal(
    normalizeMadridSnapshot(
      [row({ link: "https://user:secret@example.org/" })],
      now,
    ).rejected,
    1,
  );
  assert.equal(
    normalizeMadridSnapshot(
      [row({ location: { latitude: 0, longitude: 0 } })],
      now,
    ).events[0].latitude,
    0,
  );
  assert.equal(
    normalizeMadridSnapshot(
      [row({ location: { latitude: 100, longitude: "oops" } })],
      now,
    ).events[0].latitude,
    null,
  );
  assert.throws(
    () => normalizeMadridSnapshot([row(), row({ title: "Conflicting" })], now),
    /Conflicting duplicate/,
  );
});
test("keeps explicit cancellations for existing social groups and deduplicates exact repeats", () => {
  const s = normalizeMadridSnapshot(
    [row({ status: "cancelado" }), row({ status: "cancelado" })],
    now,
  );
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0].status, "cancelled");
});
// Load the real affinity code too. Assets and gender helpers have no bearing on
// this scoring test and are isolated from the native runtime.
const loaded = new Map();
function load(file) {
  const filename = path.resolve(file);
  if (loaded.has(filename)) return loaded.get(filename);
  const exports = {};
  loaded.set(filename, exports);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: (id) => {
      if (id.endsWith("categories"))
        return {
          normalizeMainCategory: (v) =>
            [
              "DEPORTES",
              "VIBES",
              "AIRE_LIBRE",
              "FOODIES",
              "DESCUBRIR",
              "SHOWTIME",
            ].includes(v)
              ? v
              : null,
        };
      if (id.endsWith("soloChicas")) return { isSoloChicasPlan: () => false };
      if (id.endsWith(".cjs")) return require(path.resolve(path.dirname(filename), id));
      if (id.startsWith("."))
        return load(path.resolve(path.dirname(filename), id + ".ts"));
      return require(id);
    },
  });
  return exports;
}
const { externalEventScore, rankExternalEvents, interleaveSocialRows } = load(
  "features/events/ranking.ts",
);
const { emptyFeedTaste, buildFeedTaste } = load("lib/feedAffinity.ts");
const event = (id, category = "DEPORTES", extra = {}) => ({
  id,
  category,
  status: "active",
  start_date: "2026-11-07",
  latitude: 40.4,
  longitude: -3.7,
  ...extra,
});
const history = () => ({ categories: {}, seen: new Set() });
test("declared taste, participation history, proximity, date and interactions affect recommendations", () => {
  const taste = buildFeedTaste(["Deportista"], [{ categoria: "DEPORTES" }]);
  const h = history();
  h.categories.DEPORTES = 3;
  const score = (e) =>
    externalEventScore(
      e,
      taste,
      h,
      { latitude: 40.4, longitude: -3.7 },
      now.getTime(),
    );
  assert.ok(score(event("a")) > score(event("b", "SHOWTIME")));
  assert.ok(
    score(event("a")) > score(event("b", "DEPORTES", { latitude: 41.4 })),
  );
  assert.ok(
    score(event("a")) >
      score(event("b", "DEPORTES", { start_date: "2026-12-25" })),
  );
  const unobserved = score(event("a"));
  h.seen.add("a");
  assert.ok(unobserved > score(event("a")));
});
test("diversifies categories deterministically and excludes cancellations and duplicates", () => {
  const input = [
    event("1"),
    event("2"),
    event("3", "SHOWTIME"),
    event("4", "DEPORTES", { status: "cancelled" }),
    event("1"),
  ];
  const ranked = rankExternalEvents(
    input,
    emptyFeedTaste(),
    history(),
    null,
    now.getTime(),
  );
  assert.deepEqual(
    Array.from(ranked, (e) => e.id),
    ["1", "3", "2"],
  );
});
test("preserves social order and reserves three quarters of a populated feed for user plans", () => {
  const social = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    kind: "plan",
  }));
  const events = Array.from({ length: 30 }, (_, i) => event(`e${i}`));
  const mixed = interleaveSocialRows(social, events, (r) => r.kind === "plan");
  assert.equal(mixed[0].id, "p0");
  assert.equal(mixed.filter((r) => r.kind === "event").length, 4);
  assert.deepEqual(
    Array.from(
      mixed.filter((r) => r.kind === "plan"),
      (r) => r.id,
    ),
    social.map((r) => r.id),
  );
  assert.equal(interleaveSocialRows([], events, () => false).length, 30);
});

test("uses Madrid calendar day for explicit UTC offsets across midnight and summer time", () => {
  const summer = normalizeMadridSnapshot(
    [row({ dtstart: "2026-07-02T23:30:00Z", dtend: "2026-07-03T23:00:00Z" })],
    new Date("2026-07-01T00:00:00Z"),
  );
  assert.equal(summer.events[0].start_date, "2026-07-03");
  assert.equal(summer.events[0].end_date, "2026-07-04");
  assert.equal(summer.events[0].starts_at, "2026-07-02T23:30:00.000Z");
  assert.equal(
    normalizeMadridSnapshot(
      [row({ location: { latitude: " ", longitude: "" } })],
      now,
    ).events[0].latitude,
    null,
  );
});

test("external cards are never inserted inside the viewer-owned plans section", () => {
  const social = [
    { kind: "header", section: "protected" },
    { kind: "plan", id: "mine" },
    { kind: "header", section: "open" },
    { kind: "plan", id: "other" },
  ];
  const mixed = interleaveSocialRows(
    social,
    [event("external")],
    (r) => r.kind === "plan",
    (r) => r.section || null,
  );
  assert.equal(mixed[1].id, "mine");
  assert.equal(mixed[2].section, "open");
  assert.equal(mixed[3].id, "other");
  assert.equal(mixed[4].kind, "event");
});
