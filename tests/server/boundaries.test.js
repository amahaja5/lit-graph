import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../../server/src/index.js';
import { createPaperHandler } from '../../lib/papers/handler.js';
import { parseObjectBody } from '../../lib/http/body.js';
import { parseAuditCheckRequest } from '../../lib/audit/request.js';
import { requireAppAccess } from '../../lib/auth/appAccess.js';
import { sendError } from '../../lib/http/errors.js';
import { ProxyHttpError } from '../../lib/shared/errors.js';
import deployedPaper from '../../api/paper/[paperId].js';
import deployedAudit from '../../api/audit/[action].js';

function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('paper validation rejects malformed inputs before resolving or fetching', async () => {
  let calls = 0;
  const unexpected = () => { calls++; throw new Error('must not run'); };
  for (const kind of ['paper', 'citations', 'references']) {
    const handler = createPaperHandler(kind, { client: { getPaper: unexpected, getCitations: unexpected, getReferences: unexpected }, resolver: { resolveSeedPaperId: unexpected } });
    for (const [id, query] of [[{}, {}], [['a', 'b'], {}], ['a', { fields: {} }], ['a', { fields: ['a', 'b'] }], ['a', { unknown: 'x' }], ['a', { offset: '1e2' }], ['a', { limit: '0x10' }]]) {
      const res = response();
      await handler({ method: 'GET' }, res, id, query);
      assert.equal(res.statusCode, 400);
    }
  }
  assert.equal(calls, 0);
});

test('object JSON boundary rejects null, arrays, primitives and malformed JSON', () => {
  for (const body of ['null', '[]', '1', '"{}"', '{', null, [], 1]) {
    assert.throws(() => parseObjectBody(body), error => error.status === 400);
  }
  assert.deepEqual(parseObjectBody('{"ok":true}'), { ok: true });
});

test('audit validates reference records before accessing their IDs', () => {
  assert.throws(() => parseAuditCheckRequest({ claim: { id: 'c', text: 'A sufficiently long claim', referenceIds: ['r'] }, references: [null] }), error => error.status === 400);
});

test('access control consistently uses the injected environment', () => {
  const req = { method: 'POST', headers: { authorization: 'Bearer injected' } };
  assert.doesNotThrow(() => requireAppAccess(req, { env: { AUDIT_ACCESS_TOKEN: 'injected' } }));
  assert.throws(() => requireAppAccess(req, { env: { AUDIT_ACCESS_TOKEN: 'different' } }), error => error.status === 401);
});

test('shared errors preserve expected status and retry headers, hide unexpected details', () => {
  const res = response();
  sendError(res, new ProxyHttpError({ status: 429, code: 'rate_limited', retryAfterSeconds: 3 }));
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['Retry-After'], '3');
  sendError(res, new Error('private provider details'));
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.message, 'Unexpected server error');
});

test('Express and Vercel return the same boundary errors', async t => {
  const server = createApp({ serveFrontend: false, logger: { error() {} } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const local = await fetch(`${base}/api/paper/a?fields[bad]=x`);
  const deployed = response();
  await deployedPaper({ method: 'GET', query: { paperId: 'a', fields: { bad: 'x' } } }, deployed);
  assert.equal(local.status, deployed.statusCode);
  assert.deepEqual(await local.json(), deployed.body);
  const malformed = await fetch(`${base}/api/review/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const audit = response();
  await deployedAudit({ method: 'POST', query: { action: 'extract' }, headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' }, body: 'null' }, audit);
  assert.equal(audit.statusCode, 400);
});

test('audit model boundary rejects malformed records and preserves inventory limits', async () => {
  const { validateInventory, validateAssessment } = await import('../../lib/audit/assessment.js');
  const manuscript = { text: 'A sufficiently long claim.' };
  assert.throws(() => validateInventory({ references: [null], claims: [] }, manuscript), error => error.code === 'audit_invalid_response');
  assert.throws(() => validateInventory({ references: [], claims: [null] }, manuscript), error => error.code === 'audit_invalid_response');
  assert.throws(() => validateInventory({ references: Array(81).fill({}), claims: [] }, manuscript), error => error.status === 400);
  assert.throws(() => validateAssessment({ assessments: [null] }, {}, []), error => error.code === 'audit_invalid_response');
});
