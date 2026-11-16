const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const ACTIONS = '@nexo_offline_actions_v1';
const CHAT = '@nexo_chat_outbox_v1';
function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}
function harness() {
    const disk = new Map();
    let online = false, userId = 'user-a', serial = 0, blockedInsert = null, loseResponse = false;
    const inserted = [], messages = new Map(), sideEffects = [];
    let failRead = false;
    const storage = {
        async getItem(key) { await new Promise(setImmediate); if (failRead) throw new Error('storage unavailable'); return disk.get(key) ?? null; },
        async setItem(key, value) { await new Promise(setImmediate); disk.set(key, value); },
        async removeItem(key) { disk.delete(key); },
        async getAllKeys() { return [...disk.keys()]; },
        async multiRemove(keys) { keys.forEach((key) => disk.delete(key)); },
    };
    const fakeClient = {
        from(table) {
            const operation = { type: 'select', value: null, filters: {} };
            const query = {
                insert(value) { operation.type = 'insert'; operation.value = value; return query; },
                delete() { operation.type = 'delete'; return query; },
                select() { return query; },
                eq(key, value) { operation.filters[key] = value; return query; },
                is(key, value) { operation.filters[key] = value; return query; },
                gte() { return query; }, limit() { return query; },
                maybeSingle() { return query; },
                then(resolve, reject) { return (async () => {
                    if (operation.type === 'select') {
                        const value = operation.filters.id ? messages.get(operation.filters.id) : null;
                        return { data: value ?? null, error: null };
                    }
                    const row = operation.value;
                    inserted.push({ table, value: row });
                    if (blockedInsert) { const block = blockedInsert; blockedInsert = null; block.started.resolve(); await block.finish.promise; }
                    if (table === 'mensajes' && operation.type === 'insert') {
                        const value = { id: row.id, creado_en: '2026-11-06T10:00:00Z' };
                        messages.set(row.id, value);
                        if (loseResponse) { loseResponse = false; return { data: null, error: { message: 'Network request failed' } }; }
                        return { data: value, error: null };
                    }
                    return { data: null, error: null };
                })().then(resolve, reject); },
            };
            return query;
        },
    };
    const modules = new Map();
    const effect = (name) => (...args) => sideEffects.push([name, ...args]);
    const mocks = {
        '@react-native-async-storage/async-storage': { default: storage },
        'expo-crypto': { randomUUID: () => `00000000-0000-0000-0000-${String(++serial).padStart(12, '0')}` },
        './network': { getIsOnline: () => online, subscribeNetwork: (fn) => { fn(online); return () => {}; } },
        './auth': { getAuthUser: async () => userId ? { id: userId } : null },
        './retry': { withRetry: (fn) => fn() },
        './supabase': { supabase: fakeClient },
        './planInvites': { clearPendingPlanInvitesForMember: effect('clearInvites') },
        './push': { notifyPlanJoin: effect('joinPush'), schedulePlanLifecycleReminders: effect('reminder'), notifyPlanMessage: effect('messagePush'), notifyDirectMessage: effect('directPush') },
        './participants': { promoteWaitlist: effect('promote') },
        './directChat': { unhideDirectChat: effect('unhideDirect') },
        './planChatHide': { unhidePlanChat: effect('unhidePlan') },
        './notificationPrefs': { resetNotificationCategoryPrefsCache() {} },
        './passwordRecovery': { resetPasswordRecoveryMemory() {} },
        './screenState': { clearAllScreenState() {} },
        './ttlCache': { cacheClearAll() {} },
    };
    function load(name) {
        if (mocks[name]) return mocks[name];
        if (modules.has(name)) return modules.get(name);
        const exports = {};
        modules.set(name, exports);
        const filename = `lib/${name.replace('./', '')}.ts`;
        const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        vm.runInNewContext(code, { exports, require: load, setTimeout, clearTimeout, console, Set, Map, Promise });
        return exports;
    }
    return {
        actions: load('./offlineActions'), chat: load('./chatOutbox'), privacy: () => load('./localDataPrivacy'),
        disk, inserted, sideEffects,
        queue: (key) => JSON.parse(disk.get(key) ?? '[]'),
        online: () => { online = true; }, user: (id) => { userId = id; }, failRead: (value) => { failRead = value; },
        loseResponse: () => { loseResponse = true; },
        blockInsert() { blockedInsert = { started: deferred(), finish: deferred() }; return blockedInsert; },
    };
}
const message = (tempId) => ({ tempId, kind: 'plan', planId: 'plan-a', emisorId: 'user-a', contenido: 'Hola', tipo: 'texto', archivoUrl: null, createdAt: '2026-11-06T10:00:00Z' });

