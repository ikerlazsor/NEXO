const { test } = require("node:test"),
  assert = require("node:assert/strict");
const native = require("abort-controller/dist/abort-controller");
const { createLoader } = require("./helpers/loadTs.cjs");

test("join, chat and analytics work with React Native actual AbortSignal, without timeout()", async () => {
  assert.equal(typeof native.AbortSignal.timeout, "undefined");
  const calls = [],
    timers = new Set();
  const load = createLoader(
    {
      "../../lib/supabase": {
        supabase: {
          rpc: (name, args) => ({
            abortSignal: (signal) => {
              calls.push({ name, args, signal });
              return Promise.resolve({ data: null, error: null });
            },
          }),
        },
      },
      "../../lib/profileData": { getPublicProfiles: async () => [] },
    },
    {
      AbortController: native.AbortController,
      AbortSignal: native.AbortSignal,
      setTimeout: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        timers.add(timer);
        return timer;
      },
      clearTimeout: (timer) => {
        timers.delete(timer);
        clearTimeout(timer);
      },
    },
  );
  const api = load("features/events/api.ts");
  await api.setEventMembership("event-id", true);
  await api.sendEventMessage("event-id", "client-id", "Hello");
  await api.trackEvent("event-id", "view");
  assert.deepEqual(
    calls.map((c) => c.name),
    ["set_event_membership", "send_event_message", "track_event_interaction"],
  );
  assert.ok(
    calls.every(
      (c) => c.signal instanceof native.AbortSignal && !c.signal.aborted,
    ),
  );
  assert.equal(timers.size, 0);
});
test("request deadline cancels a stalled native request and respects an already cancelled caller", async () => {
  const load = createLoader(
    {},
    {
      AbortController: native.AbortController,
      AbortSignal: native.AbortSignal,
    },
  );
  const { withRequestDeadline } = load("lib/requestDeadline.ts");
  const stalled = (signal) =>
    new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(new Error("aborted"))),
    );
  await assert.rejects(withRequestDeadline(stalled, undefined, 5), /aborted/);
  const parent = new native.AbortController();
  parent.abort();
  let called = false;
  await assert.rejects(
    withRequestDeadline(() => {
      called = true;
      return Promise.resolve();
    }, parent.signal),
    /request_aborted/,
  );
  assert.equal(called, false);
});
