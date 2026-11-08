#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { buildSyncFunction } = require("./build-sync-function.cjs");
const { fetchMadridDocument } = require("../madrid-events-fetch.cjs");
const { normalizeMadridSnapshot } = require("../madrid-events-preview.cjs");
const { prepareSocialSnapshot } = require("./social-snapshot.cjs");
const coreSchema = require("./production-core-schema.json");

const PROJECT = "nixeproyzxvqzyrvsxcx";
const root = path.resolve(__dirname, "../..");
const migrationNames = [
  "20261106170000_external_social_events.sql",
  "20261106190000_restore_reviewed_api_boundaries.sql",
  "20261107120000_event_subcategories.sql",
  "20261107160000_madrid_scheduler_and_server_maintenance.sql",
  "20261108120000_confirmed_social_feed.sql",
];
const literal = (value) => "'" + String(value).replace(/'/g, "''") + "'";

function reviewPrerequisites(metadata) {
  if (
    !metadata ||
    !(Number(metadata.serverVersion) >= coreSchema.minimumServerVersion)
  )
    throw new Error(
      "Remote prerequisite schema needs review: PostgreSQL 17 or newer required",
    );
  const columns = new Set(
    metadata.columns?.map((c) => `${c.table}.${c.column}:${c.type}`),
  );
  const functions = new Set(
    metadata.functions?.map((f) => `${f.name}(${f.args})`),
  );
  const missing = [
    ...coreSchema.columns.filter((c) => !columns.has(c)),
    ...coreSchema.functions.filter((f) => !functions.has(f)),
  ];
  if (missing.length)
    throw new Error(
      `Remote prerequisite schema needs review: ${missing.join(", ")}`,
    );
}

function migrationQuery(name, sql) {
  // Record each version in the same transaction as its schema change.
  if (!/^begin;/i.test(sql.trim()) || !/commit;$/i.test(sql.trim()))
    throw new Error(`Migration must have one outer transaction: ${name}`);
  const version = name.split("_")[0];
  return sql.trim().replace(
    /commit;$/i,
    () => `insert into supabase_migrations.schema_migrations(version,name,statements)
    values (${literal(version)},${literal(name.slice(15, -4))},array[${literal(sql)}]);\ncommit;`,
  );
}

async function deployProduction({
  args = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const apply = args.includes("--apply");
  if (!args.includes(`--project-ref=${PROJECT}`))
    throw new Error(
      `Select the NEXO target explicitly with --project-ref=${PROJECT}`,
    );
  if (!env.SUPABASE_ACCESS_TOKEN)
    throw new Error(
      "Configure SUPABASE_ACCESS_TOKEN in secure environment settings",
    );
  const api = async (route, body) => {
    const response = await fetchImpl(
      `https://api.supabase.com/v1/projects/${PROJECT}${route}`,
      {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        signal: AbortSignal.timeout(120000),
        headers: {
          authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
          ...(body instanceof FormData
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(body === undefined
          ? {}
          : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      },
    );
    // Error responses can include SQL/credentials: deliberately never print them.
    if (!response.ok) {
      // This fixed scheduler migration contains no secret values. Its error
      // can identify extension/cron restrictions without logging activation SQL.
      let detail = "";
      if (
        body?.query?.includes(
          "create or replace function public.request_madrid_event_sync()",
        )
      ) {
        const failure = await response.json().catch(() => null);
        detail =
          typeof failure?.message === "string"
            ? `: ${failure.message.split("\n")[0]}`
            : "";
      }
      throw new Error(
        `Supabase ${route} failed: HTTP ${response.status}${detail}`,
      );
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  const query = (sql) => api("/database/query", { query: sql });
  const history = await query(
    "select version from supabase_migrations.schema_migrations order by version",
  );
  if (!Array.isArray(history))
    throw new Error("Invalid remote migration history");
  const applied = new Set(history.map((row) => row.version));
  const allMigrations = fs
    .readdirSync(path.join(root, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"));
  const prerequisites = allMigrations.filter(
    (name) => name < migrationNames[0],
  );
  const missing = prerequisites.filter(
    (name) => !applied.has(name.split("_")[0]),
  );
  // The production project has manually applied SQL under different timestamps.
  // Check the reviewed physical schema instead of replaying historical SQL or
  // pretending that the repository versions were applied there.
  const schema = await query(`select jsonb_build_object(
    'serverVersion',current_setting('server_version_num')::integer,
    'columns',(select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',udt_name)) from information_schema.columns where table_schema='public'),
    'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_identity_arguments(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f')
  ) as metadata`);
  reviewPrerequisites(schema?.[0]?.metadata);
  const pending = migrationNames.filter(
    (name) => !applied.has(name.split("_")[0]),
  );
  const document = await fetchMadridDocument(fetchImpl);
  const rawSnapshot = normalizeMadridSnapshot(document.payload);
  if (rawSnapshot.rejected || !rawSnapshot.events.length)
    throw new Error("Official snapshot failed validation; no deployment");
  const snapshot = await prepareSocialSnapshot(rawSnapshot);
  if (!snapshot.events.length) throw new Error("No confirmed social occurrences; no deployment");
  log(
    JSON.stringify({
      target: PROJECT,
      mode: apply ? "apply" : "plan",
      pending,
      source: document.evidence,
      raw: snapshot.rawCount,
      candidates: snapshot.events.length,
      historicalVersionsWithDifferentTimestamps: missing.length,
    }),
  );
  if (!apply)
    return { pending, candidates: snapshot.events.length, applied: false };

  // Deploy the function first: a bundling/authentication failure cannot enable data.
  const destination = path.join(
    root,
    "supabase/functions/sync-madrid-events/index.ts",
  );
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, buildSyncFunction());
  const form = new FormData();
  form.append(
    "metadata",
    JSON.stringify({
      name: "sync-madrid-events",
      entrypoint_path: "index.ts",
      verify_jwt: true,
    }),
  );
  form.append(
    "file",
    new Blob([fs.readFileSync(destination)], {
      type: "application/typescript",
    }),
    "index.ts",
  );
  const deployment = await api(
    "/functions/deploy?slug=sync-madrid-events",
    form,
  );
  if (deployment?.status !== "ACTIVE" || deployment.verify_jwt !== true)
    throw new Error(
      "Edge function deployment failed; provider was not enabled",
    );
  // Reuse a scheduler secret on redeploy so a later failure cannot break the
  // already configured daily job by rotating just one side of its credentials.
  const keys = await api("/api-keys");
  const anonKey = keys.find((key) => {
    try {
      const payload = JSON.parse(
        Buffer.from(key.api_key.split(".")[1], "base64url").toString(),
      );
      return (
        payload.role === "anon" &&
        payload.ref === PROJECT &&
        payload.exp * 1000 > Date.now()
      );
    } catch {
      return false;
    }
  })?.api_key;
  if (!anonKey)
    throw new Error(
      "A valid public anon JWT is required for gateway verification",
    );
  const previous = await query(
    "select decrypted_secret from vault.decrypted_secrets where name='nexo_madrid_sync_secret' limit 1",
  );
  const secret =
    previous?.[0]?.decrypted_secret || randomBytes(32).toString("hex");
  await api("/secrets", [
    { name: "NEXO_MADRID_SYNC_SECRET", value: secret },
    { name: "MADRID_EVENTS_IMPORT_ENABLED", value: "true" },
    { name: "MADRID_EVENTS_PRODUCTION_ENABLED", value: "true" },
    { name: "NEXO_EVENTS_TARGET_PROJECT_REF", value: PROJECT },
  ]);
  for (const name of pending) {
    await query(
      migrationQuery(
        name,
        fs.readFileSync(path.join(root, "supabase/migrations", name), "utf8"),
      ),
    );
    log(`Applied ${name}`);
  }
  const functionUrl = `https://${PROJECT}.supabase.co/functions/v1/sync-madrid-events`;
  const vault = (name, value) => `do $vault$ declare secret_id uuid; begin
    select id into secret_id from vault.secrets where name=${literal(name)};
    if secret_id is null then perform vault.create_secret(${literal(value)},${literal(name)});
    else perform vault.update_secret(secret_id,${literal(value)}); end if; end $vault$;`;
  // Activation, first full import and Vault configuration succeed or roll back together.
  await query(`begin;
    ${vault("nexo_madrid_sync_url", functionUrl)}
    ${vault("nexo_madrid_sync_secret", secret)}
    ${vault("nexo_madrid_anon_key", anonKey)}
    update public.event_providers set enabled=true,
      license_url='https://creativecommons.org/licenses/by/4.0/',
      license_verified_at=now(), format_verified_at=now() where id='madrid';
    select public.sync_external_events('madrid',${literal(JSON.stringify(snapshot.events))}::jsonb,${snapshot.rawCount});
    commit;`);
  const status = await query(`select p.enabled, p.last_success_at,
    (select count(*) from public.external_events where provider_id='madrid' and status='active') as active,
    (select count(*) from cron.job where jobname='nexo-madrid-events-daily' and active) as scheduled
    from public.event_providers p where p.id='madrid'`);
  if (
    !status?.[0]?.enabled ||
    !status[0].last_success_at ||
    Number(status[0].scheduled) !== 1
  )
    throw new Error(
      "Activation completed but post-deployment verification failed; inspect provider status",
    );
  // This exercises the deployed Edge function and its auth, source and RPC path.
  const smoke = await fetchImpl(functionUrl, {
    method: "POST",
    redirect: "error",
    headers: {
      "x-nexo-madrid-secret": secret,
      authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    signal: AbortSignal.timeout(90000),
  });
  const result = smoke.ok ? await smoke.json() : null;
  if (!result?.ok || !Number.isInteger(result.imported))
    throw new Error(
      "Initial data activated; deployed daily sync failed its smoke check",
    );
  log(JSON.stringify({ deployed: true, ...status[0], dailySync: result }));
  return { applied: true, status };
}
if (require.main === module)
  deployProduction().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = {
  deployProduction,
  migrationQuery,
  reviewPrerequisites,
  PROJECT,
};
