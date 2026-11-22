import test from 'node:test';
import assert from 'node:assert/strict';
import { createCitationImport, semanticScholarItem } from '../../lib/citation-import/citationImport.js';

const session = { apiKey: 'k', userId: '123' };
const importId = '12345678-1234-1234-1234-123456789012';
const paperId = 'a'.repeat(40);
const work = { DOI: '10.1038/171737a0', type: 'journal-article', title: ['Molecular Structure'], author: [{ given: 'J. D.', family: 'Watson' }], issued: { 'date-parts': [[1953]] }, 'container-title': ['Nature'] };

function zotero({ crossref = true, existing = null } = {}) {
  const posted = [], patched = [], hosts = [];
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url); hosts.push(u.host);
    if (u.host === 'api.crossref.org') return crossref ? Response.json({ message: work }) : new Response('', { status: 404 });
    if (options.method === 'POST') { posted.push(JSON.parse(options.body)[0]); return Response.json({ successful: { 0: {} } }); }
    if (options.method === 'PATCH') { patched.push(u.pathname); return new Response(null, { status: 204 }); }
    if (u.pathname.includes('/collections/')) return Response.json({ data: { name: 'Reading list' } });
    if (u.pathname.endsWith('/items')) return Response.json(existing ? [existing] : []);
    return new Response('', { status: 404 });
  };
  return { posted, patched, hosts, fetchImpl };
}
const s2 = paper => ({ calls: [], async getPaper(id, query) { this.calls.push({ id, query }); return paper; } });

test('cart papers with a DOI are saved from canonical Crossref metadata', async () => {
  const z = zotero(), client = s2({ externalIds: { DOI: '10.1038/171737A0' }, title: 'Browser-irrelevant title' });
  const service = createCitationImport({ session, s2: client, fetchImpl: z.fetchImpl, grobid: { configured: false }, env: {} });
  const result = await service.work({ importId, paperId });
  assert.equal(result.source, 'crossref'); assert.equal(result.reused, false);
  assert.equal(client.calls[0].id, paperId);
  assert.equal(z.posted[0].title, 'Molecular Structure'); assert.equal(z.posted[0].DOI, '10.1038/171737a0');
});

test('cart papers without a DOI are saved from Semantic Scholar metadata, and resaving reuses the item', async () => {
  const paper = { externalIds: {}, title: 'A Workshop Paper on Graphs', authors: [{ name: 'Ada M. Lovelace' }, { name: 'Plato' }], year: 2021, venue: 'GraphWS', publicationTypes: ['Conference'] };
  const z = zotero();
  const service = createCitationImport({ session, s2: s2(paper), fetchImpl: z.fetchImpl, grobid: { configured: false }, env: {} });
  const result = await service.work({ importId, paperId });
  assert.equal(result.source, 'semanticscholar');
  assert.ok(!z.hosts.includes('api.crossref.org'), 'no DOI, so Crossref is not called');
  const item = z.posted[0];
  assert.equal(item.itemType, 'conferencePaper'); assert.equal(item.proceedingsTitle, 'GraphWS');
  assert.deepEqual(item.creators, [{ creatorType: 'author', firstName: 'Ada M.', lastName: 'Lovelace' }, { creatorType: 'author', name: 'Plato' }]);
  assert.match(item.extra, new RegExp(`^Semantic Scholar: ${paperId}$`, 'm'));
  assert.equal(item.url, `https://www.semanticscholar.org/paper/${paperId}`);

  const existing = { key: 'OLDITEM2', version: 3, data: { extra: `Semantic Scholar: ${paperId}`, collections: ['OTHER234'] } };
  const again = zotero({ existing });
  const reused = await createCitationImport({ session, s2: s2(paper), fetchImpl: again.fetchImpl, grobid: { configured: false }, env: {} }).work({ importId, paperId });
  assert.equal(reused.reused, true); assert.equal(reused.key, 'OLDITEM2');
  assert.equal(again.posted.length, 0); assert.equal(again.patched.length, 1, 'added to the collection without changing metadata');
});

test('a DOI that Crossref cannot resolve falls back to Semantic Scholar metadata with the DOI kept', async () => {
  const z = zotero({ crossref: false });
  const paper = { externalIds: { DOI: '10.5555/unindexed' }, title: 'Indexed Elsewhere', authors: [], year: 2019, journal: { name: 'Some Journal', volume: '4' } };
  const result = await createCitationImport({ session, s2: s2(paper), fetchImpl: z.fetchImpl, grobid: { configured: false }, env: {} }).work({ importId, paperId });
  assert.equal(result.source, 'semanticscholar');
  assert.equal(z.posted[0].itemType, 'journalArticle'); assert.equal(z.posted[0].DOI, '10.5555/unindexed'); assert.equal(z.posted[0].volume, '4');
});

test('cart saves require a signed-in session and a valid Semantic Scholar ID', async () => {
  const service = createCitationImport({ session, s2: s2({}), grobid: { configured: false }, env: {} });
  await assert.rejects(service.work({ importId, paperId: '../items' }), /Invalid Semantic Scholar paper ID/);
  await assert.rejects(createCitationImport({ session: null, s2: s2({}), grobid: { configured: false }, env: {} }).work({ importId, paperId }), /Connect Zotero/);
  assert.throws(() => semanticScholarItem({ title: '' }, paperId), /no title/);
});
