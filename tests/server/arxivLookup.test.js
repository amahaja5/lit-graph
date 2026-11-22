import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { arxivId, arxivDoi, isArxivDoi } from '../../lib/citation-import/arxiv.js';
import { createCitationImport } from '../../lib/citation-import/citationImport.js';
import { parseGrobidReferences } from '../../lib/citation-import/grobid.js';

const userExample = 'Esben Jannik Bjerrum. SMILES enumeration as data augmentation for neural network modeling of molecules. arXiv preprint arXiv:1703.07076, 2017. URL https://arxiv.org/abs/1703. 07076.';
const datacite = { data: { attributes: { doi: '10.48550/arxiv.1703.07076', titles: [{ title: 'SMILES Enumeration as Data Augmentation for Neural Network Modeling of Molecules' }], creators: [{ givenName: 'Esben Jannik', familyName: 'Bjerrum', name: 'Bjerrum, Esben Jannik' }], publicationYear: 2017 } } };
const crossrefHeaders = { 'x-rate-limit-limit': '3', 'x-rate-limit-interval': '1s', 'x-concurrency-limit': '3' };

test('arXiv IDs are found in references, URLs (even wrapped), idnos and DOIs, but never without an arXiv marker', () => {
  assert.equal(arxivId(userExample), '1703.07076');
  assert.equal(arxivId('URL https://arxiv.org/abs/1703. 07076.'), '1703.07076');
  assert.equal(arxivId('arXiv:1705.03122v2'), '1705.03122');
  assert.equal(arxivId('https://arxiv.org/pdf/1706.03762v5'), '1706.03762');
  assert.equal(arxivId('arXiv:hep-th/9901001'), 'hep-th/9901001');
  assert.equal(arxivId('arXiv:math.GT/0309136'), 'math.gt/0309136');
  assert.equal(arxivId('doi:10.48550/arXiv.1706.03762'), '1706.03762');
  for (const text of ['Proc. ICML 2017, pp. 1703.07076', 'Journal 12(3):1703.0707', '']) assert.equal(arxivId(text), '');
  assert.equal(arxivDoi(userExample), '10.48550/arxiv.1703.07076');
  assert.ok(isArxivDoi('10.48550/arXiv.1703.07076')); assert.ok(!isArxivDoi('10.1038/171737a0'));
});

test('arXiv references resolve through DataCite as Zotero preprints without calling Crossref', async () => {
  const urls = [];
  const service = createCitationImport({ model: { configured: false }, grobid: { configured: false }, env: {}, fetchImpl: async url => {
    urls.push(url);
    return new URL(url).host === 'api.datacite.org' ? Response.json(datacite) : Response.json({ message: { items: [] } });
  } });
  const result = await service.lookup({ bibliography: userExample });
  assert.deepEqual(urls, ['https://api.datacite.org/dois/10.48550%2Farxiv.1703.07076']);
  assert.equal(result.match, 'doi'); assert.equal(result.derivedDoi, '10.48550/arxiv.1703.07076');
  const { item } = result.candidates[0];
  assert.equal(item.itemType, 'preprint'); assert.equal(item.repository, 'arXiv'); assert.equal(item.archiveID, 'arXiv:1703.07076');
  assert.equal(item.DOI, '10.48550/arxiv.1703.07076'); assert.equal(item.url, 'https://arxiv.org/abs/1703.07076');
  assert.deepEqual(item.creators, [{ creatorType: 'author', firstName: 'Esben Jannik', lastName: 'Bjerrum' }]);
  assert.equal(result.candidates[0].year, '2017');
});

test('an arXiv ID missing from DataCite falls back to Crossref search', async () => {
  const hosts = [];
  const service = createCitationImport({ grobid: { configured: false }, env: {}, fetchImpl: async url => {
    hosts.push(new URL(url).host);
    return new URL(url).host === 'api.datacite.org' ? new Response('', { status: 404 }) : Response.json({ message: { items: [] } });
  } });
  assert.deepEqual((await service.lookup({ doi: '10.48550/arXiv.9999.99999', bibliography: userExample })).candidates, []);
  assert.deepEqual(hosts, ['api.datacite.org', 'api.crossref.org']);
});

test('Crossref requests join the polite pool only with a valid contact address, and report its limits', async () => {
  const seen = [];
  const fetchImpl = async (url, options) => { seen.push({ url, agent: options.headers['User-Agent'] }); return Response.json({ message: { items: [] } }, { headers: crossrefHeaders }); };
  const polite = createCitationImport({ grobid: { configured: false }, env: { CROSSREF_MAILTO: 'ops@example.org' }, fetchImpl });
  const result = await polite.lookup({ bibliography: 'Shannon. A mathematical theory of communication. 1948.' });
  assert.match(seen[0].url, /[?&]mailto=ops%40example\.org/); assert.match(seen[0].agent, /mailto:ops@example\.org/);
  assert.deepEqual(result.rateLimit, { limit: 3, intervalMs: 1000, concurrency: 3 });
  assert.equal(polite.status().crossrefPool, 'polite');
  const publicPool = createCitationImport({ grobid: { configured: false }, env: { CROSSREF_MAILTO: 'not an email' }, fetchImpl });
  await publicPool.lookup({ bibliography: 'Shannon. A mathematical theory of communication. 1948.' });
  assert.doesNotMatch(seen[1].url, /mailto/); assert.doesNotMatch(seen[1].agent, /mailto/);
  assert.equal(publicPool.status().crossrefPool, 'public');
});

