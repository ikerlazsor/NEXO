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
  const file = args.find((arg) => arg.startsWith("--file="))?.slice(7);
  const reportFile = args.find((arg) => arg.startsWith("--report="))?.slice(9);
  const fs = file || reportFile ? require("node:fs") : null;
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
  } else {
    document = await fetchMadridDocument(fetchImpl, now);
  }
  const snapshot = normalizeMadridSnapshot(document.payload, now);
  if (reportFile)
    fs.writeFileSync(
      reportFile,
      JSON.stringify(
        buildReviewReport(snapshot, document.evidence, now),
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
  if (snapshot.rejected || !snapshot.events.length)
    throw new Error(
      `Snapshot rejected: ${snapshot.rejected} invalid records, ${snapshot.events.length} candidates. No writes.`,
    );
  log(
    JSON.stringify({
      raw: snapshot.rawCount,
      candidates: snapshot.events.length,
      mode: args.includes("--apply") ? "apply" : "dry-run",
    }),
  );
  if (!args.includes("--apply")) return;
  // Explicit opt-in in addition to the server's provider license/format gates.
  if (env.MADRID_EVENTS_IMPORT_ENABLED !== "true")
    throw new Error("Import disabled pending provider review");
  const endpoint = new URL(env.NEXO_EVENTS_SUPABASE_URL || "");
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
  const key = env.NEXO_EVENTS_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing service credential");
  const response = await fetchImpl(
    new URL("/rest/v1/rpc/sync_external_events", endpoint),
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "content-type": "application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        p_provider: "madrid",
        p_items: snapshot.events,
        p_raw_count: snapshot.rawCount,
      }),
    },
  );
  if (!response.ok)
    throw new Error(
      `Atomic import failed: HTTP ${response.status}. Check server logs.`,
    );
  const imported = await response.json();
  if (!Number.isInteger(imported) || imported !== snapshot.events.length)
    throw new Error("Import response count does not match the snapshot");
  log(`Imported ${imported} events atomically`);
  return { imported, raw: snapshot.rawCount };
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { main, buildReviewReport };
