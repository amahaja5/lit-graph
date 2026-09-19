import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const evidenceHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createTypeSafeClient({
  apiKey = process.env.TYPESAFE_API_KEY,
  model = process.env.TYPESAFE_MODEL || 'jev-1.13.0',
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
  ttlMs = 300_000,
  maxEntries = 128,
  onMetric = () => {},
} = {}) {
  const cache = new Map();
  let active = 0;
  const queue = [];
  async function acquire(signal) {
    signal.throwIfAborted();
    if (active < 2) { active++; return; }
    await new Promise((resolve, reject) => {
      const entry = { resolve: () => { signal.removeEventListener('abort', abort); resolve(); } };
      const abort = () => {
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      queue.push(entry);
    });
  }
  function release() {
    const next = queue.shift();
    if (next) next.resolve();
    else active--;
  }
  function metric(value) { try { onMetric(value); } catch { /* telemetry must not break evidence */ } }

  return {
    configured: Boolean(apiKey), model,
    async evaluate({ state, questions, signal, rubricVersion = '1' }) {
      if (!apiKey) throw new Error('TypeSafe is not configured');
      const request = { model, state, questions };
      // A conservative byte budget leaves ample room below the documented token limits.
      if (Buffer.byteLength(JSON.stringify(request)) > 24_000) throw new Error('TypeSafe request exceeds evidence budget');
      const key = evidenceHash({ request, rubricVersion });
      signal?.throwIfAborted();
      const hit = cache.get(key);
      if (hit && hit.expires > Date.now()) {
        metric({ cacheHit: true, model: hit.value.model, rubricVersion });
        return { ...structuredClone(hit.value), cacheHit: true, elapsedMs: 0 };
      }
      cache.delete(key);
      const deadline = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const started = Date.now();
      await acquire(combined);
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          combined.throwIfAborted();
          const response = await fetchImpl('https://api.typesafe.ai/v1/systemone', {
            method: 'POST', signal: combined,
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify(request),
          });
          if ([429, 500, 502, 503, 504, 529].includes(response.status) && attempt < 2) {
            const retry = response.headers?.get('retry-after');
            const wait = retry && Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 500 * 2 ** attempt;
            await response.body?.cancel();
            await delay(Math.max(0, wait), undefined, { signal: combined });
            continue;
          }
          if (!response.ok) throw new Error(`TypeSafe request failed (${response.status})`);
          const value = await response.json();
          validateAnswers(value, questions);
          combined.throwIfAborted();
          const result = { ...value, elapsedMs: Date.now() - started };
          for (const [oldKey, old] of cache) if (old.expires <= Date.now()) cache.delete(oldKey);
          if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
          cache.set(key, { expires: Date.now() + ttlMs, value: structuredClone(result) });
          metric({ model: value.model, rubricVersion, elapsedMs: result.elapsedMs, usage: value.usage, attempts: attempt + 1 });
          return result;
        }
      } finally { release(); }
    },
  };
}

export function validateAnswers(value, questions) {
  const fail = () => { throw new Error('TypeSafe returned an invalid typed response'); };
  if (!value || typeof value.model !== 'string' || !value.model || !value.answers || Array.isArray(value.answers)) fail();
  const ids = Object.keys(questions);
  if (Object.keys(value.answers).length !== ids.length) fail();
  for (const id of ids) {
    const q = questions[id], a = value.answers[id];
    if (!a || a.type !== q.type) fail();
    if (q.type === 'noul') { if (!unit(a.noul)) fail(); continue; }
    if (!unit(a.confidence) || !a.probabilities) fail();
    const labels = q.type === 'choice' ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
    if (Object.keys(a.probabilities).length !== labels.length || labels.some(k => !unit(a.probabilities[k]))) fail();
    if (Math.abs(Object.values(a.probabilities).reduce((s, n) => s + n, 0) - 1) > 0.03) fail();
    if (q.type === 'choice' && !labels.includes(a.choice)) fail();
    if (q.type === 'score' && (!Number.isFinite(a.score) || a.score < 0 || a.score > q.criteria.length - 1)) fail();
  }
}
const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
