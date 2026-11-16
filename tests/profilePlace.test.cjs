const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}
function harness({ first, second, geocode, write } = {}) {
    let userId = 'user-a', revision = 0, preferred = false;
    const writes = [], invalidations = [];
    let profileReads = 0;
    const geoStarted = deferred(), writeStarted = deferred();
    const profile = (gustos = null) => ({ data: { id: userId, perfil_gustos: gustos }, error: null });
    const mocks = {
        './profileOptimistic': { getProfileEditRevision: () => revision, shouldPreferProfileCache: () => preferred },
        './auth': { getAuthSession: async () => userId ? { user: { id: userId }, access_token: `synthetic-token-${userId}` } : null },
        './profileData': { getMyProfile: async () => {
            profileReads++;
            return await ((profileReads === 1 ? first : second)?.() ?? profile());
        } },
        './screenCaches': { invalidateProfilePresentationCaches: (id) => invalidations.push(id) },
        './supabase': { supabase: {
            from: () => { throw new Error('Private profile must use get_my_profile'); },
            rpc: (name, args) => {
                assert.equal(name, 'set_perfil_ubicacion');
                return { setHeader: (header, token) => {
                    writes.push({ args, header, token });
                    writeStarted.resolve();
                    return write ?? Promise.resolve({ error: null });
                } };
            },
        } },
        'expo-location': { getForegroundPermissionsAsync: async () => ({ status: 'granted' }), reverseGeocodeAsync: async () => [] },
        './location': { getUserCoords: async () => ({ latitude: 40.4, longitude: -3.7 }), peekUserCoords: () => null, hydrateUserCoordsFromDisk: async () => null },
        './geocoding': { reverseGeocodeCityCountry: async () => {
            geoStarted.resolve();
            return geocode ?? { ciudad: 'Madrid', pais: 'España' };
        } },
    };
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/profilePlace.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports: module.exports, require: (id) => {
        assert.ok(id in mocks, `Unexpected dependency: ${id}`);
        return mocks[id];
    } });
    return {
        run: () => module.exports.ensureAutoProfilePlace('user-a'), writes, invalidations,
        edit: (ttlActive) => { revision++; preferred = ttlActive; },
        switchUser: (id) => { userId = id; },
        reads: () => profileReads, geoStarted: geoStarted.promise, writeStarted: writeStarted.promise,
    };
}

test('auto place uses private RPC reads, retains user fields and pins its own session when saving', async () => {
    const h = harness();
    const place = await h.run();
    assert.equal(place.ciudad, 'Madrid');
    assert.equal(h.reads(), 2);
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].header, 'Authorization');
    assert.equal(h.writes[0].token, 'Bearer synthetic-token-user-a');
    assert.deepEqual(h.invalidations, ['user-a']);
});

test('a private profile RPC returning another account cannot trigger geocoding or writes', async () => {
    const h = harness({ first: () => ({ data: { id: 'user-b', perfil_gustos: null }, error: null }) });
    assert.equal(await h.run(), null);
    assert.equal(h.reads(), 1);
    assert.equal(h.writes.length, 0);
    assert.equal(h.invalidations.length, 0);
});

test('manual or already stored places are respected after geocoding finishes', async () => {
    const h = harness({ second: () => ({ data: { id: 'user-a', perfil_gustos: { ubicacion_manual: true, ubicacion: { ciudad: 'Sevilla', pais: 'España' } } }, error: null }) });
    assert.equal((await h.run()).ciudad, 'Sevilla');
    assert.equal(h.writes.length, 0);
});

test('a long geocode cannot replace an edit after the optimistic TTL already elapsed', async () => {
    const geo = deferred();
    const h = harness({ geocode: geo.promise });
    const pending = h.run();
    await h.geoStarted;
    h.edit(false); // The revision persists even after shouldPreferProfileCache becomes false.
    geo.resolve({ ciudad: 'Madrid', pais: 'España' });
    assert.equal(await pending, null);
    assert.equal(h.writes.length, 0);
    assert.equal(h.invalidations.length, 0);
});

test('switching accounts during geocoding prevents applying the old account result', async () => {
    const geo = deferred();
    const h = harness({ geocode: geo.promise });
    const pending = h.run();
    await h.geoStarted;
    h.switchUser('user-b');
    geo.resolve({ ciudad: 'Madrid', pais: 'España' });
    assert.equal(await pending, null);
    assert.equal(h.writes.length, 0);
    assert.equal(h.invalidations.length, 0);
});

test('switching accounts during an already dispatched write prevents stale cache invalidation', async () => {
    const write = deferred();
    const h = harness({ write: write.promise });
    const pending = h.run();
    await h.writeStarted;
    h.switchUser('user-b');
    write.resolve({ error: null });
    assert.equal(await pending, null);
    assert.equal(h.writes[0].token, 'Bearer synthetic-token-user-a');
    assert.equal(h.invalidations.length, 0);
});
