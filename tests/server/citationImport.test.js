import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createCitationImport, validateReferences, crossrefRecord, importKey } from '../../lib/citation-import/citationImport.js';
import { handleCitationImport } from '../../lib/citation-import/citationImportHandler.js';
import handler from '../../api/import/[action].js';
import { createApp } from '../../server/src/index.js';

const importId = '12345678-1234-1234-1234-123456789012';
const session = { apiKey: 'private-key', userId: '123' };
const doi = '10.1038/171737a0';
const work = { DOI: doi, type: 'journal-article', title: ['Molecular Structure'], author: [{ given: 'J. D.', family: 'Watson' }], issued: { 'date-parts': [[1953]] }, 'container-title': ['Nature'] };
const reference = 'Watson (1953). Molecular Structure. DOI: 10.1038/171737a0.';
const model = { configured: true, async json() { return { references: [{ bibliography: reference, title: 'Molecular Structure', doi }] }; } };
function provider({ existing = false, failItem = false, loseResponse = false, conflict = false } = {}) {
  const collections = new Map(), items = new Map(), calls = [];
  if (existing) items.set('EXIST234', { key: 'EXIST234', version: 4, data: { DOI: doi.toUpperCase(), collections: ['OTHER234'], title: 'Curated title' } });
  let lost = false;
  return { calls, items, collections, fetchImpl: async (url, options = {}) => {
    const u = new URL(url); calls.push({ url, options });
    if (u.host === 'api.crossref.org') return Response.json({ message: work });
    assert.equal(options.headers['Zotero-API-Key'], 'private-key');
    const route = u.pathname.replace('/users/123/', '');
    const store = route.startsWith('collections') ? collections : items;
    if (options.method === 'POST') {
      const data = JSON.parse(options.body)[0];
      if (failItem && route === 'items') return Response.json({ failed: { 0: { code: 400 } } });
      assert.equal(data.version, 0);
      const record = { key: data.key, version: 1, data };
      store.set(data.key, record);
      if (loseResponse && route === 'items' && !lost) { lost = true; throw Error('lost response'); }
      return Response.json({ successful: { 0: record }, failed: {} });
    }
    if (options.method === 'PATCH') {
      if (conflict) return new Response('', { status: 412 });
      const record = store.get(route.split('/')[1]);
      assert.equal(options.headers['If-Unmodified-Since-Version'], String(record.version));
      Object.assign(record.data, JSON.parse(options.body));
      return new Response(null, { status: 204 });
    }
    if (route === 'items') return Response.json([...items.values()]);
    const record = store.get(route.split('/')[1]);
    return record ? Response.json(record) : new Response('', { status: 404 });
  } };
}

