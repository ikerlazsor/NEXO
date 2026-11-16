const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, globals = {}) {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { exports: module.exports, ...globals });
    return module.exports;
}
const { createProfileLoadGuard } = load('lib/profileLoadGuard.ts');

test('new profile reads supersede old reads without delaying immediate cache hydration', () => {
    const guard = createProfileLoadGuard(() => 'user-a', () => 0);
    const first = guard.begin('user-a');
    assert.equal(first(), true);
    const second = guard.begin('user-a');
    assert.equal(first(), false);
    assert.equal(second(), true);
});

test('blur or unmount invalidation rejects late profile and secondary notification updates', () => {
    const guard = createProfileLoadGuard(() => 'user-a', () => 0);
    const pending = guard.begin('user-a');
    guard.invalidate();
    assert.equal(pending(), false);
    assert.equal(guard.begin('user-a')(), true);
});

test('account changes reject old responses even before focus cleanup runs', () => {
    let userId = 'user-a';
    const guard = createProfileLoadGuard(() => userId, () => 0);
    const oldAccount = guard.begin(userId);
    userId = 'user-b';
    assert.equal(oldAccount(), false);
    assert.equal(guard.begin(userId)(), true);
});

test('a delayed response cannot overwrite an edit even after the optimistic TTL expires', () => {
    let now = 1000;
    const edits = load('lib/profileOptimistic.ts', { Date: { now: () => now } });
    const guard = createProfileLoadGuard(() => 'user-a', edits.getProfileEditRevision);
    const oldRead = guard.begin('user-a');
    edits.noteProfileOptimisticWrite(5000);
    now += 6000;
    assert.equal(edits.shouldPreferProfileCache(), false);
    assert.equal(oldRead(), false);
    // A new focus read after the edit can still fetch current server data.
    assert.equal(guard.begin('user-a')(), true);
});
