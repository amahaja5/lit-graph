import { badRequest } from "./errors.js";

export const REVIEW_MODE_HTML = "html";
export const REVIEW_OUTPUT_STRUCTURED_SYNTHESIS = "structured_synthesis";
export const REVIEW_MIN_PAPERS = 2;
export const REVIEW_MAX_PAPERS_DEFAULT = 10;

export function parseReviewGenerateRequestBody(rawBody) {
  const body = normalizeBody(rawBody);
  const paperIds = normalizePaperIds(body.paperIds);
  const mode = normalizeSingleEnum(body.mode, REVIEW_MODE_HTML, "mode");
  const outputShape = normalizeSingleEnum(
    body.outputShape,
    REVIEW_OUTPUT_STRUCTURED_SYNTHESIS,
    "outputShape",
  );

  return {
    paperIds,
    mode,
    outputShape,
  };
}

function normalizeBody(rawBody) {
  if (rawBody == null || rawBody === "") {
    throw badRequest("Request body is required.");
  }
  if (typeof rawBody === "string") {
    try {
      return JSON.parse(rawBody);
    } catch {
      throw badRequest("Request body must be valid JSON.");
    }
  }
  if (typeof rawBody === "object") {
    return rawBody;
  }
  throw badRequest("Request body must be a JSON object.");
}

function normalizePaperIds(rawPaperIds) {
  if (!Array.isArray(rawPaperIds)) {
    throw badRequest("paperIds must be an array.");
  }

  const seen = new Set();
  const paperIds = [];
  for (const rawPaperId of rawPaperIds) {
    const paperId = typeof rawPaperId === "string" ? rawPaperId.trim() : "";
    if (!paperId) continue;
    if (seen.has(paperId)) continue;
    seen.add(paperId);
    paperIds.push(paperId);
  }

  if (!paperIds.length) {
    throw badRequest("paperIds must contain at least one paper identifier.");
  }

  return paperIds;
}

function normalizeSingleEnum(value, expected, fieldName) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw badRequest(`${fieldName} is required.`);
  }
  if (normalized !== expected) {
    throw badRequest(`${fieldName} must be ${expected}.`);
  }
  return normalized;
}
