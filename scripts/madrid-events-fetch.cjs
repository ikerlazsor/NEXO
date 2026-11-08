#!/usr/bin/env node
"use strict";

// Read-only fetch of the official Madrid municipal cultural events JSON.
// NEVER writes to Supabase. Run manually: node scripts/madrid-events-fetch.cjs
const { createHash } = require("node:crypto");
const { normalizeMadridEvents } = require("./madrid-events-preview.cjs");

const DATA_URL =
  "https://datos.madrid.es/dataset/206974-0-agenda-eventos-culturales-100/resource/206974-0-agenda-eventos-culturales-100-json/download/206974-0-agenda-eventos-culturales-100.json";
const MAX_BYTES = 8 * 1024 * 1024;

async function fetchMadridDocument(fetchImpl = fetch, now = new Date()) {
  const response = await fetchImpl(DATA_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Municipal feed HTTP ${response.status}`);
  const contentType = response.headers?.get("content-type");
  if (
    contentType &&
    !/^(?:application\/(?:[a-z0-9.+-]*\+)?json|text\/json)(?:;|$)/i.test(
      contentType.trim(),
    )
  )
    throw new Error("Municipal feed is not JSON");
  const declaredBytes = Number(response.headers?.get("content-length") ?? 0);
  if (declaredBytes > MAX_BYTES)
    throw new Error("Municipal feed exceeds size limit");
  // Protect against oversized responses even when content-length is absent or incorrect.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Municipal feed body unavailable");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Municipal feed exceeds size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const payload = JSON.parse(bytes.toString("utf8"));
  return {
    payload,
    evidence: {
      kind: "official-download",
      url: DATA_URL,
      fetchedAt: now.toISOString(),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

async function fetchMadridPayload(fetchImpl = fetch) {
  return (await fetchMadridDocument(fetchImpl)).payload;
}

async function fetchMadridCandidates(fetchImpl = fetch, now = new Date()) {
  return normalizeMadridEvents(await fetchMadridPayload(fetchImpl), now);
}

if (require.main === module) {
  fetchMadridCandidates()
    .then((events) => {
      process.stdout.write(
        JSON.stringify(
          {
            source: DATA_URL,
            fetchedAt: new Date().toISOString(),
            total: events.length,
            events,
          },
          null,
          2,
        ) + "\n",
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  fetchMadridDocument,
  fetchMadridPayload,
  fetchMadridCandidates,
  DATA_URL,
  MAX_BYTES,
};
