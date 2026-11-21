import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { badRequest, ProxyHttpError } from '../shared/errors.js';
import { MAX_UPLOAD_BYTES } from '../documents/auditDocument.js';
import { arxivId } from './arxiv.js';

const fail = message => new ProxyHttpError({ code: 'grobid_error', message, status: 502 });
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value === 'object' && value !== null
  ? Object.entries(value).filter(([k]) => !k.startsWith('@_')).map(([, v]) => text(v)).join(' ').replace(/\s+/g, ' ').trim()
  : String(value ?? '').replace(/\s+/g, ' ').trim();
const typed = (nodes, type) => list(nodes).find(n => n['@_type']?.toLowerCase() === type);
const title = (nodes, level) => text(list(nodes).find(n => n['@_level'] === level));
const MAX_XML_BYTES = 5 * 1024 * 1024;

// Only bibliography entries in listBibl are considered, never the manuscript header.
export function parseGrobidReferences(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > MAX_XML_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw fail('GROBID returned invalid or unsupported XML.');
  const doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false }).parse(xml);
  const entries = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'listBibl') for (const bib of list(value)) entries.push(...list(bib.biblStruct), ...list(bib.bibl));
      else for (const child of list(value)) visit(child);
    }
  }
  visit(doc);
  if (entries.length > 80) throw badRequest('Use a section with at most 80 references.');
  const warnings = ['GROBID metadata is unverified. Check the bibliography for missing or misread entries before importing.'];
  if (!entries.length) warnings.push('No bibliography entries were found. Scanned PDFs need OCR first.');
  const references = entries.map((entry, index) => {
    const analytic = entry.analytic || {}, monogr = entry.monogr || {}, imprint = monogr.imprint || {};
    const name = text(analytic.title) || title(monogr.title, 'm') || text(monogr.title);
    const journal = title(monogr.title, 'j');
    const creators = list(analytic.author || monogr.author).map(author => {
      const person = author.persName;
      if (person?.surname) return { creatorType: 'author', firstName: list(person.forename).map(text).join(' '), lastName: text(person.surname) };
      return { creatorType: 'author', name: text(person || author.orgName || author) };
    }).filter(a => a.lastName || a.name);
    const idnos = [...list(analytic.idno), ...list(monogr.idno), ...list(entry.idno)];
    const raw = text(typed(entry.note, 'raw_reference'));
    const arxiv = arxivId(text(typed(idnos, 'arxiv'))) || arxivId(raw);
    const publishedDoi = text(typed(idnos, 'doi')).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').replace(/[.,;]+$/, '').toLowerCase();
    const doi = publishedDoi || (arxiv ? `10.48550/arxiv.${arxiv}` : '');
    const dateNode = list(imprint.date)[0];
    const date = dateNode?.['@_when'] || text(dateNode);
    const scope = unit => list(imprint.biblScope).find(s => s['@_unit'] === unit);
    const page = scope('page');
    const pages = page?.['@_from'] ? [page['@_from'], page['@_to']].filter(Boolean).join('-') : text(page);
    const bibliography = raw || [creators.map(a => a.name || `${a.firstName} ${a.lastName}`).join(', '), date, name, journal, text(imprint.publisher), text(scope('volume')), pages, doi].filter(Boolean).join('. ') || text(entry);
    if (!bibliography) throw fail('GROBID returned an empty reference.');
    const item = { itemType: journal ? 'journalArticle' : analytic.title && monogr.title ? 'bookSection' : title(monogr.title, 'm') ? 'book' : 'document', title: name, creators, date, tags: [], collections: [], relations: {} };
    if (journal) Object.assign(item, { publicationTitle: journal, volume: text(scope('volume')), issue: text(scope('issue')), pages, DOI: doi });
    else {
      if (doi) item.extra = `DOI: ${doi}`;
      if (['book', 'bookSection'].includes(item.itemType)) Object.assign(item, { publisher: text(imprint.publisher), place: text(imprint.pubPlace) });
      if (item.itemType === 'bookSection') Object.assign(item, { bookTitle: text(monogr.title), pages });
    }
    if (doi) item.url = `https://doi.org/${doi}`;
    if (arxiv && !journal) {
      for (const key of ['extra', 'publisher', 'place', 'bookTitle', 'pages']) delete item[key];
      Object.assign(item, { itemType: 'preprint', repository: 'arXiv', archiveID: `arXiv:${arxiv}`, DOI: doi, url: `https://arxiv.org/abs/${arxiv}` });
    }
    return { id: `R${index + 1}`, bibliography, title: name, doi, bibliographySource: raw ? 'raw_reference' : 'reconstructed', zoteroItem: item };
  });
  return { references, warnings };
}

