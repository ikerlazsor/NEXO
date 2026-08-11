const test = require('node:test');
const assert = require('node:assert/strict');

const {
  StartupCoordinator,
  classifyStartupFailure,
  shouldRunStartupForAuthEvent,
} = require('../.test-dist/startupControl.js');

test('profile metadata updates do not restart a verified session', () => {
  assert.equal(
    shouldRunStartupForAuthEvent('USER_UPDATED', 'user-1', 'user-1', true),
    false,
  );
  assert.equal(
    shouldRunStartupForAuthEvent('TOKEN_REFRESHED', 'user-1', 'user-1', true),
    false,
  );
  assert.equal(
    shouldRunStartupForAuthEvent('SIGNED_IN', 'user-1', 'user-1', true),
    false,
  );
});

test('account changes and unfinished startup still require verification', () => {
  assert.equal(
    shouldRunStartupForAuthEvent('SIGNED_IN', null, 'user-1', true),
    true,
  );
  assert.equal(
    shouldRunStartupForAuthEvent('SIGNED_IN', 'user-1', 'user-2', true),
    true,
  );
  assert.equal(
    shouldRunStartupForAuthEvent('SIGNED_OUT', 'user-1', null, true),
    true,
  );
  assert.equal(
    shouldRunStartupForAuthEvent('USER_UPDATED', 'user-1', 'user-1', false),
    true,
  );
});

test('a newer session cancels and invalidates the previous startup', async () => {
  const coordinator = new StartupCoordinator();
  let firstWasAborted = false;

  const first = coordinator.run(
    (signal) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          firstWasAborted = true;
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
        setTimeout(() => resolve('old-session'), 100);
      }),
    { timeoutMs: 500 },
  );

  const second = coordinator.run(async () => 'new-session', { timeoutMs: 500 });

  assert.deepEqual(await second, { status: 'success', value: 'new-session' });
  assert.deepEqual(await first, { status: 'stale' });
  assert.equal(firstWasAborted, true);
});

test('a hung startup is aborted at the configured deadline', async () => {
  const coordinator = new StartupCoordinator();
  let wasAborted = false;

  const result = await coordinator.run(
    (signal) =>
      new Promise(() => {
        signal.addEventListener('abort', () => {
          wasAborted = true;
        });
      }),
    { timeoutMs: 20 },
  );

  assert.equal(result.status, 'failure');
  assert.equal(result.failure.kind, 'timeout');
  assert.equal(wasAborted, true);
});

test('network failures are reported separately from unexpected failures', () => {
  assert.equal(classifyStartupFailure(new Error('Failed to fetch'), true).kind, 'offline');
  assert.equal(classifyStartupFailure(new Error('database unavailable'), false).kind, 'offline');
  assert.equal(classifyStartupFailure(new Error('invalid response'), true).kind, 'unexpected');
});

test('a failed startup can be retried successfully with the same coordinator', async () => {
  const coordinator = new StartupCoordinator();
  const failed = await coordinator.run(async () => {
    throw new Error('Network request failed');
  });
  const retried = await coordinator.run(async () => 'ready');

  assert.equal(failed.status, 'failure');
  assert.equal(failed.failure.kind, 'offline');
  assert.deepEqual(retried, { status: 'success', value: 'ready' });
});
