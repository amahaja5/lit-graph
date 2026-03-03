export const BIBTEX_SORT_AUTHOR = "author";
export const BIBTEX_SORT_YEAR = "year";

export function normalizeBibtexSort(value) {
  if (value === BIBTEX_SORT_YEAR) return BIBTEX_SORT_YEAR;
  return BIBTEX_SORT_AUTHOR;
}

export function sortReviewNodesForBibtex(nodes, sortBy) {
  const sortMode = normalizeBibtexSort(sortBy);
  const list = Array.isArray(nodes) ? [...nodes] : [];

  if (sortMode === BIBTEX_SORT_YEAR) {
    return list.sort(compareByYear);
  }
  return list.sort(compareByAuthor);
}

export function getBibtexSortLabel(sortBy) {
  return normalizeBibtexSort(sortBy) === BIBTEX_SORT_YEAR ? "year" : "author";
}

export function extractOrBuildBibtexEntry(paper, fallbackNode) {
  const bibtex = paper?.citationStyles?.bibtex;
  if (typeof bibtex === "string" && bibtex.trim()) {
    return bibtex.trim();
  }
  return buildFallbackBibtexEntry(paper, fallbackNode);
}

export function buildBibtexDocument(entries) {
  const normalized = (entries || [])
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return normalized.join("\n\n");
}

function buildFallbackBibtexEntry(paper, fallbackNode) {
  const source = paper && typeof paper === "object" ? paper : fallbackNode || {};
  const paperId = normalizeString(source.paperId) || normalizeString(fallbackNode?.paperId) || "unknown";
  const title = normalizeString(source.title) || normalizeString(fallbackNode?.title) || "Untitled paper";
  const authorNames = normalizeAuthors(source.authors ?? fallbackNode?.authors);
  const author = authorNames.length ? authorNames.join(" and ") : "Unknown author";
  const yearNumber = normalizeYear(source.year ?? fallbackNode?.year);
  const year = yearNumber != null ? String(yearNumber) : "unknown";
  const key = toBibtexKey(paperId, authorNames[0], year);

  return [
    `@misc{${key},`,
    `  title = {${escapeBibtexValue(title)}},`,
    `  author = {${escapeBibtexValue(author)}},`,
    `  year = {${escapeBibtexValue(year)}},`,
    `  note = {Semantic Scholar paperId: ${escapeBibtexValue(paperId)}}`,
    "}",
  ].join("\n");
}

function compareByAuthor(a, b) {
  const byAuthor = cmp(getPrimaryAuthorName(a), getPrimaryAuthorName(b));
  if (byAuthor !== 0) return byAuthor;
  const byYear = compareYearAscending(a?.year, b?.year);
  if (byYear !== 0) return byYear;
  return cmp(a?.title || "", b?.title || "");
}

function compareByYear(a, b) {
  const byYear = compareYearAscending(a?.year, b?.year);
  if (byYear !== 0) return byYear;
  const byAuthor = cmp(getPrimaryAuthorName(a), getPrimaryAuthorName(b));
  if (byAuthor !== 0) return byAuthor;
  return cmp(a?.title || "", b?.title || "");
}

function compareYearAscending(a, b) {
  const yearA = normalizeYear(a);
  const yearB = normalizeYear(b);
  if (yearA != null && yearB != null) return yearA - yearB;
  if (yearA != null) return -1;
  if (yearB != null) return 1;
  return 0;
}

function normalizeYear(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const year = Number(value);
  return Number.isInteger(year) ? year : null;
}

function normalizeAuthors(authors) {
  if (!Array.isArray(authors)) return [];
  return authors
    .map((author) => normalizeString(author?.name))
    .filter(Boolean);
}

function getPrimaryAuthorName(node) {
  const first = normalizeAuthors(node?.authors)[0];
  if (!first) return "zzzz_unknown_author";
  const normalized = first.replace(/,/g, " ").trim();
  const parts = normalized.split(/\s+/).filter(Boolean);
  const surname = parts.length ? parts[parts.length - 1] : normalized;
  return `${surname}|${normalized}`;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function toBibtexKey(paperId, firstAuthorName, year) {
  const authorFragment = normalizeKeyFragment(firstAuthorName?.split(/\s+/).slice(-1)[0] || "unknown");
  const yearFragment = normalizeKeyFragment(year || "noyear");
  const idFragment = normalizeKeyFragment(paperId).slice(-8) || "s2";
  return `${authorFragment}${yearFragment}${idFragment}`.slice(0, 48);
}

function normalizeKeyFragment(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 20) || "x";
}

function escapeBibtexValue(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n+/g, " ")
    .trim();
}

function cmp(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
}
