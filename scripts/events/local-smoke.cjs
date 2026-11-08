#!/usr/bin/env node
// Synthetic users + events only. CLI status is local; never use --linked/--remote.
const { execFileSync } = require("node:child_process");
const { createClient } = require("@supabase/supabase-js");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
(async () => {
  const status = JSON.parse(
    execFileSync("npx", ["--yes", "supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const url = status.API_URL || status.api_url;
  if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Local Supabase required");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(
    url,
    status.SERVICE_ROLE_KEY || status.service_role_key,
    options,
  );
  const anonKey = status.ANON_KEY || status.anon_key;
  const anonymous = createClient(url, anonKey, options);
  const users = [];
  let eventId;
  const run = randomUUID();
  const check = (response) => {
    if (response.error) throw response.error;
    return response.data;
  };
  const config = check(
    await admin.from("event_providers").select("*").eq("id", "madrid").single(),
  );
  try {
    check(
      await admin
        .from("event_providers")
        .update({
          enabled: true,
          license_verified_at: new Date().toISOString(),
          format_verified_at: new Date().toISOString(),
        })
        .eq("id", "madrid"),
    );
    eventId = check(
      await admin
        .from("external_events")
        .insert({
          provider_id: "madrid",
          source_id: `synthetic-smoke-${run}`,
          source_url: "https://www.madrid.es/synthetic",
          title: "SYNTHETIC local API test",
          category: "DESCUBRIR",
          starts_at: new Date(Date.now() + 86400000).toISOString(),
          venue: "Synthetic venue",
          latitude: 40.42,
          longitude: -3.7,
          social_eligible: true,
          location_verified: true,
          start_date: new Date(Date.now() + 86400000)
            .toISOString()
            .slice(0, 10),
          end_date: new Date(Date.now() + 2 * 86400000)
            .toISOString()
            .slice(0, 10),
        })
        .select("id")
        .single(),
    ).id;
    assert.ok(
      check(
        await anonymous.rpc("get_external_events_page_filtered", {
          p_subcategories: ["otro"],
        }),
      ).some((row) => row.id === eventId),
    );
    const clients = [];
    for (let i = 0; i < 2; i++) {
      const email = `event-smoke-${run}-${i}@nexo.test`,
        password = randomUUID() + "Aa1!";
      const user = check(
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { nombre: `Synthetic ${i}` },
        }),
      ).user;
      users.push(user.id);
      const client = createClient(url, anonKey, options);
      check(await client.auth.signInWithPassword({ email, password }));
      clients.push(client);
    }
    const [a, b] = clients;
    assert.ok(
      check(await anonymous.rpc("get_external_event", { p_event: eventId }))
        .length === 1,
    );
    assert.ok(
      (await anonymous.from("external_event_participants").select("*")).error,
    );
    assert.equal(
      check(
        await b
          .from("external_event_messages")
          .select("*")
          .eq("event_id", eventId),
      ).length,
      0,
    );
    check(
      await a.rpc("set_event_membership", { p_event: eventId, p_join: true }),
    );
    const client = randomUUID();
    const sent = check(
      await a.rpc("send_event_message", {
        p_event: eventId,
        p_client: client,
        p_body: "Hello from synthetic test",
      }),
    );
    assert.equal(
      check(
        await a.rpc("send_event_message", {
          p_event: eventId,
          p_client: client,
          p_body: "Hello from synthetic test",
        }),
      ),
      sent,
    );
    check(
      await b.rpc("set_event_membership", { p_event: eventId, p_join: true }),
    );
    const social = check(
      await a.rpc("get_event_social_summaries", { p_events: [eventId] }),
    )[eventId];
    assert.equal(social.count, 2);
    assert.equal(social.joined, true);
    assert.equal(social.people.length, 2);
    const upcomingMemberships = check(
      await a
        .from("external_event_participants")
        .select("event_id,external_events!inner(starts_at,status)")
        .eq("user_id", users[0])
        .eq("external_events.status", "active")
        .gt("external_events.starts_at", new Date().toISOString())
        .limit(100),
    );
    assert.ok(upcomingMemberships.some((row) => row.event_id === eventId));
    const guestSocial = check(
      await anonymous.rpc("get_event_social_summaries", {
        p_events: [eventId],
      }),
    )[eventId];
    assert.equal(guestSocial.count, 2);
    assert.equal(guestSocial.people.length, 0);
    assert.equal(
      check(
        await b
          .from("external_event_messages")
          .select("*")
          .eq("event_id", eventId),
      ).length,
      1,
    );
    check(
      await b.rpc("set_event_membership", { p_event: eventId, p_join: false }),
    );
    assert.equal(
      check(await a.rpc("get_event_social_summaries", { p_events: [eventId] }))[
        eventId
      ].count,
      1,
    );
    assert.equal(
      check(
        await b
          .from("external_event_messages")
          .select("*")
          .eq("event_id", eventId),
      ).length,
      0,
    );
    assert.ok(
      (
        await b.rpc("send_event_message", {
          p_event: eventId,
          p_client: randomUUID(),
          p_body: "Denied",
        })
      ).error,
    );
    console.log(
      "PASS: local HTTP API, synthetic auth, guest privacy, join, public avatar summaries, shared chat, retry deduplication and leave/revocation.",
    );
  } finally {
    for (const id of users) check(await admin.auth.admin.deleteUser(id));
    if (eventId)
      check(await admin.from("external_events").delete().eq("id", eventId));
    check(
      await admin
        .from("event_providers")
        .update({
          enabled: config.enabled,
          license_verified_at: config.license_verified_at,
          format_verified_at: config.format_verified_at,
        })
        .eq("id", "madrid"),
    );
  }
})().catch((e) => {
  console.error(e.message || "Local smoke failed");
  process.exitCode = 1;
});
