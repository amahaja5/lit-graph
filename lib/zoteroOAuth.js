import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ProxyHttpError, sendError } from './errors.js';
import { requireAuditAccess } from './auditAccess.js';

const REQUEST_URL = 'https://www.zotero.org/oauth/request';
const ACCESS_URL = 'https://www.zotero.org/oauth/access';
const AUTHORIZE_URL = 'https://www.zotero.org/oauth/authorize';
const SESSION_SECONDS = 8 * 60 * 60;
const FLOW_SECONDS = 10 * 60;
const encode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const fail = (message, status = 400) => new ProxyHttpError({ code: 'zotero_connection_error', message, status });
const localHostname = (hostname) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

// OAuth 1.0a HMAC-SHA1: all handshake parameters are signed and sent in a header.
export function oauthHeader(url, { clientKey, clientSecret, tokenSecret = '', parameters = {} }) {
  const fields = {
    oauth_consumer_key: clientKey,
    oauth_nonce: randomBytes(24).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    ...parameters,
  };
  const normalized = Object.entries(fields).map(([k, v]) => [encode(k), encode(v)])
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${k}=${v}`).join('&');
  const base = ['POST', encode(url), encode(normalized)].join('&');
  fields.oauth_signature = createHmac('sha1', `${encode(clientSecret)}&${encode(tokenSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.entries(fields).map(([k, v]) => `${encode(k)}="${encode(v)}"`).join(', ');
}

export function zoteroMode(env = process.env) {
  return env.ZOTERO_MODE === 'local' || (!env.ZOTERO_MODE && !env.VERCEL) ? 'local' : 'oauth';
}

export function createZoteroOAuth({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let origin;
  try {
    const u = new URL(env.ZOTERO_OAUTH_ORIGIN);
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/') throw Error();
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && localHostname(u.hostname) && !env.VERCEL)) throw Error();
    origin = u.origin;
  } catch { /* Missing/invalid configuration is exposed as setup status, never secrets. */ }
  const key = /^[a-f\d]{64}$/i.test(env.ZOTERO_SESSION_SECRET || '') ? Buffer.from(env.ZOTERO_SESSION_SECRET, 'hex') : null;
  const configured = Boolean(origin && key && env.ZOTERO_CLIENT_KEY && env.ZOTERO_CLIENT_SECRET);
  const secure = origin?.startsWith('https:');
  const prefix = secure ? '__Host-litgraph-zotero' : 'litgraph-zotero-dev';
  const gate = createHmac('sha256', key || 'unconfigured').update(env.AUDIT_ACCESS_TOKEN || '').digest('hex');

  function ready() {
    if (!configured) throw fail('Zotero sign-in is not configured. The server needs Zotero OAuth app credentials, its public origin, and a session encryption secret.', 503);
  }
  function cookieValue(req, purpose) {
    return String(req.headers.cookie || '').split(';').map(s => s.trim())
      .find(s => s.startsWith(`${prefix}-${purpose}=`))?.split('=').slice(1).join('=');
  }
  function seal(value, purpose, seconds) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`${origin}:${purpose}`));
    const plain = JSON.stringify({ ...value, gate, exp: now() + seconds * 1000 });
    return Buffer.concat([iv, cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64url');
  }
  function unseal(req, purpose) {
    if (!configured) return null;
    try {
      const raw = cookieValue(req, purpose);
      if (!raw || raw.length > 3800) return null;
      const bytes = Buffer.from(raw, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(`${origin}:${purpose}`));
      decipher.setAuthTag(bytes.subarray(-16));
      const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString());
      return value.exp > now() && value.gate === gate ? value : null;
    } catch { return null; }
  }
  function cookie(res, purpose, value, seconds) {
    const cookies = res.getHeader('Set-Cookie') || [];
    res.setHeader('Set-Cookie', [...(Array.isArray(cookies) ? cookies : [cookies]),
      `${prefix}-${purpose}=${value}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${seconds}`]);
  }
  function sameHost(req) {
    ready();
    if (req.headers.host !== new URL(origin).host) throw fail('Open LitGraph at its configured Zotero sign-in address.', 403);
  }
  function sameOrigin(req) {
    sameHost(req);
    if (req.headers.origin !== origin) throw fail('Zotero connection changes must come from this app.', 403);
  }
  function session(req) {
    if (!configured || req.headers.host !== new URL(origin).host) return null;
    const s = unseal(req, 'session');
    return s && /^[0-9]+$/.test(s.userId) && typeof s.apiKey === 'string' ? s : null;
  }
  async function exchange(url, parameters, tokenSecret = '') {
    try {
      const response = await fetchImpl(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: oauthHeader(url, { clientKey: env.ZOTERO_CLIENT_KEY, clientSecret: env.ZOTERO_CLIENT_SECRET, tokenSecret, parameters }) },
      });
      if (!response.ok) throw Error();
      const text = await response.text();
      if (text.length > 10000) throw Error();
      return new URLSearchParams(text);
    } catch { throw fail('Zotero authorization could not be completed. Try connecting again.', 502); }
  }
  async function revoke(apiKey) {
    try {
      const response = await fetchImpl(`https://api.zotero.org/keys/${encode(apiKey)}`, {
        method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { 'Zotero-API-Key': apiKey, 'Zotero-API-Version': '3' },
      });
      // Already revoked/deleted credentials are disconnected too.
      if (![200, 204, 401, 404].includes(response.status)) throw Error();
    } catch { throw fail('Could not revoke the Zotero connection. Retry Disconnect, or revoke LitGraph in Zotero account settings.', 502); }
  }
  function finish(res, success) {
    const nonce = randomBytes(18).toString('base64');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);
    // No provider response, identity, key, verifier or exception is rendered.
    res.status(success ? 200 : 400).send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Zotero connection</title><p>${success ? 'Zotero connected.' : 'Zotero connection was cancelled, expired, or could not be completed.'} You can close this window and return to LitGraph.</p><script nonce="${nonce}">history.replaceState(null,'','/api/zotero/callback');if(window.opener){window.opener.postMessage({type:'litgraph-zotero',success:${success}},location.origin);window.close();}</script></html>`);
  }
  return {
    session,
    assertOrigin: sameOrigin,
    status(req) {
      const s = session(req);
      return { configured, mode: zoteroMode(env), connected: Boolean(s), writeRequested: s?.writeRequested === true, userId: s?.userId || '', username: s?.username || '', expiresAt: s?.exp || null };
    },
    async handle(req, res, action) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      try {
        const methods = { status: 'GET', start: 'POST', callback: 'GET', disconnect: 'POST' };
        if (!Object.hasOwn(methods, action)) throw fail('Unknown Zotero action.', 404);
        if (req.method !== methods[action]) { res.setHeader('Allow', methods[action]); return res.status(405).json({ error: { message: 'Method not allowed' } }); }
        if (action !== 'callback') requireAuditAccess(req);
        if (action === 'status') return res.json(this.status(req));
        if (action === 'start') {
          sameOrigin(req);
          if (session(req)) throw fail('Disconnect the current Zotero account before connecting another.');
          const data = await exchange(REQUEST_URL, { oauth_callback: `${origin}/api/zotero/callback` });
          const token = data.get('oauth_token'), secret = data.get('oauth_token_secret');
          if (!token || token.length > 256 || !secret || secret.length > 256 || data.get('oauth_callback_confirmed') !== 'true') throw fail('Zotero did not confirm the sign-in callback.', 502);
          const writeRequested = req.body?.write === true;
          cookie(res, 'flow', seal({ token, secret, writeRequested }, 'flow', FLOW_SECONDS), FLOW_SECONDS);
          const url = new URL(AUTHORIZE_URL);
          Object.entries({ oauth_token: token, name: writeRequested ? 'LitGraph citation import' : 'LitGraph citation audit', library_access: '1', notes_access: '0', write_access: writeRequested ? '1' : '0', all_groups: 'none' }).forEach(([k, v]) => url.searchParams.set(k, v));
          return res.json({ authorizeUrl: url.href });
        }
        if (action === 'callback') {
          sameHost(req);
          const flow = unseal(req, 'flow');
          cookie(res, 'flow', '', 0);
          const token = req.query.oauth_token, verifier = req.query.oauth_verifier;
          if (!flow || req.query.denied || typeof token !== 'string' || typeof verifier !== 'string' || verifier.length > 512 || !verifier || token.length !== flow.token.length || !timingSafeEqual(Buffer.from(token), Buffer.from(flow.token))) throw fail('Invalid or expired Zotero authorization.');
          const data = await exchange(ACCESS_URL, { oauth_token: token, oauth_verifier: verifier }, flow.secret);
          const apiKey = data.get('oauth_token_secret'), userId = data.get('userID');
          if (!apiKey || apiKey.length > 256 || !/^[0-9]+$/.test(userId || '')) throw fail('Zotero returned incomplete account details.', 502);
          cookie(res, 'session', seal({ apiKey, userId, writeRequested: flow.writeRequested === true, username: (data.get('username') || '').slice(0, 150) }, 'session', SESSION_SECONDS), SESSION_SECONDS);
          return finish(res, true);
        }
        sameOrigin(req);
        const s = session(req);
        if (s) await revoke(s.apiKey);
        cookie(res, 'session', '', 0);
        cookie(res, 'flow', '', 0);
        return res.json({ disconnected: true });
      } catch (error) {
        if (action === 'callback') return finish(res, false);
        // Never expose upstream response bodies or fetch exceptions containing credential URLs.
        sendError(res, error instanceof ProxyHttpError ? error : fail('Zotero connection failed. Please try again.', 502));
      }
    },
  };
}
