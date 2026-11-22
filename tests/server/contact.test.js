import test from 'node:test';
import assert from 'node:assert/strict';
import { contactEmail, handleContact } from '../../lib/contact.js';

const res = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; } });

test('access requests use ACCESS_REQUEST_EMAIL, then the Crossref contact, and ignore invalid values', () => {
  assert.equal(contactEmail({ ACCESS_REQUEST_EMAIL: 'access@example.org', CROSSREF_MAILTO: 'ops@example.org' }), 'access@example.org');
  assert.equal(contactEmail({ CROSSREF_MAILTO: ' ops@example.org ' }), 'ops@example.org');
  assert.equal(contactEmail({ ACCESS_REQUEST_EMAIL: 'not an email', CROSSREF_MAILTO: 'ops@example.org' }), 'ops@example.org');
  assert.equal(contactEmail({}), '');
});

test('the contact endpoint returns the address, 404s when none is set, and only allows GET', () => {
  const ok = res(); handleContact({ method: 'GET' }, ok, { env: { CROSSREF_MAILTO: 'ops@example.org' } });
  assert.deepEqual(ok.body, { email: 'ops@example.org' });
  const none = res(); handleContact({ method: 'GET' }, none, { env: {} });
  assert.equal(none.statusCode, 404);
  const post = res(); handleContact({ method: 'POST' }, post, { env: { CROSSREF_MAILTO: 'ops@example.org' } });
  assert.equal(post.statusCode, 405);
});
