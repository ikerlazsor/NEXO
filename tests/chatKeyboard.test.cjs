const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function mountKeyboard(platform, safeBottom = 24) {
    const listeners = new Map();
    const cleanups = [];
    let pad;
    const mocks = {
        react: {
            useEffect: (fn) => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); },
            useMemo: (fn) => fn(),
            useRef: (value) => ({ current: value }),
        },
        'react-native': {
            Platform: { OS: platform },
            useWindowDimensions: () => ({ height: 800 }),
            Keyboard: { addListener: (name, fn) => {
                listeners.set(name, fn);
                return { remove: () => listeners.delete(name) };
            } },
        },
        'react-native-reanimated': {
            Easing: { bezier: () => null, out: () => null, cubic: null },
            useSharedValue: (value) => (pad = { value }),
            useAnimatedStyle: (fn) => fn,
            withTiming: (value) => value,
        },
    };
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync('lib/chatKeyboard.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { exports: module.exports, require: (id) => {
        assert.ok(id in mocks, `Unexpected dependency: ${id}`);
        return mocks[id];
    } });
    module.exports.useChatKeyboardBottomPad(safeBottom);
    return {
        pad,
        emit: (name, height = 300) => listeners.get(name)?.({
            duration: 250, endCoordinates: { height, screenY: 800 - height },
        }),
        cleanup: () => cleanups.forEach((fn) => fn()),
        listeners,
    };
}

test('Android adjustResize leaves only composer spacing, even on repeated keyboard events', () => {
    const hook = mountKeyboard('android');
    assert.equal(hook.pad.value, 34);
    hook.emit('keyboardDidShow');
    assert.equal(hook.pad.value, 6);
    hook.emit('keyboardDidChangeFrame', 400);
    assert.equal(hook.pad.value, 6);
    hook.emit('keyboardDidShow', 400);
    assert.equal(hook.pad.value, 6);
    hook.emit('keyboardDidHide');
    assert.equal(hook.pad.value, 34);
    hook.cleanup();
    assert.equal(hook.listeners.size, 0);
});

test('iOS compensates keyboard overlay and frame changes, restoring minimum safe spacing', () => {
    const hook = mountKeyboard('ios', 0);
    assert.equal(hook.pad.value, 20);
    hook.emit('keyboardWillChangeFrame');
    assert.equal(hook.pad.value, 20);
    hook.emit('keyboardWillShow');
    assert.equal(hook.pad.value, 306);
    hook.emit('keyboardWillChangeFrame', 400);
    assert.equal(hook.pad.value, 406);
    hook.emit('keyboardWillHide');
    assert.equal(hook.pad.value, 20);
});
