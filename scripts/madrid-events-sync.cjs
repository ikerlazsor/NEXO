#!/usr/bin/env node
"use strict";
const { createHash } = require("node:crypto");
const { fetchMadridDocument, MAX_BYTES } = require("./madrid-events-fetch.cjs");
const { normalizeMadridSnapshot } = require("./madrid-events-preview.cjs");

// Evidence helps a human review the exact input; it never approves provider rights.
function buildReviewReport(snapshot, evidence, now = new Date()) {
  const categories = {},
    statuses = {};
  for (const event of snapshot.events) {
    categories[event.category] = (categories[event.category] || 0) + 1;
    statuses[event.status] = (statuses[event.status] || 0) + 1;
  }
  return {
    generatedAt: now.toISOString(),
    input: evidence,
    licenseVerified: false,
    currentSourceContractVerified: false,
    counts: {
      raw: snapshot.rawCount,
      accepted: snapshot.events.length,
      rejected: snapshot.rejected,
      expired: snapshot.expired,
      duplicates: snapshot.duplicates,
      unknownTime: snapshot.events.filter((e) => !e.starts_at).length,
      unknownVenue: snapshot.events.filter((e) => !e.venue).length,
      unknownCoordinates: snapshot.events.filter(
        (e) => e.latitude == null || e.longitude == null,
      ).length,
    },
    categories,
    statuses,
    sample: snapshot.events.slice(0, 10),
    requiredReview: [
      "Verify the publisher's current reuse terms and attribution, separately from image rights.",
      "Compare current official field names, dates, cancellations and recurring sessions with these normalized samples.",
      "Validate a complete import in local/staging before enabling the provider. A local file is not proof of an official download.",
    ],
  };
}

