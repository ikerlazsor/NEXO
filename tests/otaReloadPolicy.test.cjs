const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OTA_RELOAD_RETRY_MS,
  attemptedUpdateKey,
  parseAttemptedUpdate,
  serializeAttemptedUpdate,
  shouldReloadFetchedUpdate,
} = require('../.test-dist/otaReloadPolicy.js');

test('a new update id can reload', () => {
  assert.equal(shouldReloadFetchedUpdate('next', { id: 'prev', at: 1_000 }, 2_000), true);
  assert.equal(shouldReloadFetchedUpdate('next', null, 2_000), true);
});

test('the same update does not reload again immediately', () => {
  assert.equal(
    shouldReloadFetchedUpdate('same', { id: 'same', at: 5_000 }, 5_000 + 10_000),
    false,
  );
});

test('the same update can reload after the cooldown', () => {
  const at = 5_000;
  assert.equal(
    shouldReloadFetchedUpdate('same', { id: 'same', at }, at + OTA_RELOAD_RETRY_MS),
    true,
  );
  assert.equal(
    shouldReloadFetchedUpdate('same', { id: 'same', at }, at + OTA_RELOAD_RETRY_MS - 1),
    false,
  );
});

test('a missing update id only blocks that unknown attempt', () => {
  assert.equal(attemptedUpdateKey(null), 'unknown');
  assert.equal(attemptedUpdateKey(''), 'unknown');
  assert.equal(shouldReloadFetchedUpdate(null, { id: 'unknown', at: 5_000 }, 6_000), false);
  assert.equal(shouldReloadFetchedUpdate('real-id', { id: 'unknown', at: 5_000 }, 6_000), true);
});

test('attempted update storage roundtrips and ignores garbage', () => {
  const raw = serializeAttemptedUpdate('abc', 42);
  assert.deepEqual(parseAttemptedUpdate(raw), { id: 'abc', at: 42 });
  assert.deepEqual(parseAttemptedUpdate(serializeAttemptedUpdate(null, 7)), {
    id: 'unknown',
    at: 7,
  });
  assert.equal(parseAttemptedUpdate(null), null);
  assert.equal(parseAttemptedUpdate(''), null);
  assert.equal(parseAttemptedUpdate('not-json'), null);
  assert.equal(parseAttemptedUpdate(JSON.stringify({ id: '', at: 1 })), null);
});