// One GROBID service is shared by every user, so warm-ups are throttled per server process
// rather than per user: once it answers, further pings within READY_TTL_MS are skipped.
const READY_TTL_MS = 60_000;
const RETRY_AFTER_FAILURE_MS = 10_000;
export function createWarmState() { return { readyAt: -Infinity, failedAt: -Infinity, inflight: null }; }
const sharedWarmState = createWarmState();

export function createGrobid({ env = process.env, fetchImpl = globalThis.fetch, warmState = sharedWarmState, now = Date.now } = {}) {
  const configured = Boolean(env.GROBID_API_URL && env.EXTRACTION_API_KEY);
  function endpoint(path) {
    const url = new URL(path, env.GROBID_API_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fail('Invalid server GROBID_API_URL configuration.');
    return url;
  }
  async function ping() {
    const waitMs = Math.min(Math.max(Number(env.GROBID_WARM_WAIT_MS) || 8000, 1000), 60000);
    try {
      const response = await fetchImpl(endpoint(env.GROBID_WARM_PATH || '/health').href, { method: 'GET', headers: { 'X-API-Key': env.EXTRACTION_API_KEY }, redirect: 'manual', signal: AbortSignal.timeout(waitMs) });
      response.body?.cancel().catch(() => {});
      // Any non-5xx answer means the container is serving; Cloud Run holds requests while it cold-starts.
      if (response.status < 500) { warmState.readyAt = now(); return { state: 'ready' }; }
    } catch { /* Timed out or unreachable: the instance is still starting, or the service is down. */ }
    warmState.failedAt = now();
    return { state: 'starting' };
  }
  return {
    configured,
    // Starts a scale-to-zero GROBID deployment ahead of extraction. Never throws: warming is best-effort.
    async warm() {
      if (!configured) return { state: 'unconfigured' };
      const t = now();
      if (t - warmState.readyAt < READY_TTL_MS) return { state: 'ready', cached: true };
      if (warmState.inflight) return warmState.inflight;
      if (t - warmState.failedAt < RETRY_AFTER_FAILURE_MS) return { state: 'starting', cached: true };
      warmState.inflight = ping().finally(() => { warmState.inflight = null; });
      return warmState.inflight;
    },
    async extract(file) {
      if (!configured) throw fail('Configure GROBID_API_URL and EXTRACTION_API_KEY on the server.');
      if (typeof file?.base64 !== 'string' || file.base64.length > MAX_UPLOAD_BYTES * 4 / 3 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) throw badRequest('Upload a valid PDF no larger than 3 MB.');
      const bytes = Buffer.from(file.base64, 'base64');
      if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES || !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw badRequest('Upload a valid PDF no larger than 3 MB.');
      const url = endpoint('/extract?mode=references');
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'manuscript.pdf');
      let xml;
      try {
        const response = await fetchImpl(url.href, { method: 'POST', headers: { 'X-API-Key': env.EXTRACTION_API_KEY, Accept: 'application/xml' }, body: form, redirect: 'error', signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw fail([401, 403].includes(response.status) ? 'GROBID rejected the server extraction key.' : `GROBID extraction failed (${response.status}). Retry or use a smaller PDF.`);
        const chunks = []; let length = 0;
        for await (const chunk of response.body || []) {
          length += chunk.length;
          if (length > MAX_XML_BYTES) throw fail('GROBID returned too much XML. Use a smaller PDF.');
          chunks.push(Buffer.from(chunk));
        }
        xml = Buffer.concat(chunks).toString('utf8');
        warmState.readyAt = now();
      } catch (error) {
        if (error instanceof ProxyHttpError) throw error;
        throw fail('GROBID could not complete extraction. Check the service or retry with a smaller PDF.');
      }
      return { filename: String(file.name || 'manuscript.pdf').slice(0, 200), provider: 'GROBID', ...parseGrobidReferences(xml) };
    },
  };
}
