const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMadridEvents, readRows } = require('../scripts/madrid-events-preview.cjs');

const NOW = new Date('2026-11-06T00:00:00Z');
const future = (extra = {}) => ({
  id: 123,
  title: ' Paseo   cultural ',
  dtstart: '2026-11-12T18:00:00+01:00',
  link: 'https://www.madrid.es/actividad',
  'event-location': 'Centro municipal',
  ...extra,
});

test('normalizes future events as external information, never joinable Nexo plans', () => {
  const result = normalizeMadridEvents({ '@graph': [future()] }, NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Paseo cultural');
  assert.equal(result[0].startsAt, '2026-11-12T17:00:00.000Z');
  assert.equal(result[0].inAppJoinEnabled, false);
  assert.equal(result[0].organizerVerifiedByNexo, false);
  assert.equal(result[0].registrationMode, 'external');
});

test('rejects outdated, incomplete, insecure and duplicate records', () => {
  const result = normalizeMadridEvents([
    future(),
    future({ title: 'Duplicado' }),
    future({ id: 124, dtstart: '2025-11-10T18:00:00Z' }),
    future({ id: 125, link: 'javascript:alert(1)' }),
    future({ id: 126, dtstart: 'not a date' }),
    future({ id: 127, title: '' }),
    future({ id: 128, link: 'http://www.madrid.es/no-https' }),
  ], NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].sourceId, '123');
});

test('rejects unknown feed structures instead of silently publishing zero entries', () => {
  assert.throws(() => readRows({ unexpected: [] }), /Formato desconocido/);
});

test('preserves time-unknown Madrid local dates without fabricating UTC times', () => {
  const events = normalizeMadridEvents({ '@graph': [future({
    id: 222,
    dtstart: '2026-11-12 00:00:00.0',
    link: 'http://www.madrid.es/actividad',
  })] }, NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventDate, '2026-11-12');
  assert.equal(events[0].startsAt, null);
  assert.equal(events[0].timeUnverified, true);
  assert.equal(events[0].sourceUrl, 'https://www.madrid.es/actividad');
});

test('rejects cleartext HTTP links from non-municipal hosts', () => {
  assert.equal(normalizeMadridEvents({ '@graph': [future({
    id: 333, link: 'http://example.org/unsafe',
  })] }, NOW).length, 0);
});
