import { createGrobid } from './grobid.js';
import { createHash } from 'node:crypto';
import { badRequest, ProxyHttpError } from '../shared/errors.js';
import { arxivDoi, isArxivDoi } from './arxiv.js';

const fail = (message, status = 502) => new ProxyHttpError({ code: 'citation_import_error', message, status });
const clean = (s, max = 1000) => typeof s === 'string' ? s.trim().slice(0, max) : '';
export function normalizeDoi(value) {
  return clean(value, 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').replace(/[.,;]+$/, '').toLowerCase();
}
function requireDoi(value) {
  const doi = normalizeDoi(value);
  if (!/^10\.\d{4,9}\/\S+$/.test(doi)) throw badRequest('Enter a valid DOI, or leave DOI blank to search by reference.');
  return doi;
}
export function crossrefRecord(work) {
  const doi = requireDoi(work.DOI);
  const types = { 'journal-article': 'journalArticle', book: 'book', monograph: 'book', 'book-chapter': 'bookSection', 'proceedings-article': 'conferencePaper', dissertation: 'thesis', report: 'report' };
  const itemType = types[work.type] || 'document';
  const item = {
    itemType, title: clean(work.title?.[0]),
    creators: (Array.isArray(work.author) ? work.author : []).slice(0, 100).map(a => a.family
      ? { creatorType: 'author', firstName: clean(a.given, 150), lastName: clean(a.family, 150) }
      : { creatorType: 'author', name: clean(a.name || a.given, 200) }).filter(a => a.lastName || a.name),
    date: String(work.issued?.['date-parts']?.[0]?.[0] || ''),
    url: `https://doi.org/${doi}`, tags: [], collections: [], relations: {},
  };
  if (!item.title) throw fail('The metadata provider returned no title.');
  if (itemType === 'journalArticle') Object.assign(item, { DOI: doi, publicationTitle: clean(work['container-title']?.[0]), volume: clean(work.volume, 50), issue: clean(work.issue, 50), pages: clean(work.page, 100) });
  else item.extra = `DOI: ${doi}`;
  if (['book', 'bookSection', 'conferencePaper'].includes(itemType)) item.publisher = clean(work.publisher);
  if (itemType === 'report') item.institution = clean(work.publisher);
  if (itemType === 'bookSection') item.bookTitle = clean(work['container-title']?.[0]);
  if (itemType === 'conferencePaper') item.proceedingsTitle = clean(work['container-title']?.[0]);
  return { doi, title: item.title, authors: item.creators.map(a => a.name || `${a.firstName} ${a.lastName}`.trim()).join(', '), year: item.date, venue: clean(work['container-title']?.[0]), item };
}
// DataCite metadata for arXiv DOIs (10.48550/arxiv.*), mapped to a Zotero preprint.
export function dataciteRecord(attributes) {
  const doi = requireDoi(attributes?.doi);
  const id = doi.replace(/^10\.48550\/arxiv\./, '');
  const creators = (Array.isArray(attributes.creators) ? attributes.creators : []).slice(0, 100).map(c => c?.familyName
    ? { creatorType: 'author', firstName: clean(c.givenName, 150), lastName: clean(c.familyName, 150) }
    : { creatorType: 'author', name: clean(c?.name, 200) }).filter(a => a.lastName || a.name);
  const item = {
    itemType: 'preprint', title: clean(attributes.titles?.[0]?.title), creators,
    date: String(attributes.publicationYear || ''), repository: 'arXiv', archiveID: `arXiv:${id}`, DOI: doi,
    url: `https://arxiv.org/abs/${id}`, tags: [], collections: [], relations: {},
  };
  if (!item.title) throw fail('The metadata provider returned no title.');
  return { doi, title: item.title, authors: creators.map(a => a.name || `${a.firstName} ${a.lastName}`.trim()).join(', '), year: item.date, venue: 'arXiv', item };
}
// Crossref publishes its limits per response; the browser paces lookups from these.
function readRateLimit(headers) {
  const limit = Number(headers.get('x-rate-limit-limit'));
  const interval = String(headers.get('x-rate-limit-interval') || '').match(/^(\d+)s$/);
  const concurrency = Number(headers.get('x-concurrency-limit'));
  return limit > 0 && interval ? { limit, intervalMs: Number(interval[1]) * 1000, concurrency: concurrency > 0 ? concurrency : 1 } : null;
}
// Zotero item built from Semantic Scholar metadata, for papers with no DOI that Crossref or DataCite can resolve.
export function semanticScholarItem(paper, paperId, doi = '') {
  const title = clean(paper?.title, 1000);
  if (!title) throw fail('Semantic Scholar returned no title for this paper.');
  const creators = (Array.isArray(paper.authors) ? paper.authors : []).slice(0, 100).map(author => {
    const name = clean(author?.name, 200), parts = name.split(/\s+/).filter(Boolean);
    return parts.length > 1 ? { creatorType: 'author', firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) } : { creatorType: 'author', name };
  }).filter(a => a.lastName || a.name);
  const types = Array.isArray(paper.publicationTypes) ? paper.publicationTypes : [];
  const journal = clean(paper.journal?.name, 300);
  const itemType = types.includes('Conference') ? 'conferencePaper' : journal ? 'journalArticle' : 'document';
  const extra = [`Semantic Scholar: ${paperId}`, doi && itemType !== 'journalArticle' ? `DOI: ${doi}` : ''].filter(Boolean).join('\n');
  const item = { itemType, title, creators, date: String(paper.year || ''), url: `https://www.semanticscholar.org/paper/${paperId}`, extra, tags: [], collections: [], relations: {} };
  if (itemType === 'journalArticle') Object.assign(item, { publicationTitle: journal, volume: clean(paper.journal?.volume, 50), pages: clean(paper.journal?.pages, 100), ...(doi ? { DOI: doi } : {}) });
  if (itemType === 'conferencePaper') item.proceedingsTitle = clean(paper.venue, 300);
  if (itemType === 'document' && paper.venue) item.publisher = clean(paper.venue, 300);
  return item;
}
// Predetermined Zotero keys let an uncertain network response be retried without creating duplicates.
export function importKey(userId, importId, kind) {
  if (typeof importId !== 'string' || !/^[a-f0-9-]{36}$/i.test(importId)) throw badRequest('Invalid import identifier.');
  const alphabet = '23456789ABCDEFGHIJKLMNPQRSTUVWXYZ';
  const bytes = createHash('sha256').update(`${userId}:${importId}:${kind}`).digest();
  return [...bytes.subarray(0, 8)].map(b => alphabet[b % alphabet.length]).join('');
}
function recordDoi(data) {
  return normalizeDoi(data.DOI || data.extra?.match(/^DOI:\s*(\S+)/im)?.[1] || '');
}
export function createCitationImport({ session = null, fetchImpl = globalThis.fetch, grobid = createGrobid({ fetchImpl }), env = process.env, s2 = null } = {}) {
  let backoffUntil = 0, crossrefLimits = null;
  // A contact address moves Crossref requests from the public pool (1 search/s, 1 at a time)
  // to the polite pool (3 searches/s, 3 at a time).
  const mailto = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(env.CROSSREF_MAILTO || '') ? env.CROSSREF_MAILTO : '';
  const crossrefHeaders = { 'User-Agent': `Groundwork/0.1 (citation import${mailto ? `; mailto:${mailto}` : ''})` };
  const crossrefUrl = (path, params = new URLSearchParams()) => {
    if (mailto) params.set('mailto', mailto);
    const query = params.toString();
    return `https://api.crossref.org/${path}${query ? `?${query}` : ''}`;
  };
  async function json(url, options = {}, allow404 = false) {
    let response;
    try { response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000), ...options }); }
    catch { throw fail('The metadata service could not be reached. Retry this step; an existing import will be reused.'); }
    if (allow404 && response.status === 404) return null;
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw fail('Zotero access was denied. Disconnect and reconnect with library write access.', 403);
      if (response.status === 429) {
        const host = new URL(url).host;
        const provider = { 'api.zotero.org': 'Zotero', 'api.crossref.org': 'Crossref', 'api.datacite.org': 'DataCite' }[host] || 'The metadata service';
        throw new ProxyHttpError({ code: 'citation_rate_limit', message: `${provider} is limiting requests.`, status: 429, retryAfterSeconds: Number(response.headers.get('Retry-After')) || (host === 'api.zotero.org' ? 60 : 2) });
      }
      if (response.status === 412) throw fail('The Zotero library changed during import. Retry to use the latest version.', 409);
      throw fail(`The metadata service returned ${response.status}. Retry this step.`);
    }
    if (new URL(url).host === 'api.crossref.org') crossrefLimits = readRateLimit(response.headers) || crossrefLimits;
    // Zotero sends Backoff to ask clients to slow down before it starts refusing requests.
    const backoff = new URL(url).host === 'api.zotero.org' ? Number(response.headers.get('Backoff')) || 0 : 0;
    if (backoff) backoffUntil = Date.now() + backoff * 1000;
    if (response.status === 204) return {};
    return response.json();
  }
  const pause = () => (backoffUntil > Date.now() ? { backoffSeconds: Math.ceil((backoffUntil - Date.now()) / 1000) } : {});
  function requireSession() {
    if (!session?.apiKey || !/^\d+$/.test(session.userId)) throw fail('Connect Zotero with write access before saving a collection.', 401);
  }
  async function zotero(path, options = {}, allow404 = false) {
    requireSession();
    if (Date.now() < backoffUntil) throw new ProxyHttpError({ code: 'citation_rate_limit', message: 'Zotero asked for a pause.', status: 429, retryAfterSeconds: Math.ceil((backoffUntil - Date.now()) / 1000) });
    return json(`https://api.zotero.org/users/${session.userId}/${path}`, { ...options, headers: { 'Zotero-API-Key': session.apiKey, 'Zotero-API-Version': '3', 'Content-Type': 'application/json', ...options.headers } }, allow404);
  }
  function checkWrite(result) {
    if (Object.keys(result.failed || {}).length || !(result.successful?.['0'] || result.success?.['0'] || result.unchanged?.['0']))
      throw fail('Zotero did not save this record. Retry; successful records are preserved.', 409);
  }
  async function byDoi(doi) {
    if (isArxivDoi(doi)) {
      const payload = await json(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`, { headers: { Accept: 'application/vnd.api+json' } }, true);
      return payload?.data?.attributes ? dataciteRecord(payload.data.attributes) : null;
    }
    const payload = await json(crossrefUrl(`works/${encodeURIComponent(doi)}`), { headers: crossrefHeaders }, true);
    return payload ? crossrefRecord(payload.message) : null;
  }
  async function addToCollection(item, collectionKey) {
    if ((item.data.collections || []).includes(collectionKey)) return;
    await zotero(`items/${item.key}`, { method: 'PATCH', headers: { 'If-Unmodified-Since-Version': String(item.version) }, body: JSON.stringify({ collections: [...(item.data.collections || []), collectionKey] }) });
  }
  // Saves a Semantic Scholar paper. Identity comes from Semantic Scholar on the server, never from the browser.
  async function saveFromSemanticScholar(importId, paperId, paper, doi) {
    const collectionKey = importKey(session.userId, importId, 'collection');
    if (!(await zotero(`collections/${collectionKey}`, {}, true))) throw badRequest('Create the import collection first.');
    const marker = `Semantic Scholar: ${paperId}`;
    const key = importKey(session.userId, importId, `s2:${paperId}`);
    let item = await zotero(`items/${key}`, {}, true);
    if (!item) {
      const params = new URLSearchParams({ q: marker, qmode: 'everything', itemType: '-attachment', limit: '25' });
      item = (await zotero(`items?${params}`)).find(x => String(x.data?.extra || '').split('\n').includes(marker));
    }
    if (item) { await addToCollection(item, collectionKey); return { key: item.key, reused: true, source: 'semanticscholar', ...pause() }; }
    checkWrite(await zotero('items', { method: 'POST', body: JSON.stringify([{ ...semanticScholarItem(paper, paperId, doi), key, version: 0, collections: [collectionKey] }]) }));
    return { key, reused: false, source: 'semanticscholar', ...pause() };
  }
  const api = {
    warm() { return grobid.warm ? grobid.warm() : { state: 'unconfigured' }; },
    status() { return { grobidConfigured: grobid.configured, provider: 'GROBID', lookupProvider: 'Crossref / DataCite (arXiv)', crossrefPool: mailto ? 'polite' : 'public', persistence: 'browser-session' }; },
    async extract(body) {
      if (body?.consent !== true) throw badRequest('Confirm this public/test manuscript can be sent to the extraction provider.');
      if (!grobid.configured) throw fail('The server needs GROBID_API_URL and EXTRACTION_API_KEY before extraction can run.', 503);
      if (!body?.file) throw badRequest('Upload the manuscript as a PDF.');
      return grobid.extract(body.file);
    },
    async lookup(body) {
      const rateLimit = () => crossrefLimits ? { rateLimit: crossrefLimits } : {};
      const explicitDoi = body?.doi ? requireDoi(body.doi) : '';
      if (explicitDoi && !isArxivDoi(explicitDoi)) {
        const candidate = await byDoi(explicitDoi);
        return { match: 'doi', candidates: candidate ? [candidate] : [], ...rateLimit() };
      }
      // arXiv IDs resolve exactly through DataCite, without using Crossref quota.
      const arxiv = explicitDoi || arxivDoi(body?.bibliography);
      if (arxiv) {
        const candidate = await byDoi(arxiv);
        if (candidate) return { match: 'doi', ...(explicitDoi ? {} : { derivedDoi: arxiv }), candidates: [candidate] };
      }
      const query = clean(body?.bibliography || body?.title, 2000);
      if (explicitDoi && query.length < 8) return { match: 'doi', candidates: [] };
      if (query.length < 8) throw badRequest('Enter a reference or title of at least 8 characters.');
      const params = new URLSearchParams({ 'query.bibliographic': query, rows: '3' });
      const data = await json(crossrefUrl('works', params), { headers: crossrefHeaders });
      return { match: 'candidate', candidates: (data.message?.items || []).filter(w => w.DOI && w.title?.[0]).map(crossrefRecord), ...rateLimit() };
    },
    async collection(body) {
      requireSession();
      const name = clean(body?.name, 200);
      if (!name) throw badRequest('Name the new collection.');
      const key = importKey(session.userId, body.importId, 'collection');
      const existing = await zotero(`collections/${key}`, {}, true);
      if (existing) {
        if (existing.data?.name !== name) throw fail('The import collection name changed. Start a new import to create another collection.', 409);
      } else {
        checkWrite(await zotero('collections', { method: 'POST', body: JSON.stringify([{ key, version: 0, name, parentCollection: false }]) }));
      }
      return { key, userId: session.userId, url: `https://www.zotero.org/users/${session.userId}/collections/${key}/items`, ...pause() };
    },
    // Saves a Semantic Scholar paper (e.g. from the Explore review cart) by its paper ID.
    async work(body) {
      requireSession();
      const paperId = clean(body?.paperId, 64);
      if (!/^[0-9a-f]{40}$/i.test(paperId)) throw badRequest('Invalid Semantic Scholar paper ID.');
      if (!s2) throw fail('Paper metadata is unavailable on this server.', 503);
      let paper;
      try { paper = await s2.getPaper(paperId, { fields: 'externalIds,title,authors,year,venue,journal,publicationTypes' }); }
      catch (error) { throw error instanceof ProxyHttpError ? error : fail('Semantic Scholar could not be reached. Retry this step.'); }
      const ids = paper?.externalIds || {};
      const doi = normalizeDoi(ids.DOI) || (ids.ArXiv ? arxivDoi(`arXiv:${ids.ArXiv}`) : '');
      if (/^10\.\d{4,9}\/\S+$/.test(doi)) {
        try { return { ...(await api.save({ importId: body.importId, doi })), source: isArxivDoi(doi) ? 'datacite' : 'crossref' }; }
        catch (error) { if (!(error instanceof ProxyHttpError && error.status === 400 && /could not be retrieved/.test(error.message))) throw error; }
      }
      return saveFromSemanticScholar(body.importId, paperId, paper, doi);
    },
    async save(body) {
      requireSession();
      const doi = requireDoi(body?.doi);
      const collectionKey = importKey(session.userId, body.importId, 'collection');
      if (!(await zotero(`collections/${collectionKey}`, {}, true))) throw badRequest('Create the import collection first.');
      const key = importKey(session.userId, body.importId, doi);
      let item = await zotero(`items/${key}`, {}, true);
      if (item && recordDoi(item.data) !== doi) throw fail('Import key conflicts with another record. Start a new import.', 409);
      if (!item) {
        // Only exact DOI matches are reused; loose title matches could merge different works.
        const params = new URLSearchParams({ q: doi, qmode: 'everything', itemType: '-attachment', limit: '100' });
        const matches = await zotero(`items?${params}`);
        item = matches.find(x => recordDoi(x.data) === doi);
        if (!item && matches.length === 100) throw fail('Too many library matches to safely deduplicate. Refine the DOI before retrying.', 409);
      }
      if (item) {
        await addToCollection(item, collectionKey);
        return { key: item.key, reused: true, ...pause() };
      }
      // Re-fetch canonical metadata instead of accepting arbitrary client-supplied Zotero fields.
      const candidate = await byDoi(doi);
      if (!candidate) throw badRequest(`This DOI could not be retrieved from ${isArxivDoi(doi) ? 'DataCite' : 'Crossref'}.`);
      checkWrite(await zotero('items', { method: 'POST', body: JSON.stringify([{ ...candidate.item, key, version: 0, collections: [collectionKey] }]) }));
      return { key, reused: false, ...pause() };
    },
  };
  return api;
}
