const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const roomA = '10000000-0000-4000-8000-000000000001';
const roomB = '10000000-0000-4000-8000-000000000002';
const message = (id, date, room = roomA) => ({
  id, event_id: room, sender_id: 'sender', body: `body ${id}`,
  created_at: date, client_id: id,
});

// Executes the real hooks with persistent React slots and explicit effect commits.
// Rendering before commit lets the tests observe the account-change privacy boundary.
function mount(file, exportName, args, api = {}, profiles = async () => []) {
  const slots = [], effects = [], timers = new Map();
  let index = 0, timerId = 0, uuid = 0, dirty = false, result;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const effect = (fn, deps, focus = false) => {
    const slot = slots[index++] ||= {};
    if (focus) slot.focus = fn;
    if (!same(slot.deps, deps)) {
      slot.deps = deps;
      effects.push(() => { slot.cleanup?.(); slot.cleanup = fn(); });
    }
  };
  const react = {
    useState: (initial) => {
      const slot = slots[index++] ||= { value: typeof initial === 'function' ? initial() : initial };
      return [slot.value, (value) => { slot.value = typeof value === 'function' ? value(slot.value) : value; dirty = true; }];
    },
    useRef: (initial) => slots[index++] ||= { current: initial },
    useMemo: (fn, deps) => {
      const slot = slots[index++] ||= {};
      if (!same(slot.deps, deps)) { slot.deps = deps; slot.value = fn(); }
      return slot.value;
    },
    useCallback: (fn, deps) => react.useMemo(() => fn, deps),
    useEffect: effect,
  };
  const mocks = {
    react,
    '@react-navigation/native': { useFocusEffect: (fn) => effect(fn, [fn], true) },
    'react-native': { AppState: { currentState: 'active' } },
    'expo-crypto': { randomUUID: () => `client-${++uuid}` },
    '../../lib/profileData': { getPublicProfiles: profiles },
    './api': {
      fetchEventPage: async () => [],
      fetchEventPersonalization: async () => ({ joined: new Set(), history: { categories: {}, seen: new Set() } }),
      setEventMembership: async () => {},
      fetchEventMembership: async () => true,
      fetchEventMessages: async () => [],
      sendEventMessage: async () => {},
      ...api,
    },
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: (id) => { assert.ok(id in mocks, `Unexpected import ${id}`); return mocks[id]; },
    AbortController, AbortSignal,
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => { timers.set(++timerId, { fn, ms, interval: true }); return timerId; },
    clearInterval: (id) => timers.delete(id),
  });
  function render(nextArgs = args, commit = true) {
    args = nextArgs; index = 0; dirty = false;
    result = exports[exportName](...args);
    if (commit) while (effects.length) effects.shift()();
    return result;
  }
  render();
  return {
    get value() { return result; },
    render,
    async flush() {
      while (effects.length) effects.shift()();
      for (let turn = 0; turn < 12; turn++) {
        await Promise.resolve();
        if (dirty) render();
      }
      return result;
    },
    tick(ms) {
      for (const [id, timer] of [...timers]) if (timer.ms === ms) {
        if (!timer.interval) timers.delete(id);
        timer.fn();
      }
    },
    blur() { slots.filter((slot) => slot.focus).forEach((slot) => { slot.cleanup?.(); slot.cleanup = undefined; }); },
    focus() { slots.filter((slot) => slot.focus).forEach((slot) => { slot.cleanup = slot.focus(); }); },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); timers.clear(); },
  };
}

test('a pending personalization snapshot cannot undo a join, and rapid taps make one mutation', async () => {
  const personal = deferred(), joined = deferred();
  let mutations = 0;
  const hook = mount('features/events/useEvents.ts', 'useEvents', [{}, 'viewer-a'], {
    fetchEventPersonalization: () => personal.promise,
    setEventMembership: () => { mutations++; return joined.promise; },
  });
  const change = hook.value.toggleJoin(roomA);
  await hook.value.toggleJoin(roomA);
  assert.equal(mutations, 1);
  joined.resolve(); await change; await hook.flush();
  assert.equal(hook.value.joined.has(roomA), true);
  personal.resolve({ joined: new Set(), history: { categories: {}, seen: new Set() } });
  await hook.flush();
  assert.equal(hook.value.joined.has(roomA), true);
  const next = hook.render([{}, 'viewer-b'], false);
  assert.equal(next.joined.size, 0);
  assert.equal(next.history.seen.size, 0);
  assert.equal(next.busy, null);
  hook.unmount();
});

