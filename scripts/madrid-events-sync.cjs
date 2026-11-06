#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const { fetchMadridPayload } = require("./madrid-events-fetch.cjs");
const { normalizeMadridSnapshot } = require("./madrid-events-preview.cjs");

async function main() {
  const file = process.argv.find((arg) => arg.startsWith("--file="))?.slice(7);
  const payload = file
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : await fetchMadridPayload();
  const snapshot = normalizeMadridSnapshot(payload);
  if (snapshot.rejected || !snapshot.events.length)
    throw new Error(
      `Snapshot rejected: ${snapshot.rejected} invalid records, ${snapshot.events.length} candidates. No writes.`,
    );
  console.log(
    JSON.stringify({
      raw: snapshot.rawCount,
      candidates: snapshot.events.length,
      mode: process.argv.includes("--apply") ? "apply" : "dry-run",
    }),
  );
  if (!process.argv.includes("--apply")) return;
  // Explicit opt-in in addition to the server's provider license/format gates.
  if (process.env.MADRID_EVENTS_IMPORT_ENABLED !== "true")
    throw new Error("Import disabled pending provider review");
  const endpoint = new URL(process.env.NEXO_EVENTS_SUPABASE_URL || "");
  if (endpoint.hostname === "nixeproyzxvqzyrvsxcx.supabase.co")
    throw new Error("Production writes are forbidden by this pilot");
  if (
    endpoint.protocol !== "https:" &&
    !(
      ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) &&
      endpoint.protocol === "http:"
    )
  )
    throw new Error("HTTPS required for remote Supabase");
  const key = process.env.NEXO_EVENTS_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing service credential");
  const response = await fetch(
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
      `Atomic import failed: HTTP ${response.status}. Check local/staging server logs.`,
    );
  console.log(`Imported ${await response.json()} events atomically`);
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { main };
