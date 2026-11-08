"use strict";
const { createHash, timingSafeEqual } = require("node:crypto");
const { main } = require("../madrid-events-sync.cjs");
const json = (value, status) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

/** No request body controls the source, target, credentials or activation. */
function createMadridSyncHandler({ env, fetchImpl = fetch, run = main }) {
  return async function handle(request) {
    if (request.method !== "POST")
      return json({ error: "method_not_allowed" }, 405);
    const secret = env.NEXO_MADRID_SYNC_SECRET;
    if (!secret || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
      return json({ error: "missing_configuration" }, 503);
    const digest = (value) => createHash("sha256").update(value).digest();
    if (
      !timingSafeEqual(
        digest(secret),
        digest(request.headers.get("x-nexo-madrid-secret") || ""),
      )
    )
      return json({ error: "unauthorized" }, 401);
    if (env.MADRID_EVENTS_IMPORT_ENABLED !== "true")
      return json({ error: "import_disabled" }, 503);
    try {
      const payload = await request.json().catch(() => ({}));
      const provider = payload.provider || "madrid";
      if (!["madrid", "ticketmaster"].includes(provider))
        return json({ error: "invalid_provider" }, 400);
      const result = await run({
        args: ["--apply", `--provider=${provider}`],
        fetchImpl,
        env: {
          MADRID_EVENTS_IMPORT_ENABLED: "true",
          MADRID_EVENTS_PRODUCTION_ENABLED:
            env.MADRID_EVENTS_PRODUCTION_ENABLED,
          NEXO_EVENTS_TARGET_PROJECT_REF: env.NEXO_EVENTS_TARGET_PROJECT_REF,
          NEXO_EVENTS_SUPABASE_URL: env.SUPABASE_URL,
          NEXO_EVENTS_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
          TICKETMASTER_API_KEY: env.TICKETMASTER_API_KEY,
        },
        log: () => {},
      });
      return json({ ok: true, ...result }, 200);
    } catch {
      // Never expose credentials, upstream bodies or SQL to a caller.
      return json({ error: "madrid_sync_failed" }, 502);
    }
  };
}
module.exports = { createMadridSyncHandler };