test('changing feed filters discards late results and pagination deduplicates the boundary', async () => {
  const first = deferred(), second = deferred();
  const calls = [];
  const page = Array.from({ length: 30 }, (_, n) => ({ id: `event-${n}`, start_date: '2026-11-07' }));
  const hook = mount('features/events/useEvents.ts', 'useEvents', [{ query: 'old' }, null], {
    fetchEventPage: (filters, cursor, signal) => {
      calls.push({ filters, cursor, signal });
      return calls.length === 1 ? first.promise : calls.length === 2 ? second.promise : Promise.resolve([page[29], { id: 'last', start_date: '2026-11-08' }]);
    },
  });
  hook.tick(200);
  hook.render([{ query: 'new' }, null]);
  hook.tick(200);
  assert.equal(calls[0].signal.aborted, true);
  second.resolve(page); await hook.flush();
  first.resolve([{ id: 'stale', start_date: '2026-11-01' }]); await hook.flush();
  assert.equal(hook.value.events.length, 30);
  assert.equal(hook.value.events.some((e) => e.id === 'stale'), false);
  await hook.value.loadMore(); await hook.flush();
  assert.equal(hook.value.events.length, 31);
  assert.equal(calls[2].cursor.id, 'event-29');
  assert.equal(calls[2].filters.query, 'new');
  assert.equal(hook.value.hasMore, false);
  assert.equal(hook.render([{ query: 'another' }, null], false).events.length, 0);
  hook.unmount();
});

test('changing chat account masks old messages and drafts before effects, and bypasses an old request lock', async () => {
  const oldRead = deferred();
  let reads = 0;
  const hook = mount('features/events/useEventChat.ts', 'useEventChat', [roomA, 'viewer-a'], {
    fetchEventMembership: () => ++reads === 2 ? oldRead.promise : Promise.resolve(true),
    fetchEventMessages: async () => [message('one', '2026-11-06T10:00:00Z')],
  });
  await hook.flush();
  assert.equal(hook.value.messages.length, 1);
  hook.value.setText('private draft'); await hook.flush();
  hook.tick(10000); // Leave the old viewer's next membership check pending.
  const masked = hook.render([roomA, 'viewer-b'], false);
  assert.equal(masked.messages.length, 0);
  assert.equal(masked.member, false);
  assert.equal(masked.text, '');
  await hook.flush();
  assert.equal(reads, 3); // New viewer loads immediately, without waiting 10 seconds.
  assert.equal(hook.value.member, true);
  oldRead.resolve(false); await hook.flush();
  assert.equal(hook.value.member, true);
  hook.unmount();
});

test('chat history continues receiving new messages even when profile hydration stalls', async () => {
  const initial = Array.from({ length: 40 }, (_, n) => message(String(100 - n), `2026-11-06T10:${String(59 - n).padStart(2, '0')}:00Z`));
  let page = initial;
  const never = deferred();
  const hook = mount('features/events/useEventChat.ts', 'useEventChat', [roomA, 'viewer-a'], {
    fetchEventMessages: async (_id, older) => older ? [message('old', '2026-11-05T00:00:00Z')] : page,
  }, () => never.promise);
  await hook.flush();
  assert.equal(hook.value.messages.length, 40);
  await hook.value.refresh(initial[39]); await hook.flush();
  assert.equal(hook.value.messages.length, 41);
  page = [message('new', '2026-11-06T11:00:00Z'), ...initial.slice(0, 39)];
  hook.tick(10000); await hook.flush();
  assert.equal(hook.value.messages[0].id, 'new');
  assert.equal(hook.value.messages.some((m) => m.id === 'old'), true);
  assert.equal(hook.value.messages.length, 42);
  assert.equal(hook.value.more, false);
  hook.unmount();
});

test('send retries reuse their UUID only in the same room, and an old completion cannot clear a new draft', async () => {
  const delayed = deferred();
  const sent = [];
  const hook = mount('features/events/useEventChat.ts', 'useEventChat', [roomA, 'viewer-a'], {
    sendEventMessage: (id, client, body) => {
      sent.push({ id, client, body });
      return sent.length === 1 ? Promise.reject(new Error('offline')) : sent.length === 2 ? delayed.promise : Promise.resolve();
    },
  });
  await hook.flush();
  hook.value.setText('same body'); await hook.flush();
  await assert.rejects(hook.value.send(), /offline/); await hook.flush();
  hook.blur(); hook.focus(); await hook.flush();
  assert.equal(hook.value.text, 'same body');
  const retry = hook.value.send();
  await hook.value.send(); // Same-frame double tap is ignored.
  assert.equal(sent.length, 2);
  assert.equal(sent[0].client, sent[1].client);
  hook.render([roomB, 'viewer-a']); await hook.flush();
  hook.value.setText('same body'); await hook.flush();
  delayed.resolve(); await retry; await hook.flush();
  assert.equal(hook.value.text, 'same body');
  await hook.value.send(); await hook.flush();
  assert.equal(sent.length, 3);
  assert.equal(sent[2].id, roomB);
  assert.notEqual(sent[2].client, sent[1].client);
  hook.unmount();
});

test('a revoked membership clears event messages, participant names and the draft', async () => {
  let member = true;
  const hook = mount('features/events/useEventChat.ts', 'useEventChat', [roomA, 'viewer-a'], {
    fetchEventMembership: async () => member,
    fetchEventMessages: async () => [message('one', '2026-11-06T10:00:00Z')],
  }, async () => [{ id: 'sender', nombre: 'Private name' }]);
  await hook.flush();
  hook.value.setText('secret draft'); await hook.flush();
  assert.equal(hook.value.names.sender, 'Private name');
  member = false;
  hook.tick(10000); await hook.flush();
  assert.equal(hook.value.messages.length, 0);
  assert.equal(Object.keys(hook.value.names).length, 0);
  assert.equal(hook.value.text, '');
  assert.equal(hook.value.member, false);
  hook.unmount();
});
