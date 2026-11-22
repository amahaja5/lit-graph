import { XMLParser } from 'fast-xml-parser';
import { badRequest, ProxyHttpError } from '../shared/errors.js';
import { parseGrobidReferences } from '../citation-import/grobid.js';

// Builds the citation inventory from GROBID full-text TEI: every body sentence containing an
// in-text citation becomes a claim, linked to the bibliography entries its citations point to.
const MAX_CLAIMS = 150, MAX_SOURCES = 8;
const SKIP = new Set(['figure', 'table', 'formula', 'note', 'head', 'listBibl']);
const tagOf = node => Object.keys(node).find(k => k !== ':@');
const attrs = node => node[':@'] || {};
const fail = message => new ProxyHttpError({ code: 'audit_invalid_response', status: 502, message });

function find(nodes, name) {
  for (const node of nodes || []) {
    const tag = tagOf(node);
    if (tag === name) return node;
    if (tag && tag !== '#text') { const hit = find(node[tag], name); if (hit) return hit; }
  }
  return null;
}
function textOf(nodes) {
  let out = '';
  for (const node of nodes || []) {
    const tag = tagOf(node);
    out += tag === '#text' ? String(node['#text']) : textOf(node[tag]);
  }
  return out;
}
function citationsIn(nodes, out = []) {
  for (const node of nodes || []) {
    const tag = tagOf(node);
    if (tag === 'ref' && attrs(node)['@_type'] === 'bibr') out.push({ target: String(attrs(node)['@_target'] || '').replace(/^#/, ''), text: textOf(node.ref).trim() });
    else if (tag && tag !== '#text') citationsIn(node[tag], out);
  }
  return out;
}
// Sentences (<s>) where GROBID segmented them, otherwise whole paragraphs.
function sentences(nodes, out = []) {
  for (const node of nodes || []) {
    const tag = tagOf(node);
    if (!tag || tag === '#text' || SKIP.has(tag)) continue;
    if (tag === 's') out.push(node.s);
    else if (tag === 'p' && !find(node.p, 's')) out.push(node.p);
    else sentences(node[tag], out);
  }
  return out;
}
const clean = text => String(text).replace(/\s+/g, ' ').trim();
// "[35," / "2," / "5]" / "(Smith et al., 2020;" become "[35]", "[2]", "[5]", "Smith et al., 2020".
export function citationLabel(marker) {
  const core = clean(marker).replace(/^[[(\s,;]+|[\])\s,;.]+$/g, '');
  if (!core) return '';
  return /^\d+[a-z]?$/i.test(core) ? `[${core}]` : core;
}

export function inventoryFromTei(xml) {
  if (typeof xml !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw fail('GROBID returned invalid or unsupported XML.');
  let doc;
  try { doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, preserveOrder: true, parseTagValue: false, parseAttributeValue: false, trimValues: false }).parse(xml); }
  catch { throw fail('GROBID returned invalid or unsupported XML.'); }
  const { references: parsed, warnings } = parseGrobidReferences(xml);
  // Bibliography entry IDs (xml:id="b12") in document order, matching parseGrobidReferences.
  const listBibl = find(doc, 'listBibl');
  const xmlIds = (listBibl?.listBibl || []).filter(n => ['biblStruct', 'bibl'].includes(tagOf(n))).map(n => String(attrs(n)['@_id'] || ''));
  const byXmlId = new Map();
  const references = parsed.map((ref, i) => {
    const arxiv = ref.doi.startsWith('10.48550/arxiv.') ? ref.doi.slice('10.48550/arxiv.'.length) : '';
    const out = { id: `R${i + 1}`, label: '', title: ref.title, bibliography: ref.bibliography, doi: arxiv ? '' : ref.doi, arxiv };
    if (xmlIds[i]) byXmlId.set(xmlIds[i], out);
    return out;
  });
  const body = find(doc, 'body');
  const claims = [];
  let unlinked = 0, skipped = 0, capped = 0;
  for (const sentence of sentences(body?.body)) {
    const cites = citationsIn(sentence);
    if (!cites.length) continue;
    const linked = cites.filter(c => byXmlId.has(c.target));
    unlinked += cites.length - linked.length;
    if (!linked.length) continue;
    const text = clean(textOf(sentence));
    if (text.length < 10 || text.length > 5000) { skipped++; continue; }
    for (const c of linked) { const ref = byXmlId.get(c.target); ref.label ||= citationLabel(c.text); }
    let referenceIds = [...new Set(linked.map(c => byXmlId.get(c.target).id))];
    if (referenceIds.length > MAX_SOURCES) { capped++; referenceIds = referenceIds.slice(0, MAX_SOURCES); }
    claims.push({ id: `C${claims.length + 1}`, text, marker: linked.map(c => citationLabel(c.text)).filter(Boolean).join(', '), referenceIds });
  }
  if (claims.length > MAX_CLAIMS) throw badRequest('This manuscript has more than 150 cited sentences. Audit a section with its bibliography.');
  references.forEach((ref, i) => { ref.label ||= `Reference ${i + 1}`; });
  const notes = warnings.filter(w => !/GROBID metadata is unverified/.test(w));
  if (unlinked) notes.push(`${unlinked} in-text citation${unlinked === 1 ? '' : 's'} could not be linked to a bibliography entry. Add them by hand if they matter.`);
  if (skipped) notes.push(`${skipped} cited passage${skipped === 1 ? ' was' : 's were'} too short or too long to check.`);
  if (capped) notes.push(`${capped} passage${capped === 1 ? ' cites' : 's cite'} more than ${MAX_SOURCES} sources; only the first ${MAX_SOURCES} are checked.`);
  if (!references.length) notes.push('No bibliography was found. Include the reference list in the PDF.');
  return {
    references, claims, warnings: notes,
    coverageNotice: 'Citations and the bibliography were extracted automatically by GROBID. Review the inventory for missed or incorrectly linked citations before checking.',
  };
}
