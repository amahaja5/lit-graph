export function normalizeAuthors(authors) {
  if (!Array.isArray(authors)) return [];
  return authors
    .filter((author) => author && typeof author === "object")
    .map((author) => ({
      authorId: author.authorId ?? null,
      name: typeof author.name === "string" && author.name.trim() ? author.name.trim() : "Unknown author",
    }));
}

export function formatAuthorNames(authors, { max = 8 } = {}) {
  const list = normalizeAuthors(authors).map((a) => a.name);
  if (!list.length) return "Authors unavailable";
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} +${list.length - max} more`;
}

export function normalizePaperRecord(paper) {
  if (!paper || typeof paper !== "object") return null;
  const paperId = asStringOrNull(paper.paperId);
  if (!paperId) return null;

  return {
    id: paperId,
    paperId,
    title: asStringOrFallback(paper.title, "Untitled paper"),
    year: asIntOrNull(paper.year),
    abstract: asStringOrNull(paper.abstract),
    authors: normalizeAuthors(paper.authors),
    citationCount: asIntOrZero(paper.citationCount),
    influentialCitationCount: asIntOrZero(paper.influentialCitationCount),
    referenceCount: asIntOrZero(paper.referenceCount),
    url: asStringOrNull(paper.url),
    venue: asStringOrNull(paper.venue),
    state: "unexplored",
    isRoot: false,
    isSelected: false,
    isInReviewCart: false,
    errorMessage: null,
  };
}

export function toPaperNode(paper, overrides = {}) {
  const normalized = normalizePaperRecord(paper);
  if (!normalized) return null;
  return { ...normalized, ...overrides };
}

export function normalizeCitationBatch(sourcePaperId, batch) {
  return normalizeExpansionBatch({
    relation: "citation",
    sourcePaperId,
    batch,
    nestedKey: "citingPaper",
  });
}

export function normalizeReferenceBatch(sourcePaperId, batch) {
  return normalizeExpansionBatch({
    relation: "reference",
    sourcePaperId,
    batch,
    nestedKey: "citedPaper",
  });
}

export function candidateToPaperNode(candidate) {
  if (!candidate?.targetPaper) return null;
  return { ...candidate.targetPaper };
}

export function candidateToGraphLink(candidate) {
  if (!candidate?.sourcePaperId || !candidate?.targetPaper?.paperId) return null;

  let source;
  let target;
  if (candidate.relation === "citation") {
    source = candidate.targetPaper.paperId;
    target = candidate.sourcePaperId;
  } else {
    source = candidate.sourcePaperId;
    target = candidate.targetPaper.paperId;
  }

  const id = `${source}->${target}:${candidate.relation}`;
  return {
    id,
    source,
    target,
    relation: candidate.relation,
    isInfluential: Boolean(candidate.isInfluential),
    contextsCount: Array.isArray(candidate.contexts) ? candidate.contexts.length : 0,
  };
}

function normalizeExpansionBatch({ relation, sourcePaperId, batch, nestedKey }) {
  const data = Array.isArray(batch?.data) ? batch.data : [];
  const candidates = [];

  for (const item of data) {
    const nestedPaper = normalizePaperRecord(item?.[nestedKey]);
    if (!nestedPaper) continue;

    candidates.push({
      relation,
      sourcePaperId,
      targetPaper: nestedPaper,
      isInfluential: Boolean(item?.isInfluential),
      contexts: Array.isArray(item?.contexts) ? item.contexts.filter((c) => typeof c === "string") : [],
    });
  }

  return {
    candidates,
    offset: asIntOrZero(batch?.offset),
    next: asIntOrNull(batch?.next),
    truncated: batch?.next != null,
  };
}

function asStringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringOrFallback(value, fallback) {
  return asStringOrNull(value) ?? fallback;
}

function asIntOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}

function asIntOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0;
}
