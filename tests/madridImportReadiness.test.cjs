const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  normalizeMadridSnapshot,
} = require("../scripts/madrid-events-preview.cjs");
const {
  fetchMadridDocument,
  MAX_BYTES,
} = require("../scripts/madrid-events-fetch.cjs");
const {
  main,
  buildReviewReport,
} = require("../scripts/madrid-events-sync.cjs");
const now = new Date("2026-11-06T12:00:00Z");
const row = (extra = {}) => ({
  id: 1,
  title: "Taller de lectura",
  dtstart: "2026-11-07 00:00:00.0",
  dtend: "2026-11-08 23:59:00.0",
  link: "https://www.madrid.es/evento",
  ...extra,
});

function response(bytes, type = "application/json") {
  return {
    ok: true,
    headers: { get: (name) => (name === "content-type" ? type : null) },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

test("invalid identity and geography types never become plausible source IDs or zero coordinates", () => {
  for (const id of [true, false, {}, [], Infinity])
    assert.equal(normalizeMadridSnapshot([row({ id })], now).rejected, 1);
  for (const coordinate of [false, true, [], [0], {}]) {
    const event = normalizeMadridSnapshot(
      [row({ location: { latitude: coordinate, longitude: coordinate } })],
      now,
    ).events[0];
    assert.equal(event.latitude, null);
    assert.equal(event.longitude, null);
  }
  const valid = normalizeMadridSnapshot(
    [row({ location: { latitude: "0", longitude: "-3.70" } })],
    now,
  ).events[0];
  assert.equal(valid.latitude, 0);
  assert.equal(valid.longitude, -3.7);
});

test("rejects malformed local time instead of silently importing it as an all-day event", () => {
  for (const dtstart of [
    "2026-11-07 invalid",
    "2026-11-07T25:00:00",
    "2026-11-07T18:99:00",
  ]) {
    assert.equal(normalizeMadridSnapshot([row({ dtstart })], now).rejected, 1);
  }
  assert.equal(
    normalizeMadridSnapshot([row({ dtstart: "2026-11-07 18:00:00.000" })], now)
      .events[0].starts_at,
    null,
  );
});

test("normalizes whitespace in explicit cancellation status", () => {
  assert.equal(
    normalizeMadridSnapshot([row({ status: " CANCELADO " })], now).events[0]
      .status,
    "cancelled",
  );
});

test("captures the exact downloaded bytes and rejects a non-JSON response", async () => {
  const bytes = Buffer.from(JSON.stringify({ "@graph": [row()] }));
  const document = await fetchMadridDocument(
    async () => response(bytes, "application/ld+json; charset=utf-8"),
    now,
  );
  assert.equal(document.evidence.kind, "official-download");
  assert.equal(document.evidence.fetchedAt, now.toISOString());
  assert.equal(
    document.evidence.sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.equal(document.evidence.bytes, bytes.length);
  await assert.rejects(
    fetchMadridDocument(async () =>
      response(Buffer.from("<html>Error</html>"), "text/html"),
    ),
    /not JSON/,
  );
});

test("enforces streamed size limit when a server omits content-length", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(MAX_BYTES + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    fetchMadridDocument(async () => ({
      ok: true,
      headers: { get: () => null },
      body,
    })),
    /size limit/,
  );
  assert.equal(cancelled, true);
});

test("review report distinguishes local input and never grants source or license approval", () => {
  const snapshot = normalizeMadridSnapshot(
    [row(), row(), row({ id: 2, dtstart: "2025-11-06", dtend: "2025-11-07" })],
    now,
  );
  const report = buildReviewReport(
    snapshot,
    { kind: "local-file", sha256: "synthetic" },
    now,
  );
  assert.equal(report.input.kind, "local-file");
  assert.equal(report.licenseVerified, false);
  assert.equal(report.currentSourceContractVerified, false);
  assert.equal(report.counts.duplicates, 1);
  assert.equal(report.counts.expired, 1);
  assert.equal(report.counts.accepted, 1);
  assert.equal(report.counts.unknownTime, 1);
  assert.equal(report.counts.unknownCoordinates, 1);
  assert.ok(report.requiredReview.length > 0);
});

test("CLI dry run creates review evidence and refuses overwrite without any backend credentials", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexo-import-review-"));
  try {
    const fixture = path.join(dir, "fixture.json"),
      reportFile = path.join(dir, "report.json");
    fs.writeFileSync(
      fixture,
      JSON.stringify({
        "@graph": [row({ dtstart: "2099-11-07", dtend: "2099-11-08" })],
      }),
    );
    const args = [`--file=${fixture}`, `--report=${reportFile}`];
    const output = [];
    const noNetwork = () => {
      throw new Error("Unexpected network request");
    };
    await main({
      args,
      now,
      env: { MADRID_EVENTS_IMPORT_ENABLED: "false" },
      fetchImpl: noNetwork,
      log: (value) => output.push(value),
    });
    assert.match(output[0], /dry-run/);
    assert.equal(
      JSON.parse(fs.readFileSync(reportFile, "utf8")).input.kind,
      "local-file",
    );
    await assert.rejects(
      main({ args, now, fetchImpl: noNetwork, log: () => {} }),
      /EEXIST/,
    );
    await assert.rejects(
      main({
        args: [args[0], "--apply"],
        now,
        fetchImpl: noNetwork,
        log: () => {},
        env: {
          MADRID_EVENTS_IMPORT_ENABLED: "true",
          NEXO_EVENTS_SUPABASE_URL: "https://nixeproyzxvqzyrvsxcx.supabase.co",
          NEXO_EVENTS_SERVICE_ROLE_KEY: "synthetic-unused",
        },
      }),
      /Production writes are forbidden/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
