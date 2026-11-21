// arXiv identifiers in reference strings, GROBID idnos, URLs and 10.48550 DOIs.
// arXiv DOIs are registered with DataCite, not Crossref, so they need their own lookup.
// An "arxiv" prefix is required so page numbers or decimals are never mistaken for IDs.
// "\.\s?" tolerates PDF line wraps such as "arxiv.org/abs/1703. 07076".
const ARXIV_ID = /arxiv(?:\.org\/(?:abs|pdf)\/|[\s:.]*(?:preprint)?[\s:.]*)((?:[a-z-]+(?:\.[a-z]{2})?\/\d{7})|\d{4}\.\s?\d{4,5})(?:v\d+)?/i;
const ARXIV_DOI = /^10\.48550\/arxiv\./i;

export function arxivId(text) {
  const match = String(text || '').match(ARXIV_ID);
  return match ? match[1].replace(/\s+/g, '').toLowerCase() : '';
}
export function arxivDoi(text) {
  const id = arxivId(text);
  return id ? `10.48550/arxiv.${id}` : '';
}
export const isArxivDoi = doi => ARXIV_DOI.test(String(doi || ''));