test('concurrent offline saves both survive storage read/modify/write', async () => {
    const h = harness();
    await Promise.all([h.actions.enqueueSaveAction('plan-a', 'user-a', true), h.actions.enqueueSaveAction('plan-b', 'user-a', true)]);
    assert.equal(h.queue(ACTIONS).length, 2);
});

test('save/unsave/save and join/leave/join retain their last intent', async () => {
    const h = harness();
    await h.actions.enqueueSaveAction('plan-a', 'user-a', true);
    await h.actions.enqueueSaveAction('plan-a', 'user-a', false);
    await h.actions.enqueueSaveAction('plan-a', 'user-a', true);
    await h.actions.enqueueJoinAction({ planId: 'plan-b', userId: 'user-a', estado: 'aceptado' });
    await h.actions.enqueueLeaveAction('plan-b', 'user-a', true);
    await h.actions.enqueueJoinAction({ planId: 'plan-b', userId: 'user-a', estado: 'aceptado' });
    assert.deepEqual(h.queue(ACTIONS).map((item) => item.kind), ['save', 'unsave', 'save', 'join', 'leave', 'join']);
});

test('a flush never overwrites a newly enqueued action', async () => {
    const h = harness();
    await h.actions.enqueueSaveAction('plan-a', 'user-a', true);
    h.online(); const block = h.blockInsert();
    const flush = h.actions.flushOfflineActions();
    await block.started.promise;
    await h.actions.enqueueSaveAction('plan-b', 'user-a', true);
    block.finish.resolve(); await flush;
    assert.deepEqual(h.queue(ACTIONS).map((item) => item.planId), ['plan-b']);
    await h.actions.flushOfflineActions();
    assert.equal(h.queue(ACTIONS).length, 0);
});

test('account changes do not replay another account offline actions or messages', async () => {
    const h = harness();
    await h.actions.enqueueSaveAction('plan-a', 'user-a', true);
    await h.chat.enqueueChatOutbox(message('message-a'));
    h.user('user-b'); h.online();
    await h.actions.flushOfflineActions(); await h.chat.flushChatOutbox();
    assert.equal(h.inserted.length, 0);
});

test('logout clears both personal queues without resurrecting an in-flight action', async () => {
    const h = harness();
    await h.actions.enqueueJoinAction({ planId: 'plan-a', userId: 'user-a', estado: 'aceptado' });
    await h.chat.enqueueChatOutbox(message('message-a'));
    h.online(); const block = h.blockInsert();
    const flush = h.actions.flushOfflineActions(); await block.started.promise;
    await h.privacy().clearLocalUserData();
    block.finish.resolve(); await flush;
    assert.equal(h.queue(ACTIONS).length, 0); assert.equal(h.queue(CHAT).length, 0);
    assert.equal(h.sideEffects.length, 0);
});

test('two deliberately identical chat messages are distinct sends with independent UUIDs', async () => {
    const h = harness();
    await Promise.all([h.chat.enqueueChatOutbox(message('message-a')), h.chat.enqueueChatOutbox(message('message-b'))]);
    const items = h.queue(CHAT);
    assert.notEqual(items[0].serverMessageId, items[1].serverMessageId);
    h.online(); await h.chat.flushChatOutbox();
    assert.equal(h.inserted.length, 2); assert.equal(h.queue(CHAT).length, 0);
});

test('a committed chat message whose response was lost is not inserted a second time', async () => {
    const h = harness();
    await h.chat.enqueueChatOutbox(message('message-a'));
    h.loseResponse(); h.online(); await h.chat.flushChatOutbox();
    assert.equal(h.queue(CHAT).length, 1);
    await h.chat.flushChatOutbox();
    assert.equal(h.inserted.length, 1); assert.equal(h.queue(CHAT).length, 0);
});

