import { badRequest } from "../shared/errors.js";
import { createEvidenceJudgments, createJudgmentBudget } from '../evidence/evidenceJudgments.js';
import { evidenceHash } from '../models/typesafeClient.js';
import {
  createHtmlReviewEvidenceProvider,
  REVIEW_COVERAGE_ABSTRACT_ONLY,
  REVIEW_COVERAGE_HTML_PLUS_ABSTRACT,
} from "./reviewEvidence.js";
import {
  REVIEW_MAX_PAPERS_DEFAULT,
  REVIEW_MIN_PAPERS,
  REVIEW_MODE_HTML,
  REVIEW_OUTPUT_STRUCTURED_SYNTHESIS,
} from "./reviewRequest.js";

export const REVIEW_BATCH_FIELDS = [
  "title",
  "authors",
  "year",
  "abstract",
  "url",
  "venue",
  "externalIds",
  "isOpenAccess",
  "openAccessPdf",
  "textAvailability",
].join(",");

export function createReviewService({
  s2Client,
  anthropicClient,
  fetchImpl = globalThis.fetch,
  logger = console,
  evidenceCache,
  reviewCache,
  maxPapers = readNonNegativeIntEnv("REVIEW_MAX_PAPERS", REVIEW_MAX_PAPERS_DEFAULT),
  maxSourceCharsPerPaper = readNonNegativeIntEnv("REVIEW_MAX_SOURCE_CHARS_PER_PAPER", 12_000),
  judgments = createEvidenceJudgments(),
} = {}) {
  if (!s2Client?.getPapersBatch) {
    throw new Error("Review service requires s2Client.getPapersBatch");
  }
  if (!anthropicClient?.generateStructuredSynthesis) {
    throw new Error("Review service requires anthropicClient.generateStructuredSynthesis");
  }

  const evidenceProvider = createHtmlReviewEvidenceProvider({
    fetchImpl,
    cache: evidenceCache,
    logger,
    maxSourceCharsPerPaper,
    judgments,
  });

  async function generateReview({ paperIds, mode, outputShape }, { signal } = {}) {
    const budget = createJudgmentBudget(signal);
    const normalizedPaperIds = normalizeReviewPaperIds(paperIds, { maxPapers });
    if (mode !== REVIEW_MODE_HTML) {
      throw badRequest(`mode must be ${REVIEW_MODE_HTML}.`);
    }
    if (outputShape !== REVIEW_OUTPUT_STRUCTURED_SYNTHESIS) {
      throw badRequest(`outputShape must be ${REVIEW_OUTPUT_STRUCTURED_SYNTHESIS}.`);
    }

    const papers = await s2Client.getPapersBatch(normalizedPaperIds, { fields: REVIEW_BATCH_FIELDS });
    const normalizedPapers = normalizeBatchPapers(normalizedPaperIds, papers);
    if (normalizedPapers.length < REVIEW_MIN_PAPERS) {
      throw badRequest(`At least ${REVIEW_MIN_PAPERS} resolvable papers are required to generate a review.`);
    }

    const warnings = [];
    const references = [];
    const packetParts = [];
    let transientFailure = false;

    for (let index = 0; index < normalizedPapers.length; index += 1) {
      const paper = normalizedPapers[index];
      const refId = `R${index + 1}`;
      signal?.throwIfAborted();
      const evidence = await evidenceProvider.buildEvidenceForPaper(paper, { refId, budget });
      transientFailure ||= evidence.transientFailure;
      warnings.push(...evidence.warnings);
      references.push({
        refId,
        paperId: evidence.paperId,
        title: evidence.title,
        year: evidence.year,
        sourceUrl: evidence.sourceUrl,
        coverage: evidence.coverage,
        quality: evidence.quality,
      });
      packetParts.push(buildPaperPacket(evidence));
    }

    const cacheKey = `${buildReviewCacheKey(normalizedPaperIds, mode, outputShape)}:${judgments.configKey}:${evidenceHash({ packetParts, warnings })}`;
    const cached = !transientFailure && reviewCache?.get?.(cacheKey);
    if (cached) return { ...cached, references };
    signal?.throwIfAborted();
    const { model, review } = await anthropicClient.generateStructuredSynthesis({
      corpusPacket: packetParts.join("\n\n---\n\n"),
      allowedReferenceIds: references.map((reference) => reference.refId),
    });

    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      model,
      mode,
      outputShape,
      review,
      references,
      warnings: dedupeWarnings(warnings),
      stale: false,
    };

    if (!transientFailure) reviewCache?.set?.(cacheKey, payload);
    return payload;
  }

  return {
    generateReview,
    _internals: {
      normalizeReviewPaperIds,
      buildReviewCacheKey,
      buildPaperPacket,
    },
  };
}

function normalizeReviewPaperIds(paperIds, { maxPapers }) {
  const ids = Array.isArray(paperIds)
    ? [...new Set(paperIds.map((paperId) => String(paperId || "").trim()).filter(Boolean))]
    : [];

  if (ids.length < REVIEW_MIN_PAPERS) {
    throw badRequest(`Add at least ${REVIEW_MIN_PAPERS} papers to the review cart before generating a review.`);
  }
  if (ids.length > maxPapers) {
    throw badRequest(`Review generation is limited to ${maxPapers} papers. Narrow the review cart and try again.`);
  }
  return ids;
}

function normalizeBatchPapers(requestedPaperIds, papers) {
  const list = Array.isArray(papers) ? papers : [];
  const byPaperId = new Map();
  for (const paper of list) {
    if (paper?.paperId) {
      byPaperId.set(String(paper.paperId), paper);
    }
  }

  return requestedPaperIds
    .map((paperId) => byPaperId.get(paperId) || null)
    .filter(Boolean);
}

function buildReviewCacheKey(paperIds, mode, outputShape) {
  return `review:${mode}:${outputShape}:${paperIds.join("|")}`;
}

function buildPaperPacket(evidence) {
  const authorNames = Array.isArray(evidence.authors)
    ? evidence.authors
      .map((author) => typeof author?.name === "string" && author.name.trim() ? author.name.trim() : "")
      .filter(Boolean)
      .join(", ")
    : "";

  return [
    `${evidence.refId}`,
    `Title: ${evidence.title}`,
    `Authors: ${authorNames || "Unknown authors"}`,
    `Year: ${evidence.year ?? "Unknown"}`,
    `Venue: ${evidence.venue || "Unknown venue"}`,
    `Source URL: ${evidence.sourceUrl || "Unavailable"}`,
    `Coverage: ${evidence.coverage === REVIEW_COVERAGE_HTML_PLUS_ABSTRACT ? "html_plus_abstract" : REVIEW_COVERAGE_ABSTRACT_ONLY}`,
    "",
    "Abstract:",
    evidence.abstract || "Abstract unavailable.",
    "",
    "Extracted Source Text:",
    evidence.extractedText || "Readable HTML text unavailable.",
  ].join("\n");
}

function dedupeWarnings(warnings) {
  return [...new Set((Array.isArray(warnings) ? warnings : []).filter((warning) => typeof warning === "string" && warning.trim()))];
}

function readNonNegativeIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}
