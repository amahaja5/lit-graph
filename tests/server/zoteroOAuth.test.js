import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createZoteroOAuth, oauthHeader, zoteroMode } from '../../lib/zoteroOAuth.js';
import { createApp } from '../../server/src/index.js';
import { getAuditService } from '../../lib/setup.js';
import vercelHandler from '../../api/zotero/[action].js';

const origin = 'http://localhost:3001';
const env = {
  ZOTERO_MODE: 'oauth', ZOTERO_OAUTH_ORIGIN: origin,
  ZOTERO_CLIENT_KEY: 'app-key', ZOTERO_CLIENT_SECRET: 'app-secret', ZOTERO_SESSION_SECRET: 'a'.repeat(64),
};
const req = (method = 'GET', cookies = '', query = {}) => ({
  method, query, socket: { remoteAddress: '127.0.0.1' },
  headers: { host: 'localhost:3001', origin, cookie: cookies },
});
function res() {
  return {
    headers: {}, statusCode: 200,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(n) { this.statusCode = n; return this; },
    json(v) { this.body = v; return this; },
    send(v) { this.body = v; return this; },
  };
}
const cookie = (r, kind) => r.headers['set-cookie']?.find(c => c.startsWith(`litgraph-zotero-dev-${kind}=`))?.split(';')[0];
function provider() {
  const requests = [], consumed = new Set();
  let sequence = 0, revokeFailure = false;
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), ...options });
    if (url.endsWith('/oauth/request')) {
      sequence++;
      return new Response(`oauth_token=temp-${sequence}&oauth_token_secret=temp-secret-${sequence}&oauth_callback_confirmed=true`);
    }
    if (url.endsWith('/oauth/access')) {
      const token = options.headers.Authorization.match(/oauth_token="([^"]+)"/)[1];
      if (consumed.has(token)) return new Response('sensitive-provider-error', { status: 401 });
      consumed.add(token);
      const id = token.split('-')[1];
      return new Response(`oauth_token=private-${id}&oauth_token_secret=private-${id}&userID=${id}&username=academic-${id}`);
    }
    if (options.method === 'DELETE') return new Response(null, { status: revokeFailure ? 500 : 204 });
    throw Error('Unexpected request');
  };
  return { fetchImpl, requests, failRevoke() { revokeFailure = true; } };
}
async function login(oauth) {
  const start = res(); await oauth.handle(req('POST'), start, 'start');
  assert.equal(start.statusCode, 200);
  const token = new URL(start.body.authorizeUrl).searchParams.get('oauth_token');
  const callback = res();
  await oauth.handle(req('GET', cookie(start, 'flow'), { oauth_token: token, oauth_verifier: 'verifier' }), callback, 'callback');
  assert.equal(callback.statusCode, 200);
  return { start, callback, session: cookie(callback, 'session'), token };
}

test('OAuth signature encodes and signs callback and verifier with both secrets', () => {
  const header = oauthHeader('https://www.zotero.org/oauth/access', {
    clientKey: 'key', clientSecret: 'secret&', tokenSecret: 'temporary/',
    parameters: { oauth_nonce: 'fixed', oauth_timestamp: '123', oauth_token: 'token', oauth_verifier: 'a+b' },
  });
  const signature = decodeURIComponent(header.match(/oauth_signature="([^"]+)"/)[1]);
  const normalized = 'oauth_consumer_key=key&oauth_nonce=fixed&oauth_signature_method=HMAC-SHA1&oauth_timestamp=123&oauth_token=token&oauth_verifier=a%2Bb&oauth_version=1.0';
  const base = 'POST&https%3A%2F%2Fwww.zotero.org%2Foauth%2Faccess&' + encodeURIComponent(normalized);
  assert.equal(signature, createHmac('sha1', 'secret%26&temporary%2F').update(base).digest('base64'));
  assert.ok(!header.includes('temporary'));
});

