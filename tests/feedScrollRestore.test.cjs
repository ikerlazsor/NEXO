const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createLoader } = require("./helpers/loadTs.cjs");

function setup(saved = 2400, options = {}) {
  let focus,
    offset = saved;
  const work = [];
  const calls = [];
  const load = createLoader(
    {
      react: {
        useRef: (value) => ({ current: value }),
        useCallback: (fn) => fn,
      },
      "@react-navigation/native": {
        useFocusEffect: (fn) => {
          focus = fn;
        },
      },
      "react-native": {
        InteractionManager: {
          runAfterInteractions: (fn) => {
            const task = { fn, cancelled: false };
            work.push(task);
            return {
              cancel: () => {
                task.cancelled = true;
              },
            };
          },
        },
      },
      "../lib/screenState": {
        getScreenScrollOffset: () => offset,
        setScreenScrollOffset: (_key, value) => {
          offset = value;
        },
      },
    },
    { requestAnimationFrame: (fn) => fn() },
  );
  const { useListScrollRestore } = load("hooks/useListScrollRestore.ts");
  const hook = useListScrollRestore("feed", { waitForContent: true, ...options });
  hook.listRef.current = { scrollToOffset: (value) => calls.push(value) };
  return {
    hook,
    calls,
    get offset() {
      return offset;
    },
    focus: () => focus(),
    finish: () =>
      work.splice(0).forEach((task) => {
        if (!task.cancelled) task.fn();
      }),
  };
}
const scroll = (y) => ({ nativeEvent: { contentOffset: { y } } });

test("returning from a detail ignores layout resets and restores only after enough content exists", () => {
  const state = setup();
  const blur = state.focus();
  state.hook.onScroll(scroll(0));
  assert.equal(state.offset, 2400);
  state.hook.onListLayout({ nativeEvent: { layout: { height: 700 } } });
  state.finish();
  assert.equal(
    state.calls.length,
    0,
    "an empty initial list must not consume the saved position",
  );
  state.hook.onContentSizeChange(390, 1500);
  assert.equal(state.calls.length, 0);
  state.hook.onContentSizeChange(390, 6000);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].offset, 2400);
  assert.equal(state.calls[0].animated, false);
  state.hook.onScroll(scroll(2560));
  blur();
  state.hook.onScroll(scroll(0));
  assert.equal(state.offset, 2560, "covered feed cannot overwrite its offset");
  state.focus();
  state.finish();
  assert.equal(state.calls.at(-1).offset, 2560);
});

test('tapping during a fling captures the native offset and restores the same card inset after a height change', () => {
  const state=setup(0,{itemKeyAt:i=>i===4?'card-four':undefined,indexOfKey:key=>key==='card-four'?4:-1});
  let offset=2450, y=2400;
  Object.assign(state.hook.listRef.current, {getFirstVisibleIndex:()=>4,getLayout:()=>({y}),getFirstItemOffset:()=>100,getAbsoluteLastScrollOffset:()=>offset});
  const blur=state.focus();
  state.hook.onListLayout({nativeEvent:{layout:{height:700}}});
  state.hook.onContentSizeChange(390,8000);
  state.hook.captureScroll();
  state.hook.onScroll(scroll(2900));
  assert.equal(state.offset,2450,'momentum after opening must be ignored');
  blur(); y=2460; offset=0;
  state.focus();state.finish();
  assert.equal(state.calls.at(-1).offset,2510,'the card stays at the same visual inset, even if content above grew');
});
test("manual scrolling and explicit refresh supersede a pending restore", () => {
  const state = setup();
  state.focus();
  state.hook.onScrollBeginDrag();
  state.hook.onScroll(scroll(90));
  state.finish();
  assert.equal(state.offset, 90);
  state.hook.onScroll(scroll(180));
  assert.equal(
    state.offset,
    180,
    "a deferred focus task cannot take over a manual drag",
  );
  state.hook.setScrollOffset(0);
  state.hook.onContentSizeChange(390, 6000);
  assert.equal(state.offset, 0);
  assert.equal(
    state.calls.some((call) => call.offset === 2400),
    false,
  );
});
