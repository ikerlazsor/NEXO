const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchMadridCandidates, DATA_URL } = require('../scripts/madrid-events-fetch.cjs');

const now = new Date('2026-11-06T00:00:00Z');
function mockResponse(payload) {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return {
    ok: true,
    headers: { get: () => String(bytes.byteLength) },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

test('fetcher only requests official municipal feed and stays read-only', async () => {
  let requestUrl = '';
  const fakeFetch = async url => {
    requestUrl = url;
    return mockResponse({ '@graph': [{
      id: 9,
      title: 'Encuentro cultural',
      dtstart: '2026-11-25T18:30:00+01:00',
      link: 'https://www.madrid.es/actividad',
    }] });
  };
  const candidates = await fetchMadridCandidates(fakeFetch, now);
  assert.equal(requestUrl, DATA_URL);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].registrationMode, 'external');
  assert.equal(candidates[0].inAppJoinEnabled, false);
});

test('fetcher fails on HTTP errors and oversized municipal response', async () => {
  await assert.rejects(
    () => fetchMadridCandidates(async () => ({ ok: false, status: 503 }), now),
    /HTTP 503/,
  );
  await assert.rejects(
    () => fetchMadridCandidates(async () => ({
      ok: true,
      headers: { get: () => String(10_000_000) },
    }), now),
    /size limit/,
  );
});
