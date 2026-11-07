const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  createMadridSyncHandler,
} = require("../scripts/events/madrid-sync-handler.cjs");
const {
  buildSyncFunction,
} = require("../scripts/events/build-sync-function.cjs");
const {
  deployProduction,
  migrationQuery,
  PROJECT,
} = require("../scripts/events/deploy-production.cjs");
const { DATA_URL } = require("../scripts/madrid-events-fetch.cjs");
const coreSchema = require("../scripts/events/production-core-schema.json");
const coreMetadata = {
  serverVersion: 170000,
  columns: coreSchema.columns.map((value) => {
    const [pair, type] = value.split(":");
    const [table, column] = pair.split(".");
    return { table, column, type };
  }),
  functions: coreSchema.functions.map((value) => ({
    name: value.slice(0, value.indexOf("(")),
    args: value.slice(value.indexOf("(") + 1, -1),
  })),
};

const env = {
  SUPABASE_URL: `https://${PROJECT}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
  NEXO_MADRID_SYNC_SECRET: "synthetic-scheduler",
  MADRID_EVENTS_IMPORT_ENABLED: "true",
  MADRID_EVENTS_PRODUCTION_ENABLED: "true",
  NEXO_EVENTS_TARGET_PROJECT_REF: PROJECT,
};
const source = {
  "@graph": [
    {
      id: 1,
      title: "Taller de lectura",
      dtstart: "2099-11-07",
      dtend: "2099-11-09",
      time: "18:00",
      "excluded-days": "8/11/2099;",
      link: "https://www.madrid.es/evento",
    },
  ],
};
const request = (secret = env.NEXO_MADRID_SYNC_SECRET) =>
  new Request("https://example.test", {
    method: "POST",
    headers: { "x-nexo-madrid-secret": secret },
  });

test("scheduler rejects unauthenticated, disabled and unconfigured requests before any network call", async () => {
  const noNetwork = () => {
    throw new Error("Unexpected network");
  };
  const handler = createMadridSyncHandler({ env, fetchImpl: noNetwork });
  assert.equal((await handler(request("wrong"))).status, 401);
  assert.equal(
    (await handler(new Request("https://example.test"))).status,
    405,
  );
  assert.equal(
    (
      await createMadridSyncHandler({ env: {}, fetchImpl: noNetwork })(
        request(),
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await createMadridSyncHandler({
        env: { ...env, MADRID_EVENTS_IMPORT_ENABLED: "false" },
        fetchImpl: noNetwork,
      })(request())
    ).status,
    503,
  );
});

test("generated Edge bundle imports the exact shared classifier, normalizer and guarded production RPC", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexo-edge-test-"));
  const entry = path.join(dir, "edge.mjs");
  fs.writeFileSync(entry, buildSyncFunction());
  const bundled = await import(pathToFileURL(entry).href);
  fs.rmSync(dir, { recursive: true, force: true });
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    if (url === DATA_URL) return Response.json(source);
    assert.equal(
      String(url),
      `${env.SUPABASE_URL}/rest/v1/rpc/sync_external_events`,
    );
    assert.equal(options.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
    const body = JSON.parse(options.body);
    assert.equal(body.p_items[0].subcategory, "estudio");
    assert.equal(body.p_items[0].starts_at, null);
    assert.equal(
      body.p_items[0].schedule,
      "18:00 · Días excluidos: 8/11/2099;",
    );
    return Response.json(1);
  };
  const handler = bundled.createMadridSyncHandler({ env, fetchImpl });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, imported: 1, raw: 1 });
  assert.equal(calls.length, 2);
  const guarded = bundled.createMadridSyncHandler({
    env: { ...env, MADRID_EVENTS_PRODUCTION_ENABLED: "false" },
    fetchImpl,
  });
  assert.equal((await guarded(request())).status, 502);
  assert.equal(
    calls.length,
    3,
    "no production RPC without the explicit production target/opt-in",
  );
});

test("upstream import errors never leak credentials or raw upstream error bodies", async () => {
  const handler = createMadridSyncHandler({
    env,
    run: async () => {
      throw new Error(env.SUPABASE_SERVICE_ROLE_KEY);
    },
  });
  assert.deepEqual(await (await handler(request())).json(), {
    error: "madrid_sync_failed",
  });
});

test("deployment requires the exact project and credentials before contacting a server", async () => {
  const options = {
    env: {},
    fetchImpl: () => {
      throw new Error("Unexpected network");
    },
  };
  await assert.rejects(
    deployProduction({ ...options, args: ["--apply"] }),
    /Select the NEXO target/,
  );
  await assert.rejects(
    deployProduction({ ...options, args: [`--project-ref=${PROJECT}`] }),
    /SUPABASE_ACCESS_TOKEN/,
  );
});

test("production plan reads history and source but never deploys, activates or changes secrets", async () => {
  const calls = [];
  const result = await deployProduction({
    args: [`--project-ref=${PROJECT}`],
    env: { SUPABASE_ACCESS_TOKEN: "synthetic" },
    exec: () => {
      throw new Error("Unexpected deployment");
    },
    log: () => {},
    fetchImpl: async (url, options) => {
      calls.push(url);
      if (url === DATA_URL) return Response.json(source);
      assert.match(url, /\/database\/query$/);
      if (!JSON.parse(options.body).query.startsWith("select version"))
        return Response.json([{ metadata: coreMetadata }]);
      return Response.json(
        fs
          .readdirSync("supabase/migrations")
          .filter((name) => name < "20261106170000")
          .map((name) => ({ version: name.split("_")[0] })),
      );
    },
  });
  assert.equal(result.applied, false);
  assert.equal(result.pending.length, 4);
  assert.equal(calls.length, 3);
});

test("migration history is recorded inside the migration transaction and incomplete prerequisites block writes", async () => {
  const sql = migrationQuery(
    "20261107160000_example.sql",
    "begin;\nselect 'example';\ncommit;",
  );
  assert.match(sql, /insert into supabase_migrations/);
  assert.ok(sql.lastIndexOf("insert into") < sql.lastIndexOf("commit;"));
  assert.throws(
    () => migrationQuery("x.sql", "select 1;"),
    /outer transaction/,
  );
  const dollarSql =
    "begin;\ncreate function sample() returns text language sql as $$ select 'eyJ%$'; $$;\ncommit;";
  assert.ok(
    migrationQuery("20261107160000_example.sql", dollarSql).includes(
      "array['" + dollarSql.replace(/'/g, "''") + "']",
    ),
    "dollar quotes and regex anchors must survive history serialization exactly",
  );
  await assert.rejects(
    deployProduction({
      args: [`--project-ref=${PROJECT}`, "--apply"],
      env: { SUPABASE_ACCESS_TOKEN: "synthetic" },
      fetchImpl: async () => Response.json([]),
      log: () => {},
      exec: () => {
        throw new Error("Unexpected deployment");
      },
    }),
    /prerequisite schema/,
  );
});

test("production apply deploys only the reviewed feature migrations before atomic activation and daily-sync smoke", async () => {
  const sql = [],
    output = [];
  let functionDeployed = false,
    secretsSet = false;
  const result = await deployProduction({
    args: [`--project-ref=${PROJECT}`, "--apply"],
    env: { SUPABASE_ACCESS_TOKEN: "synthetic" },
    log: (value) => output.push(value),
    fetchImpl: async (url, options) => {
      if (url === DATA_URL) return Response.json(source);
      if (url.includes("/functions/deploy?")) {
        assert.ok(options.body instanceof FormData);
        assert.equal(JSON.parse(options.body.get("metadata")).verify_jwt, true);
        assert.match(
          await options.body.get("file").text(),
          /createMadridSyncHandler/,
        );
        functionDeployed = true;
        return Response.json({ status: "ACTIVE", verify_jwt: true });
      }
      if (url.endsWith("/secrets")) {
        assert.ok(functionDeployed);
        secretsSet = true;
        return new Response(null, { status: 201 });
      }
      if (url.endsWith("/api-keys"))
        return Response.json([
          {
            api_key: `eyJ.${Buffer.from(JSON.stringify({ role: "anon", ref: PROJECT, exp: 4102444800 })).toString("base64url")}.synthetic`,
          },
        ]);
      if (url.includes("/functions/v1/")) {
        assert.ok(secretsSet);
        return Response.json({ ok: true, imported: 1, raw: 1 });
      }
      const query = JSON.parse(options.body).query;
      if (query.startsWith("select version")) return Response.json([]);
      if (query.startsWith("select jsonb_build_object"))
        return Response.json([{ metadata: coreMetadata }]);
      if (query.startsWith("select decrypted_secret"))
        return Response.json([
          { decrypted_secret: "existing-synthetic-scheduler" },
        ]);
      assert.ok(functionDeployed);
      if (query.startsWith("select p.enabled"))
        return Response.json([
          {
            enabled: true,
            last_success_at: "2099-11-07",
            active: 1,
            scheduled: 1,
          },
        ]);
      sql.push(query);
      return Response.json([]);
    },
  });
  assert.equal(result.applied, true);
  assert.equal(
    sql.length,
    5,
    "four feature migrations and one activation transaction",
  );
  assert.match(sql[4], /^begin;/);
  assert.match(sql[4], /sync_external_events/);
  assert.match(sql[4], /existing-synthetic-scheduler/);
  assert.match(sql[4], /commit;$/);
  assert.ok(
    output.every((value) => !value.includes("existing-synthetic-scheduler")),
  );
});

test("a failed Edge deployment cannot activate or migrate the database", async () => {
  await assert.rejects(
    deployProduction({
      args: [`--project-ref=${PROJECT}`, "--apply"],
      env: { SUPABASE_ACCESS_TOKEN: "synthetic" },
      log: () => {},
      fetchImpl: async (url, options) => {
        if (url === DATA_URL) return Response.json(source);
        if (url.includes("/functions/deploy?"))
          return Response.json({ status: "ACTIVE", verify_jwt: false });
        const query = JSON.parse(options.body).query;
        assert.match(
          query,
          /^select /,
          "no writes before a successful Edge deployment",
        );
        return Response.json(
          query.startsWith("select version")
            ? []
            : [{ metadata: coreMetadata }],
        );
      },
    }),
    /Edge function deployment failed/,
  );
});