async function main({
  args = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  log = console.log,
} = {}) {
  const { prepareSocialSnapshot } = require("./events/social-snapshot.cjs");
  const {
    fetchTicketmaster,
    icsSnapshot,
    readDocument,
  } = require("./events/providers.cjs");
  const { createVenueResolver, venueKey } = require("./events/geocode.cjs");
  const {
    hasConfirmedLocation,
    isPublishableEvent,
    isSocialActivity,
  } = require("../lib/externalEventPolicy.cjs");
  const apply = args.includes("--apply");
  const kind =
    args.find((arg) => arg.startsWith("--provider="))?.slice(11) || "madrid";
  if (!["madrid", "ticketmaster", "ical"].includes(kind))
    throw new Error("Unknown event provider");
  const provider = kind === "ical" ? env.NEXO_ICAL_PROVIDER_ID : kind;
  const file = args.find((arg) => arg.startsWith("--file="))?.slice(7);
  const reportFile = args.find((arg) => arg.startsWith("--report="))?.slice(9);
  const fs = file || reportFile ? require("node:fs") : null;
  let endpoint, key, lease;
  if (apply) {
    if (env.MADRID_EVENTS_IMPORT_ENABLED !== "true")
      throw new Error("Import disabled pending provider review");
    endpoint = new URL(env.NEXO_EVENTS_SUPABASE_URL || "");
    if (
      endpoint.hostname === "nixeproyzxvqzyrvsxcx.supabase.co" &&
      (env.MADRID_EVENTS_PRODUCTION_ENABLED !== "true" ||
        env.NEXO_EVENTS_TARGET_PROJECT_REF !== "nixeproyzxvqzyrvsxcx")
    )
      throw new Error("Production writes are forbidden by this pilot");
    if (
      endpoint.protocol !== "https:" &&
      !(
        ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) &&
        endpoint.protocol === "http:"
      )
    )
      throw new Error("HTTPS required for remote Supabase");
    if (
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/"
    )
      throw new Error("Supabase URL must be a credential-free origin");
    key = env.NEXO_EVENTS_SERVICE_ROLE_KEY;
    if (!key) throw new Error("Missing service credential");
  }
  const rpc = async (name, body) => {
    const response = await fetchImpl(
      new URL(`/rest/v1/rpc/${name}`, endpoint),
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          "content-type": "application/json",
          apikey: key,
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok)
      throw new Error(`Event RPC ${name} failed: HTTP ${response.status}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  if (apply) {
    lease = await rpc("claim_event_import", {});
    if (!lease) throw new Error("import_already_running");
  }
  try {
    let rawSnapshot, evidence;
    if (kind === "ticketmaster") {
      rawSnapshot = await fetchTicketmaster({
        key: env.TICKETMASTER_API_KEY,
        now,
        fetchImpl,
      });
      evidence = {
        kind: "official-download",
        url: "https://app.ticketmaster.com/discovery/v2/events.json",
        fetchedAt: now.toISOString(),
      };
    } else if (kind === "ical") {
      if (
        env.NEXO_ICAL_REVIEWED !== "true" ||
        !provider ||
        !env.NEXO_ICAL_FEED_URL
      )
        throw new Error(
          "iCalendar source requires provider/URL and explicit reuse review",
        );
      const text = file
        ? fs.readFileSync(file, "utf8")
        : await readDocument(
            env.NEXO_ICAL_FEED_URL,
            fetchImpl,
            "text/calendar",
          );
      rawSnapshot = icsSnapshot(text, env.NEXO_ICAL_FEED_URL);
      evidence = {
        kind: file ? "local-file" : "official-download",
        url: env.NEXO_ICAL_FEED_URL,
      };
    } else {
      let document;
      if (file) {
        if (fs.statSync(file).size > MAX_BYTES)
          throw new Error("Local feed exceeds size limit");
        const bytes = fs.readFileSync(file);
        document = {
          payload: JSON.parse(bytes.toString("utf8")),
          evidence: {
            kind: "local-file",
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        };
      } else document = await fetchMadridDocument(fetchImpl, now);
      rawSnapshot = normalizeMadridSnapshot(document.payload, now);
      evidence = document.evidence;
    }
    if (rawSnapshot.rejected)
      throw new Error(
        `Snapshot rejected: ${rawSnapshot.rejected} invalid records. No writes.`,
      );
    const newCache = new Map();
    let locate;
    if (apply) {
      const unresolved = rawSnapshot.events.filter(
        (event) =>
          !hasConfirmedLocation(event) &&
          isPublishableEvent(
            {
              ...event,
              social_eligible:
                event.social_eligible === true ||
                isSocialActivity(event.title, event.description || ""),
              venue: event.venue || "pending",
              latitude: 40.42,
              longitude: -3.7,
            },
            now.getTime(),
          ),
      );
      const cached = {};
      const keys = [...new Set(unresolved.map(venueKey))];
      // The RPC caps batches at 200; do not accidentally omit the place cache
      // for eligible rows that occur late in a large publisher document.
      for (let index = 0; index < Math.max(1, keys.length); index += 200)
        Object.assign(
          cached,
          await rpc("get_event_geocodes", {
            p_keys: keys.slice(index, index + 200),
          }),
        );
      locate = createVenueResolver({
        fetchImpl,
        cache: new Map(Object.entries(cached || {})),
        save: async (cacheKey, result) => {
          newCache.set(cacheKey, result);
        },
      });
    }
    const snapshot = await prepareSocialSnapshot(rawSnapshot, { now, locate });
    if (reportFile)
      fs.writeFileSync(
        reportFile,
        JSON.stringify(
          {
            ...buildReviewReport(snapshot, evidence, now),
            excluded: snapshot.excluded,
          },
          null,
          2,
        ) + "\n",
        { flag: "wx" },
      );
    log(
      JSON.stringify({
        provider,
        raw: snapshot.rawCount,
        candidates: snapshot.events.length,
        excluded: snapshot.excluded,
        mode: apply ? "apply" : "dry-run",
      }),
    );
    if (!apply)
      return {
        imported: 0,
        raw: snapshot.rawCount,
        candidates: snapshot.events.length,
      };
    if (newCache.size)
      await rpc("cache_event_geocodes", {
        p_items: [...newCache].map(([cacheKey, result]) => ({
          key: cacheKey,
          result,
        })),
      });
    const imported = await rpc("sync_external_events", {
      p_provider: provider,
      p_items: snapshot.events,
      p_raw_count: snapshot.rawCount,
    });
    if (!Number.isInteger(imported) || imported !== snapshot.events.length)
      throw new Error("Import response count does not match the snapshot");
    log(`Imported ${imported} confirmed social events atomically`);
    return { imported, raw: snapshot.rawCount };
  } finally {
    if (lease)
      await rpc("release_event_import", { p_token: lease }).catch(() => {});
  }
}

if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { main, buildReviewReport };