test('complete handshake seals credentials and exposes only safe account status', async () => {
  const p = provider(), oauth = createZoteroOAuth({ env, fetchImpl: p.fetchImpl });
  const { start, callback, session } = await login(oauth);
  assert.equal(new URL(start.body.authorizeUrl).searchParams.get('write_access'), '0');
  assert.equal(new URL(start.body.authorizeUrl).searchParams.get('all_groups'), 'none');
  assert.match(p.requests[0].headers.Authorization, /oauth_callback="http%3A%2F%2Flocalhost%3A3001%2Fapi%2Fzotero%2Fcallback"/);
  assert.match(p.requests[1].headers.Authorization, /oauth_verifier="verifier"/);
  assert.match(callback.headers['set-cookie'].join(';'), /HttpOnly; SameSite=Lax/);
  assert.equal(callback.headers['cache-control'], 'no-store');
  assert.equal(callback.headers['referrer-policy'], 'no-referrer');
  assert.match(callback.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.ok(!JSON.stringify(callback).includes('private-1'));
  const status = oauth.status(req('GET', session));
  assert.equal(status.connected, true);
  assert.equal(status.userId, '1');
  assert.ok(!('apiKey' in status));
  assert.equal(oauth.session(req('GET', session)).apiKey, 'private-1');
  assert.equal(oauth.status(req()).connected, false);
});

test('callbacks reject missing, foreign, tampered, mismatched, expired and replayed state', async () => {
  let time = 1000000;
  const p = provider(), oauth = createZoteroOAuth({ env, fetchImpl: p.fetchImpl, now: () => time });
  const a = await login(oauth);
  for (const [cookies, token] of [['', a.token], [cookie(a.start, 'flow'), 'wrong'], [cookie(a.start, 'flow') + 'corrupt', a.token]]) {
    const r = res();
    await oauth.handle(req('GET', cookies, { oauth_token: token, oauth_verifier: 'x' }), r, 'callback');
    assert.equal(r.statusCode, 400);
  }
  const otherStart = res(); await oauth.handle(req('POST'), otherStart, 'start');
  const foreign = res(); await oauth.handle(req('GET', cookie(otherStart, 'flow'), { oauth_token: a.token, oauth_verifier: 'x' }), foreign, 'callback');
  assert.equal(foreign.statusCode, 400);
  const replay = res(); await oauth.handle(req('GET', cookie(a.start, 'flow'), { oauth_token: a.token, oauth_verifier: 'x' }), replay, 'callback');
  assert.equal(replay.statusCode, 400);
  assert.ok(!replay.body.includes('sensitive-provider-error'));
  time += 11 * 60 * 1000;
  const expired = res(); await oauth.handle(req('GET', cookie(otherStart, 'flow'), { oauth_token: 'temp-2', oauth_verifier: 'x' }), expired, 'callback');
  assert.equal(expired.statusCode, 400);
});

test('sessions are isolated, tamper resistant, expiring and bound to origin and access configuration', async () => {
  let time = 1000000;
  const p = provider(), oauth = createZoteroOAuth({ env, fetchImpl: p.fetchImpl, now: () => time });
  const a = await login(oauth), b = await login(oauth);
  assert.equal(oauth.session(req('GET', a.session)).userId, '1');
  assert.equal(oauth.session(req('GET', b.session)).userId, '2');
  assert.equal(oauth.session(req('GET', a.session + 'tampered')), null);
  assert.equal(oauth.session({ ...req('GET', a.session), headers: { host: 'attacker.test', cookie: a.session } }), null);
  const rotated = createZoteroOAuth({ env: { ...env, AUDIT_ACCESS_TOKEN: 'new-gate' }, now: () => time });
  assert.equal(rotated.session(req('GET', a.session)), null);
  const newKey = createZoteroOAuth({ env: { ...env, ZOTERO_SESSION_SECRET: 'b'.repeat(64) }, now: () => time });
  assert.equal(newKey.session(req('GET', a.session)), null);
  time += 8 * 60 * 60 * 1000;
  assert.equal(oauth.session(req('GET', a.session)), null);
});

test('mutations require POST, existing audit access, exact host and same origin', async () => {
  const p = provider(), oauth = createZoteroOAuth({ env, fetchImpl: p.fetchImpl });
  for (const request of [req('GET'), { ...req('POST'), headers: { host: 'localhost:3001' } }, { ...req('POST'), headers: { host: 'localhost:3001', origin: 'https://evil.test' } }, { ...req('POST'), socket: { remoteAddress: '192.0.2.1' } }]) {
    const r = res(); await oauth.handle(request, r, 'start');
    assert.ok(r.statusCode >= 400);
  }
  assert.equal(p.requests.length, 0);
  const status = res(); await oauth.handle(req(), status, 'status');
  assert.equal(status.statusCode, 200);
});

test('disconnect revokes only the browser credential and clears cookies after success', async () => {
  const p = provider(), oauth = createZoteroOAuth({ env, fetchImpl: p.fetchImpl });
  const a = await login(oauth), b = await login(oauth);
  const r = res(); await oauth.handle(req('POST', a.session), r, 'disconnect');
  assert.equal(r.statusCode, 200);
  assert.equal(p.requests.at(-1).url, 'https://api.zotero.org/keys/private-1');
  assert.equal(p.requests.at(-1).headers['Zotero-API-Key'], 'private-1');
  assert.ok(r.headers['set-cookie'].every(c => c.includes('Max-Age=0')));
  assert.equal(oauth.session(req('GET', b.session)).apiKey, 'private-2');
  p.failRevoke();
  const failure = res(); await oauth.handle(req('POST', b.session), failure, 'disconnect');
  assert.equal(failure.statusCode, 502);
  assert.equal(failure.headers['set-cookie'], undefined);
  assert.ok(!JSON.stringify(failure).includes('private-2'));
});

test('configuration fails closed, production uses Secure host-only cookies, local mode needs no OAuth', async () => {
  assert.equal(zoteroMode({}), 'local');
  assert.equal(zoteroMode({ VERCEL: '1' }), 'oauth');
  assert.equal(zoteroMode({ ZOTERO_MODE: 'web' }), 'oauth');
  for (const config of [{}, { ...env, ZOTERO_SESSION_SECRET: 'weak' }, { ...env, ZOTERO_OAUTH_ORIGIN: 'http://example.com' }, { ...env, ZOTERO_OAUTH_ORIGIN: 'https://example.com/path' }, { ...env, VERCEL: '1' }]) {
    assert.equal(createZoteroOAuth({ env: config }).status(req()).configured, false);
  }
  // Cookie policy can be checked without granting remote audit access: test a HTTPS loopback origin.
  const oauth = createZoteroOAuth({ env: { ...env, ZOTERO_OAUTH_ORIGIN: 'https://localhost:3001' }, fetchImpl: provider().fetchImpl });
  const r = res(), request = req('POST'); request.headers.origin = 'https://localhost:3001';
  await oauth.handle(request, r, 'start');
  assert.match(r.headers['set-cookie'][0], /^__Host-litgraph-zotero-flow=/);
  assert.match(r.headers['set-cookie'][0], /; Secure;/);
  assert.ok(!r.headers['set-cookie'][0].includes('Domain='));
});

test('audit services use request-specific OAuth credentials rather than legacy environment credentials', async (t) => {
  const before = { ...process.env }, originalFetch = globalThis.fetch;
  Object.assign(process.env, env, { ZOTERO_API_KEY: 'must-not-use', ZOTERO_USER_ID: '999' });
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k]; Object.assign(process.env, before); globalThis.fetch = originalFetch; });
  const oauth = createZoteroOAuth({ env, fetchImpl: provider().fetchImpl });
  const a = await login(oauth), b = await login(oauth), calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), headers: options.headers }); return new Response('[]'); };
  await getAuditService(req('GET', a.session)).status();
  await getAuditService(req('GET', b.session)).status();
  const anonymous = await getAuditService(req()).status();
  assert.deepEqual(calls.map(c => c.headers['Zotero-API-Key']), ['private-1', 'private-2']);
  assert.match(calls[0].url, /users\/1\/collections/);
  assert.match(calls[1].url, /users\/2\/collections/);
  assert.match(anonymous.zoteroError, /Connect your Zotero/);
});

test('Express and Vercel expose the shared OAuth handler without leaking credentials', async (t) => {
  const oauth = createZoteroOAuth({ env, fetchImpl: provider().fetchImpl });
  const server = createApp({ zoteroOAuth: oauth, serveFrontend: false }).listen(0, '127.0.0.1');
  await once(server, 'listening'); t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/zotero/status`);
  assert.equal(response.status, 200);
  const status = await response.json(); assert.equal(status.connected, false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = res(); await vercelHandler(req('GET', '', { action: 'status' }), result);
  assert.equal(result.statusCode, 200);
  assert.ok(!JSON.stringify(result.body).includes('app-secret'));
});
