const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./helpers/loadTs.cjs');

const soon = () => new Date(Date.now() + 2 * 86400000).toISOString();
const event = (id, extra = {}) => ({ id, title: 'Yoga en grupo', category: 'DEPORTES', subcategory: 'yoga', status: 'active', starts_at: soon(), venue: 'Local confirmado ' + id, latitude: 40.42, longitude: -3.70, ...extra });

function setup() {
  const load = createLoader();
  const { rankUnifiedFeed } = load('features/events/ranking.ts');
  const { buildFeedTaste } = load('lib/feedAffinity.ts');
  const context = { taste: buildFeedTaste([], []), friendIds: new Set(['friend']), coincidedIds: new Set(), coords: { latitude: 40.42, longitude: -3.70 }, currentUserId: 'me' };
  return { rankUnifiedFeed, context };
}

test('server scores decide the order when available', () => {
  const { rankUnifiedFeed, context } = setup();
  const plans = [{ id: 'p1', kind: 'plan', plan: { id: 'p1', creador_id: 'x', categoria: 'VIBES', latitud: 40.42, longitud: -3.70 } }];
  const ranked = rankUnifiedFeed(plans, [event('e1')], { ...context, serverScores: { 'plan:p1': { s: 10, t: 2 }, 'event:e1': { s: 50, t: 2 } } });
  assert.deepEqual(Array.from(ranked, (r) => r.id), ['event:e1', 'p1']);
});

test('a just-joined plan stays on top even if the server tier is stale', () => {
  const { rankUnifiedFeed, context } = setup();
  const plans = [{ id: 'p1', kind: 'plan', membership: 'joined', plan: { id: 'p1', creador_id: 'x', categoria: 'VIBES' } }];
  const ranked = rankUnifiedFeed(plans, [event('e1')], { ...context, serverScores: { 'plan:p1': { s: 1, t: 2 }, 'event:e1': { s: 999, t: 2 } } });
  assert.equal(ranked[0].id, 'p1');
});

test('without server: a user plan with people 3 km away beats a scraped event 300 m away', () => {
  const { rankUnifiedFeed, context } = setup();
  const plan = { id: 'p1', kind: 'plan', plan: { id: 'p1', creador_id: 'x', categoria: 'VIBES', latitud: 40.447, longitud: -3.70, joinedCount: 3, fecha_evento: soon() } };
  const near = event('e1', { latitude: 40.4227, attendance_hint: 60 });
  const ranked = rankUnifiedFeed([plan], [near], context);
  assert.equal(ranked[0].id, 'p1');
});

test('without server: Nexo people and friends lift an event', () => {
  const { rankUnifiedFeed, context } = setup();
  const ranked = rankUnifiedFeed([], [event('a'), event('b')], { ...context, eventSocial: { b: { count: 4, people: [{ user_id: 'friend' }] } } });
  assert.equal(ranked[0].id, 'event:b');
  const own = rankUnifiedFeed([{ id: 'p', kind: 'plan', plan: { id: 'p', creador_id: 'stranger', categoria: 'VIBES', latitud: 40.42, longitud: -3.70, joinedCount: 10 } }], [event('b')], { ...context, eventSocial: { b: { count: 1, people: [{ user_id: 'friend' }] } } });
  assert.equal(own[0].id, 'event:b', 'an event a friend joined is in the friends group');
});