test('a Crossref 429 without Retry-After suggests a short retry; Zotero keeps the long default', async () => {
  const service = createCitationImport({ grobid: { configured: false }, env: {}, fetchImpl: async () => new Response('', { status: 429 }) });
  await assert.rejects(service.lookup({ bibliography: 'Shannon. A mathematical theory of communication. 1948.' }), e => e.status === 429 && e.retryAfterSeconds === 2);
});

test('saving an arXiv DOI re-fetches canonical metadata from DataCite', async () => {
  const posted = [];
  const session = { apiKey: 'k', userId: '123' };
  const importId = '12345678-1234-1234-1234-123456789012';
  const service = createCitationImport({ session, grobid: { configured: false }, env: {}, fetchImpl: async (url, options = {}) => {
    const u = new URL(url);
    if (u.host === 'api.datacite.org') return Response.json(datacite);
    if (options.method === 'POST') { posted.push(JSON.parse(options.body)[0]); return Response.json({ successful: { 0: {} } }); }
    if (u.pathname.includes('/collections/')) return Response.json({ data: { name: 'x' } });
    if (u.pathname.endsWith('/items')) return Response.json([]);
    return new Response('', { status: 404 });
  } });
  await service.save({ importId, doi: '10.48550/arXiv.1703.07076' });
  assert.equal(posted[0].itemType, 'preprint'); assert.equal(posted[0].archiveID, 'arXiv:1703.07076');
});

test('GROBID arXiv references keep their ID as a DataCite DOI and become preprints; published DOIs win', async () => {
  const { references } = parseGrobidReferences(await readFile(new URL('../fixtures/grobid-attention-references.xml', import.meta.url), 'utf8'));
  const layerNorm = references.find(r => /Layer normalization/i.test(r.bibliography));
  assert.equal(layerNorm.doi, '10.48550/arxiv.1607.06450');
  assert.equal(layerNorm.zoteroItem.itemType, 'preprint'); assert.equal(layerNorm.zoteroItem.archiveID, 'arXiv:1607.06450');
  assert.equal(references.find(r => /Convolu/i.test(r.bibliography) && /1705\.03122/.test(r.bibliography)).doi, '10.48550/arxiv.1705.03122');
  assert.ok(references.filter(r => r.doi.startsWith('10.48550/')).length >= 10);
  const both = '<TEI><listBibl><biblStruct><analytic><title level="a">Paper</title><idno type="DOI">10.1000/journal.1</idno><idno type="arXiv">arXiv:2001.00001</idno></analytic><monogr><title level="j">J</title></monogr></biblStruct></listBibl></TEI>';
  assert.equal(parseGrobidReferences(both).references[0].doi, '10.1000/journal.1');
});

test('rate-limit errors name the provider, and Zotero Backoff reaches the browser with each save', async () => {
  const session = { apiKey: 'k', userId: '123' };
  const importId = '12345678-1234-1234-1234-123456789012';
  const crossref = createCitationImport({ grobid: { configured: false }, env: {}, fetchImpl: async () => new Response('', { status: 429 }) });
  await assert.rejects(crossref.lookup({ bibliography: 'Shannon. A mathematical theory of communication. 1948.' }), /Crossref is limiting requests/);
  const limited = createCitationImport({ session, grobid: { configured: false }, env: {}, fetchImpl: async () => new Response('', { status: 429, headers: { 'Retry-After': '30' } }) });
  await assert.rejects(limited.save({ importId, doi: '10.1038/171737a0' }), e => /Zotero is limiting requests/.test(e.message) && e.retryAfterSeconds === 30);

  const work = { DOI: '10.1038/171737a0', type: 'journal-article', title: ['Molecular Structure'], author: [], issued: { 'date-parts': [[1953]] } };
  const service = createCitationImport({ session, grobid: { configured: false }, env: {}, fetchImpl: async (url, options = {}) => {
    const u = new URL(url);
    if (u.host === 'api.crossref.org') return Response.json({ message: work }, { headers: { Backoff: '99' } }); // Not Zotero's header: ignored.
    if (options.method === 'POST') return Response.json({ successful: { 0: {} } }, { headers: { Backoff: '5' } });
    if (u.pathname.includes('/collections/')) return Response.json({ data: { name: 'x' } });
    if (u.pathname.endsWith('/items')) return Response.json([]);
    return new Response('', { status: 404 });
  } });
  const saved = await service.save({ importId, doi: '10.1038/171737a0' });
  assert.equal(saved.reused, false);
  assert.ok(saved.backoffSeconds >= 4 && saved.backoffSeconds <= 5, `backoff ${saved.backoffSeconds}`);
});
