const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./helpers/loadTs.cjs');

const store = new Map();
const AsyncStorage = {
  setItem: async (k, v) => { store.set(k, v); },
  getItem: async (k) => (store.has(k) ? store.get(k) : null),
  removeItem: async (k) => { store.delete(k); },
};
const mod = createLoader({ '@react-native-async-storage/async-storage': { __esModule: true, default: AsyncStorage } })('lib/emailVerification.ts');

test('a pending verification code expires so an abandoned signup never traps the app', async () => {
  const now = 1_800_000_000_000;
  const fresh = JSON.stringify({ email: 'Ana@Example.com ', at: now - 60_000 });
  assert.equal(mod.parsePendingVerifyEmail(fresh, now), 'ana@example.com');
  const stale = JSON.stringify({ email: 'ana@example.com', at: now - mod.PENDING_VERIFY_TTL_MS - 1 });
  assert.equal(mod.parsePendingVerifyEmail(stale, now), null);
  // Formato antiguo sin fecha: se trata como caducado.
  assert.equal(mod.parsePendingVerifyEmail('ana@example.com', now), null);
  assert.equal(mod.parsePendingVerifyEmail(JSON.stringify({ email: 'nope', at: now }), now), null);
  assert.equal(mod.parsePendingVerifyEmail(null, now), null);
});

test('stored pending email round-trips and stale values are removed', async () => {
  await mod.setPendingVerifyEmail('Leo@Example.com');
  assert.equal(await mod.getPendingVerifyEmail(), 'leo@example.com');
  store.set('@nexo_pending_verify_email', 'leo@example.com');
  assert.equal(await mod.getPendingVerifyEmail(), null);
  assert.equal(store.has('@nexo_pending_verify_email'), false);
});
