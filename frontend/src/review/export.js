import {
  buildBibtexDocument,
  extractOrBuildBibtexEntry,
  getBibtexSortLabel,
  normalizeBibtexSort,
  sortReviewNodesForBibtex,
} from "./bibtex.js";
import { buildIdentifiersText, extractPaperIdentifiers } from "./identifiers.js";

export function createReviewExporter({ api, store, setStatus, setError, clearError }) {
  const formats = {
    bibtex: {
      label: 'BibTeX', prefix: 'litgraph-review', extension: 'bib', type: 'application/x-bibtex;charset=utf-8',
      fetch: id => api.fetchPaperBibtex(id), entry: extractOrBuildBibtexEntry, document: buildBibtexDocument,
      fallback: paper => !paper?.citationStyles?.bibtex,
    },
    identifiers: {
      label: 'identifier', prefix: 'litgraph-identifiers', extension: 'txt', type: 'text/plain;charset=utf-8',
      fetch: id => api.fetchPaperIdentifiers(id), entry: extractPaperIdentifiers, document: buildIdentifiersText,
      fallback: paper => !paper,
    },
  };
  return async function exportReview(format, { sortBy = 'author' } = {}) {
    const config = formats[format];
    if (!config) throw new Error(`Unknown export format: ${format}`);
    const nodes = store.getReviewCartNodes();
    const seed = store.seedPaperId;
    if (!nodes.length) { setError('Add at least one paper to the review cart before exporting.'); return; }
    const sort = normalizeBibtexSort(sortBy);
    setStatus(`Preparing ${config.label} export (${getBibtexSortLabel(sort)} order)...`);
    clearError();
    const entries = [];
    let fallbackCount = 0;
    for (const node of sortReviewNodesForBibtex(nodes, sort)) {
      let paper = null;
      try { paper = await config.fetch(node.paperId); } catch { /* Export available local metadata. */ }
      if (config.fallback(paper)) fallbackCount++;
      entries.push(config.entry(paper, node));
    }
    const name = `${config.prefix}-${safeFileFragment(seed)}-${getBibtexSortLabel(sort)}-${buildUniqueExportSuffix()}.${config.extension}`;
    downloadText(config.document(entries), name, config.type);
    setStatus(`Exported ${nodes.length} paper(s) to ${name}${fallbackCount ? ` (${fallbackCount} fallback entries)` : ''}`);
  };
}

function downloadText(text, fileName, contentType = "text/plain;charset=utf-8") {
  const blob = new Blob([String(text || "")], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeFileFragment(value) {
  return String(value || "litgraph")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "litgraph";
}

function buildUniqueExportSuffix() {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    "-",
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
    String(now.getUTCMilliseconds()).padStart(3, "0"),
  ].join("");
  const randomToken = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${randomToken}`;
}
