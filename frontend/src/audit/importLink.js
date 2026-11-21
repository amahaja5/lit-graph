// Links audit references (extracted from the manuscript) to the Zotero items saved by an
// import of the same manuscript, so the audit reads the exact item instead of re-matching titles.
// A link is made only when exactly one imported item matches and it matches no other reference.
const compact = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const doiOf = value => String(value || '').trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '').replace(/[.,;]+$/, '');
const ARXIV = /arxiv(?:\.org\/(?:abs|pdf)\/|[\s:.]*(?:preprint)?[\s:.]*)((?:[a-z-]+(?:\.[a-z]{2})?\/\d{7})|\d{4}\.\s?\d{4,5})/i;
const arxivOf = (...values) => {
  for (const value of values) {
    const id = String(value || '').match(ARXIV)?.[1];
    if (id) return id.replace(/\s+/g, '').toLowerCase();
  }
  return '';
};
// A dedicated arXiv field holds a bare ID ("1705.03122v2"); free text needs the arXiv marker.
const BARE_ARXIV = /^\s*(?:arxiv:)?((?:[a-z-]+(?:\.[a-z]{2})?\/\d{7})|\d{4}\.\d{4,5})(?:v\d+)?\s*$/i;
const bareArxiv = value => (String(value || '').match(BARE_ARXIV)?.[1] || '').toLowerCase();
const MIN_BIBLIOGRAPHY = 30, MIN_TITLE = 15;

export function referencesMatch(reference, imported) {
  const doi = doiOf(reference.doi);
  if (doi && doi === doiOf(imported.doi)) return true;
  const arxiv = bareArxiv(reference.arxiv) || arxivOf(reference.arxiv, reference.doi, reference.bibliography);
  if (arxiv && arxiv === arxivOf(imported.doi, imported.bibliography)) return true;
  // Both bibliographies come from the same manuscript; compacting absorbs line-wrap hyphens and spacing.
  const a = compact(reference.bibliography), b = compact(imported.bibliography);
  if (a.length >= MIN_BIBLIOGRAPHY && b.length >= MIN_BIBLIOGRAPHY && (a === b || a.includes(b) || b.includes(a))) return true;
  return [imported.title, imported.sourceTitle].some(title => {
    const t = compact(title);
    return t.length >= MIN_TITLE && a.includes(t);
  });
}

// Sets zoteroKey on uniquely linked references; returns how many were linked.
export function linkImportedSources(references, imported) {
  const matches = references.map(ref => imported.map((item, i) => (item.zoteroKey && referencesMatch(ref, item) ? i : -1)).filter(i => i >= 0));
  const claims = new Map();
  matches.forEach(found => { if (found.length === 1) claims.set(found[0], (claims.get(found[0]) || 0) + 1); });
  let linked = 0;
  references.forEach((ref, index) => {
    const found = matches[index];
    if (found.length === 1 && claims.get(found[0]) === 1) {
      ref.zoteroKey = imported[found[0]].zoteroKey;
      linked++;
    }
  });
  return linked;
}
