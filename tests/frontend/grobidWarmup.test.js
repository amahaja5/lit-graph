import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrobidWarmer, WARM_INTERVAL_MS } from '../../frontend/src/citation-import/grobidWarmup.js';

function memoryStorage() { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; }

test('warms once per interval and shares an in-flight request', async () => {
  let calls = 0, t = 0;
  const warm = createGrobidWarmer({ storage: memoryStorage(), now: () => t, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, '/api/import/warm'); assert.equal(options.method, 'POST');
    return Response.json({ state: 'starting' });
  } });
  const [a, b] = [warm(), warm()];
  assert.equal(a, b); assert.deepEqual(await a, { state: 'starting' });
  t += WARM_INTERVAL_MS - 1; assert.equal(await warm(), null);
  t += 1; await warm();
  assert.equal(calls, 2);
});

test('a signed-out or failed warm-up does not block the next attempt', async () => {
  let calls = 0;
  const responses = [new Response('{}', { status: 401 }), Promise.reject(new Error('offline')), Response.json({ state: 'ready' })];
  const warm = createGrobidWarmer({ storage: memoryStorage(), fetchImpl: async () => { calls++; return responses.shift(); } });
  assert.equal(await warm(), null);
  assert.equal(await warm(), null);
  assert.deepEqual(await warm(), { state: 'ready' });
  assert.equal(calls, 3);
});
