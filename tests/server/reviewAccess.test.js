import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../../server/src/index.js';
import handler from '../../api/review/generate.js';

const paperIds = ['a'.repeat(40), 'b'.repeat(40)];
function withZoteroMode(t) {
  const previous = process.env.APP_AUTH_MODE;
  process.env.APP_AUTH_MODE = 'zotero';
  t.after(() => { if (previous === undefined) delete process.env.APP_AUTH_MODE; else process.env.APP_AUTH_MODE = previous; });
}

test('review drafts require a Zotero session before any model call (Express)', async t => {
  withZoteroMode(t);
  let generated = 0, signedIn = false;
  const oauth = { session: () => (signedIn ? { userId: '1', apiKey: 'k' } : null), assertOrigin() {} };
  const reviewService = { async generateReview() { generated++; return { references: [] }; } };
  const server = createApp({ zoteroOAuth: oauth, reviewService, serveFrontend: false, logger: { error() {}, debug() {} } }).listen(0, '127.0.0.1');
  await once(server, 'listening'); t.after(() => server.close());
  const post = () => fetch(`http://127.0.0.1:${server.address().port}/api/review/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paperIds, mode: 'html', outputShape: 'structured_synthesis' }) });

  const denied = await post();
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error.code, 'app_signin_required');
  assert.equal(generated, 0, 'Anthropic is never reached without a session');

  signedIn = true;
  assert.equal((await post()).status, 200);
  assert.equal(generated, 1);
});

test('review drafts require a Zotero session on the Vercel function too', async t => {
  withZoteroMode(t);
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: 'POST', headers: { host: 'example.test', origin: 'https://example.test' }, body: { paperIds } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error.code, 'app_signin_required');
});