test('enqueueing chat during a network flush does not lose the new message', async () => {
    const h = harness();
    await h.chat.enqueueChatOutbox(message('message-a'));
    h.online(); const block = h.blockInsert(); const flush = h.chat.flushChatOutbox();
    await block.started.promise; await h.chat.enqueueChatOutbox(message('message-b'));
    block.finish.resolve(); await flush;
    assert.deepEqual(h.queue(CHAT).map((item) => item.tempId), ['message-b']);
});

test('transient storage read failure never replaces an existing queue with an empty one', async () => {
    const h = harness();
    await h.actions.enqueueSaveAction('plan-a', 'user-a', true);
    h.failRead(true);
    await assert.rejects(h.actions.enqueueSaveAction('plan-b', 'user-a', true), /storage unavailable/);
    h.failRead(false);
    assert.deepEqual(h.queue(ACTIONS).map((item) => item.planId), ['plan-a']);
});

test('logout does not resurrect a chat send or notify the next account after an in-flight request', async () => {
    const h = harness();
    await h.chat.enqueueChatOutbox(message('message-a'));
    h.online(); const block = h.blockInsert(); const flush = h.chat.flushChatOutbox();
    await block.started.promise; await h.privacy().clearLocalUserData(); h.user('user-b');
    await h.chat.enqueueChatOutbox({ ...message('message-b'), emisorId: 'user-b' });
    block.finish.resolve(); await flush;
    assert.deepEqual(h.queue(CHAT).map((item) => item.tempId), ['message-b']);
    assert.equal(h.sideEffects.length, 0);
});

function chatModel() {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync('features/chat/chatModel.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { exports, require: () => ({ isLegacyPlanCreatedNotice: () => false }) });
    return exports;
}
const bubble = (id, serverMessageId) => ({ id, serverMessageId, clientKey: id.startsWith('local-') ? id : undefined, emisor_id: 'user-a', tipo: 'texto', contenido: 'Hola', creado_en: '2026-11-06T10:00:00Z', perfiles: null, archivo_url: null });
test('realtime reconciles the exact optimistic UUID instead of the newest identical text', () => {
    const model = chatModel();
    const pending = [bubble('local-second', 'server-b'), bubble('local-first', 'server-a')];
    const result = model.reconcileIncomingChatMessage(pending, bubble('server-a'), () => true);
    assert.equal(result.next[0].id, 'local-second');
    assert.equal(result.next[1].id, 'server-a');
    assert.equal(result.next[1].clientKey, 'local-first');
});
test('merging an older identical message never drops a new pending send with its own UUID', () => {
    const model = chatModel();
    const result = model.mergeMessages([bubble('local-second', 'server-b')], [bubble('server-a')]);
    assert.equal(result.length, 2);
    const matched = model.mergeMessages([bubble('local-second', 'server-b')], [bubble('server-b')]);
    assert.equal(matched.length, 1);
    assert.equal(matched[0].clientKey, 'local-second');
});

function retryModule() {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync('lib/retry.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { exports, require: () => ({ getIsOnline: () => true }), setTimeout, clearTimeout });
    return exports;
}
test('retry stops immediately on denied credentials, validation and business-rule failures', async () => {
    const { withRetry } = retryModule();
    for (const error of [{ status: 401 }, { status: 403 }, { code: '23514' }, { code: '42501' }, { code: 'P0001' }, { code: 'PGRST301' }]) {
        let attempts = 0;
        await assert.rejects(withRetry(async () => { attempts++; throw error; }, { baseMs: 0 }), (actual) => actual === error);
        assert.equal(attempts, 1);
    }
});
test('retry still backs off on network failures, rate limits and transient server errors', async () => {
    const { withRetry } = retryModule();
    for (const error of [new Error('Network request failed'), { status: 429 }, { status: 503 }, { code: '40001' }]) {
        let attempts = 0;
        const result = await withRetry(async () => { if (++attempts < 3) throw error; return 'ok'; }, { baseMs: 0 });
        assert.equal(result, 'ok'); assert.equal(attempts, 3);
    }
});
