export function extractPaperIdentifiers(paper, fallbackNode = {}) {
  const source = paper && typeof paper === "object" ? paper : {};
  const paperId = asNonEmptyString(source.paperId) || asNonEmptyString(fallbackNode.paperId) || "";
  const title = asNonEmptyString(source.title) || asNonEmptyString(fallbackNode.title) || "Untitled paper";
  const semanticScholarUrl = asNonEmptyString(source.url) || asNonEmptyString(fallbackNode.url) || buildS2Url(paperId);

  const externalIds = source.externalIds && typeof source.externalIds === "object" ? source.externalIds : {};
  const arxivId = extractArxivIdentifier(externalIds, paperId);
  const nberId = extractNberIdentifier(externalIds, paperId);

  return {
    title,
    paperId,
    semanticScholarUrl,
    arxivId,
    nberId,
  };
}

export function buildIdentifiersText(rows, { generatedAt = new Date().toISOString() } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const lines = [
    "# LitGraph Identifier Export",
    `# generatedAt=${generatedAt}`,
    `# count=${list.length}`,
    "",
    "semanticScholarUrl\tarxiv\tnber\tpaperId\ttitle",
  ];

  for (const row of list) {
    lines.push([
      sanitizeField(row.semanticScholarUrl),
      sanitizeField(row.arxivId),
      sanitizeField(row.nberId),
      sanitizeField(row.paperId),
      sanitizeField(row.title),
    ].join("\t"));
  }

  return lines.join("\n");
}

function extractArxivIdentifier(externalIds, paperId) {
  const byExternal = pickExternalId(externalIds, ["ArXiv", "ARXIV", "arXiv", "arxiv"]);
  if (byExternal) return normalizeArxiv(byExternal);

  if (paperId.toUpperCase().startsWith("ARXIV:")) {
    return normalizeArxiv(paperId.slice("ARXIV:".length));
  }
  return "";
}

function extractNberIdentifier(externalIds, paperId) {
  const explicitNber = pickExternalId(externalIds, ["NBER", "nber"]);
  if (explicitNber) {
    const nber = normalizeNber(explicitNber);
    if (nber) return `NBER:${nber}`;
  }

  const doi = pickExternalId(externalIds, ["DOI", "doi"]);
  const fromDoi = normalizeNberDoi(doi);
  if (fromDoi) return `NBER:${fromDoi}`;

  if (paperId.toUpperCase().startsWith("DOI:")) {
    const fromPaperId = normalizeNberDoi(paperId.slice("DOI:".length));
    if (fromPaperId) return `NBER:${fromPaperId}`;
  }
  return "";
}

function pickExternalId(externalIds, keys) {
  for (const key of keys) {
    const value = asNonEmptyString(externalIds?.[key]);
    if (value) return value;
  }
  return "";
}

function normalizeArxiv(raw) {
  const value = asNonEmptyString(raw);
  if (!value) return "";
  return value.replace(/^ARXIV:/i, "").trim();
}

function normalizeNber(raw) {
  const value = asNonEmptyString(raw);
  if (!value) return "";
  const match = value.match(/([a-z]\d{3,})/i);
  return match ? match[1].toLowerCase() : "";
}

function normalizeNberDoi(rawDoi) {
  const doi = asNonEmptyString(rawDoi).replace(/^https?:\/\/doi\.org\//i, "");
  const match = doi.match(/^10\.3386\/([a-z]\d{3,})$/i);
  return match ? match[1].toLowerCase() : "";
}

function buildS2Url(paperId) {
  if (!paperId) return "";
  return `https://www.semanticscholar.org/paper/${encodeURIComponent(paperId)}`;
}

function sanitizeField(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