test('extraction requires explicit consent, anchors bibliography and rejects fabricated references', async () => {
  const service = createCitationImport({ model });
  await assert.rejects(service.extract({ text: reference }), /Confirm/);
  const result = await service.extract({ text: reference, consent: true });
  assert.equal(result.references[0].doi, doi);
  assert.throws(() => validateReferences({ references: [{ bibliography: 'Invented work' }] }, { text: reference }), /could not be located/);
  assert.throws(() => validateReferences({ references: Array(81).fill({ bibliography: reference }) }, { text: reference }), /80 references/);
});
test('lookup uses only fixed Crossref hosts and returns candidates without choosing a work', async () => {
  const calls = [];
  const service = createCitationImport({ fetchImpl: async (url) => { calls.push(url); return Response.json({ message: url.includes('?') ? { items: [work] } : work }); } });
  const exact = await service.lookup({ doi: `https://doi.org/${doi}` });
  assert.equal(exact.match, 'doi'); assert.equal(exact.candidates[0].doi, doi);
  const fuzzy = await service.lookup({ bibliography: reference });
  assert.equal(fuzzy.match, 'candidate'); assert.equal(fuzzy.candidates.length, 1);
  assert.ok(calls.every(url => new URL(url).host === 'api.crossref.org'));
  await assert.rejects(service.lookup({ doi: 'https://attacker.example/secrets' }), /valid DOI/);
});
test('metadata mapping preserves DOI on books and uses valid report fields', () => {
  const book = crossrefRecord({ ...work, type: 'book' });
  assert.equal(book.item.itemType, 'book'); assert.equal(book.item.extra, `DOI: ${doi}`); assert.ok(!('DOI' in book.item));
  const report = crossrefRecord({ ...work, type: 'report', publisher: 'Institute' });
  assert.equal(report.item.institution, 'Institute'); assert.ok(!('publisher' in report.item));
});
test('collection and item retries reuse predetermined keys after an uncertain response', async () => {
  const p = provider({ loseResponse: true }), service = createCitationImport({ session, fetchImpl: p.fetchImpl });
  const a = await service.collection({ importId, name: 'Pilot' });
  const b = await service.collection({ importId, name: 'Pilot' });
  assert.equal(a.key, b.key); assert.equal(p.collections.size, 1);
  await assert.rejects(service.save({ importId, doi }), /could not be reached/);
  const retried = await service.save({ importId, doi });
  assert.equal(retried.reused, true); assert.equal(p.items.size, 1);
  assert.deepEqual([...p.items.values()][0].data.collections, [a.key]);
  assert.notEqual(importKey('456', importId, 'collection'), a.key);
});
test('existing exact DOI items preserve metadata and all prior collection memberships', async () => {
  const p = provider({ existing: true }), service = createCitationImport({ session, fetchImpl: p.fetchImpl });
  const collection = await service.collection({ importId, name: 'Pilot' });
  const result = await service.save({ importId, doi });
  assert.equal(result.key, 'EXIST234'); assert.equal(result.reused, true);
  assert.deepEqual(p.items.get(result.key).data.collections, ['OTHER234', collection.key]);
  assert.equal(p.items.get(result.key).data.title, 'Curated title');
  assert.equal(p.items.size, 1);
});
test('partial write failure and concurrent library edits cannot appear as successful saves', async () => {
  for (const config of [{ failItem: true }, { existing: true, conflict: true }]) {
    const p = provider(config), service = createCitationImport({ session, fetchImpl: p.fetchImpl });
    await service.collection({ importId, name: 'Pilot' });
    await assert.rejects(service.save({ importId, doi }), /did not save|library changed/);
  }
  const anonymous = createCitationImport();
  await assert.rejects(anonymous.collection({ importId, name: 'Pilot' }), /Connect Zotero/);
});
function response() {
  return { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
}
const request = (method = 'GET') => ({ method, query: { action: 'status' }, headers: { host: 'localhost:3001', origin: 'http://localhost:3001' }, socket: { remoteAddress: '127.0.0.1' } });
test('shared and Vercel handlers reject wrong methods, remote access, malformed bodies, and foreign-origin writes', async () => {
  const status = response(); await handler(request(), status); assert.equal(status.statusCode, 200); assert.equal(status.headers['Cache-Control'], 'no-store');
  const wrong = response(); await handleCitationImport(request(), wrong, 'lookup'); assert.equal(wrong.statusCode, 405);
  const remote = response(); await handler({ ...request(), socket: { remoteAddress: '192.0.2.1' } }, remote); assert.equal(remote.statusCode, 401);
  const malformed = response(); await handleCitationImport({ ...request('POST'), body: '{' }, malformed, 'lookup'); assert.equal(malformed.statusCode, 400);
  let saved = false;
  const origin = response(); await handleCitationImport(request('POST'), origin, 'save', { oauth: { assertOrigin() { throw Error('foreign origin'); } }, service: { save() { saved = true; } } });
  assert.equal(saved, false); assert.ok(origin.statusCode >= 400);
});
test('Express routes carry upload consent, lookup and save responses through the same service', async t => {
  const seen = [];
  const service = { status: () => ({ modelConfigured: true }), extract: body => { seen.push(body); return { references: [{ bibliography: reference }] }; }, lookup: () => ({ candidates: [crossrefRecord(work)] }) };
  const server = createApp({ citationImport: service, serveFrontend: false }).listen(0, '127.0.0.1');
  await once(server, 'listening'); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/import/`;
  const res = await fetch(base + 'extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: reference, consent: true }) });
  assert.equal(res.status, 200); assert.equal((await res.json()).references.length, 1); assert.equal(seen[0].consent, true);
  const lookup = await fetch(base + 'lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doi }) });
  assert.equal((await lookup.json()).candidates[0].doi, doi);
});
