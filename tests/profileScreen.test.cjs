const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function harness({ disk, rpc }) {
    const memory = new Map();
    const rpcStarted = deferred();
    const writes = [];
    let rpcCalls = 0, diskCalls = 0;
    const mocks = {
        './badgeStats': { EMPTY_BADGE_STATS: {} },
        './badges': { getUserBadges: () => [] },
        './diskCache': {
            diskGet: () => { diskCalls++; return disk; },
            diskSet: async (key, snapshot) => { writes.push({ key, snapshot }); },
        },
        './organizer': { parseOrganizerMeta: (value) => value ?? {} },
        './profileFields': { calcAge: () => null, parseHabitos: () => ({ bebida: 'no_especificado', tabaco: 'no_especificado' }), parsePrivacy: () => ({}) },
        './screenCaches': { screenCacheKey: { profileUI: (id) => id }, ScreenCacheTTL: { profileUI: 60000 } },
        './stats': { EMPTY_STATS: { numeroAmistades: 0 } },
        './supabase': { supabase: { rpc: () => { rpcCalls++; rpcStarted.resolve(); return rpc; } } },
        './ttlCache': { cacheGetStale: (key) => memory.get(key), cacheSet: (key, snapshot) => memory.set(key, snapshot) },
    };
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync('lib/profileScreen.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { exports: module.exports, require: (id) => {
        assert.ok(id in mocks, `Unexpected dependency: ${id}`);
        return mocks[id];
    } });
    return { load: module.exports.loadProfileScreen, warm: module.exports.warmOwnProfile, memory, writes, rpcStarted: rpcStarted.promise, calls: () => ({ rpc: rpcCalls, disk: diskCalls }) };
}

test('late disk warmup preserves an edited profile already available in memory', async () => {
    const disk = deferred();
    const h = harness({ disk: disk.promise });
    const warmup = h.warm('user-a');
    const edited = { userId: 'user-a', nombre: 'Updated name' };
    h.memory.set('user-a', edited);
    disk.resolve({ userId: 'user-a', nombre: 'Old name' });
    await warmup;
    assert.equal(h.memory.get('user-a'), edited);
    assert.deepEqual(h.calls(), { rpc: 0, disk: 1 });
    assert.equal(h.writes.length, 0);
});

test('late network warmup cannot replace a fresher profile loaded after disk lookup', async () => {
    const rpc = deferred();
    const h = harness({ disk: Promise.resolve(null), rpc: rpc.promise });
    const warmup = h.warm('user-a');
    await h.rpcStarted;
    assert.equal(h.calls().rpc, 1);
    const edited = { userId: 'user-a', nombre: 'Latest profile' };
    h.memory.set('user-a', edited);
    rpc.resolve({ data: { profile: { id: 'user-a', nombre: 'Stale network name' } }, error: null });
    await warmup;
    assert.equal(h.memory.get('user-a'), edited);
    assert.equal(h.writes.length, 0);
});

test('simultaneous warmups share one request and populate the first usable cached profile', async () => {
    const disk = deferred();
    const h = harness({ disk: disk.promise });
    const first = h.warm('user-a');
    const second = h.warm('user-a');
    assert.equal(first, second);
    const snapshot = { userId: 'user-a', nombre: 'Cached profile' };
    disk.resolve(snapshot);
    await Promise.all([first, second]);
    assert.equal(h.memory.get('user-a'), snapshot);
    assert.deepEqual(h.calls(), { rpc: 0, disk: 1 });
});

test('failed background warmup is harmless and can be retried', async () => {
    const disk = deferred();
    const h = harness({ disk: disk.promise });
    const warmup = h.warm('user-a');
    disk.reject(new Error('Storage unavailable'));
    await assert.doesNotReject(warmup);
    await assert.doesNotReject(h.warm('user-a'));
    assert.equal(h.calls().disk, 2);
});

test('profile bundle and warm cache use public age without needing a birth date', async () => {
    const h = harness({ disk: Promise.resolve(null), rpc: Promise.resolve({
        data: { profile: { id: 'user-a', nombre: 'Nexo user', edad: 31, fecha_nacimiento: null } }, error: null,
    }) });
    const bundle = await h.load('user-a');
    assert.equal(bundle.profile.edad, 31);
    assert.equal(bundle.profile.fecha_nacimiento, null);
    await h.warm('user-a');
    assert.equal(h.memory.get('user-a').age, 31);
});

test('old servers without public age remain compatible and invalid ages stay absent', async () => {
    const old = harness({ rpc: Promise.resolve({ data: { profile: { id: 'user-a' } }, error: null }) });
    assert.equal((await old.load('user-a')).profile.edad, null);
    const invalid = harness({ rpc: Promise.resolve({ data: { profile: { id: 'user-a', edad: 500 } }, error: null }) });
    assert.equal((await invalid.load('user-a')).profile.edad, null);
});
