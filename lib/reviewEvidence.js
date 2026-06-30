const COVERAGE_ABSTRACT_ONLY = "abstract_only";
const COVERAGE_HTML_PLUS_ABSTRACT = "html_plus_abstract";
const MIN_EXTRACTED_TEXT_LENGTH = 150;

export function createHtmlReviewEvidenceProvider({
  fetchImpl = globalThis.fetch,
  cache,
  logger = console,
  maxSourceCharsPerPaper = 12_000,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required");
  }

  return {
    async buildEvidenceForPaper(paper, { refId } = {}) {
      const normalizedPaper = normalizePaperForEvidence(paper);
      const sourceUrl = resolveReviewSourceUrl(normalizedPaper);
      const cacheKey = buildEvidenceCacheKey(normalizedPaper.paperId, sourceUrl, maxSourceCharsPerPaper);
      const cached = cache?.get?.(cacheKey);
      if (cached) {
        return cached;
      }

      const abstractText = normalizeWhitespace(normalizedPaper.abstract || "");
      const warnings = [];
      let extractedText = "";

      if (sourceUrl) {
        try {
          const html = await fetchReadableHtml(fetchImpl, sourceUrl);
          extractedText = extractReadableTextFromHtml(html, { maxChars: maxSourceCharsPerPaper });
        } catch (error) {
          warnings.push(formatFetchWarning(refId, sourceUrl, error));
          logger?.debug?.(`review html fetch failed for ${normalizedPaper.paperId}: ${error?.message || error}`);
        }
      } else {
        warnings.push(`${refId}: no source URL could be resolved; using abstract only.`);
      }

      const coverage = extractedText ? COVERAGE_HTML_PLUS_ABSTRACT : COVERAGE_ABSTRACT_ONLY;
      if (!extractedText && abstractText) {
        warnings.push(`${refId}: HTML text unavailable or too thin; using abstract only.`);
      } else if (!extractedText && !abstractText) {
        warnings.push(`${refId}: no readable HTML text or abstract available; review quality will be limited.`);
      }

      const evidence = {
        refId,
        paperId: normalizedPaper.paperId,
        title: normalizedPaper.title,
        year: normalizedPaper.year,
        authors: normalizedPaper.authors,
        venue: normalizedPaper.venue,
        sourceUrl: sourceUrl || normalizedPaper.url || buildSemanticScholarUrl(normalizedPaper.paperId),
        abstract: abstractText,
        extractedText,
        coverage,
        warnings,
      };

      cache?.set?.(cacheKey, evidence);
      return evidence;
    },
  };
}

export function resolveReviewSourceUrl(paper) {
  const paperId = asNonEmptyString(paper?.paperId);
  const externalIds = paper?.externalIds && typeof paper.externalIds === "object" ? paper.externalIds : {};

  const arxivId = normalizeArxivId(
    pickExternalId(externalIds, ["ArXiv", "ARXIV", "arXiv", "arxiv"])
      || (paperId.toUpperCase().startsWith("ARXIV:") ? paperId.slice("ARXIV:".length) : ""),
  );
  if (arxivId) {
    return `https://arxiv.org/abs/${encodeURIComponent(arxivId)}`;
  }

  const nberId = normalizeNberId(
    pickExternalId(externalIds, ["NBER", "nber"])
      || extractNberFromDoi(pickExternalId(externalIds, ["DOI", "doi"]))
      || extractNberFromDoi(paperId.toUpperCase().startsWith("DOI:") ? paperId.slice("DOI:".length) : ""),
  );
  if (nberId) {
    return `https://www.nber.org/papers/${nberId}`;
  }

  const pmid = normalizePmid(
    pickExternalId(externalIds, ["PubMed", "pubmed", "PMID", "pmid", "Medline", "medline"])
      || (paperId.toUpperCase().startsWith("PMID:") ? paperId.slice("PMID:".length) : ""),
  );
  if (pmid) {
    return `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/`;
  }

  const doi = normalizeDoi(pickExternalId(externalIds, ["DOI", "doi"]));
  if (doi) {
    return `https://doi.org/${doi}`;
  }

  return asNonEmptyString(paper?.url) || buildSemanticScholarUrl(paperId);
}

export function extractReadableTextFromHtml(html, { maxChars = 12_000 } = {}) {
  const source = typeof html === "string" ? html : "";
  if (!source) return "";

  let region = pickLikelyContentRegion(source);
  region = stripElements(region, ["script", "style", "noscript", "svg", "nav", "footer", "header", "aside", "form", "button"]);
  region = region
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|li|ul|ol|h1|h2|h3|h4|h5|h6|blockquote|tr)>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");

  const text = normalizeWhitespace(htmlDecode(region), { preserveParagraphs: true });
  if (text.length < MIN_EXTRACTED_TEXT_LENGTH) {
    return "";
  }
  return clampText(text, maxChars);
}

function fetchReadableHtml(fetchImpl, url) {
  return fetchImpl(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "LitGraph/0.1 (+review-generator)",
    },
  }).then(async (response) => {
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      throw new Error(`source fetch failed (${response.status})`);
    }
    if (!/html|xhtml/i.test(contentType)) {
      throw new Error(`source returned unsupported content type (${contentType || "unknown"})`);
    }
    return response.text();
  });
}

function normalizePaperForEvidence(paper) {
  const source = paper && typeof paper === "object" ? paper : {};
  return {
    paperId: asNonEmptyString(source.paperId),
    title: asNonEmptyString(source.title) || "Untitled paper",
    year: normalizeYear(source.year),
    authors: Array.isArray(source.authors) ? source.authors : [],
    venue: asNonEmptyString(source.venue),
    abstract: asNonEmptyString(source.abstract),
    url: asNonEmptyString(source.url),
    externalIds: source.externalIds && typeof source.externalIds === "object" ? source.externalIds : {},
  };
}

function buildEvidenceCacheKey(paperId, sourceUrl, maxChars) {
  return `review-evidence:${paperId}:${sourceUrl || ""}:${maxChars}`;
}

function pickLikelyContentRegion(html) {
  const article = firstTagContents(html, "article");
  if (article) return article;
  const main = firstTagContents(html, "main");
  if (main) return main;
  const body = firstTagContents(html, "body");
  if (body) return body;
  return html;
}

function firstTagContents(html, tagName) {
  const match = html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1] : "";
}

function stripElements(html, tagNames) {
  let result = html;
  for (const tagName of tagNames) {
    const pattern = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "gi");
    result = result.replace(pattern, " ");
  }
  return result;
}

function normalizeWhitespace(value, { preserveParagraphs = false } = {}) {
  const text = typeof value === "string" ? value : "";
  if (!text) return "";

  if (!preserveParagraphs) {
    return text.replace(/\s+/g, " ").trim();
  }

  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clampText(text, maxChars) {
  if (!maxChars || text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const boundary = slice.lastIndexOf(" ");
  return `${(boundary > maxChars * 0.7 ? slice.slice(0, boundary) : slice).trim()}…`;
}

function formatFetchWarning(refId, sourceUrl, error) {
  const detail = error?.message ? ` (${error.message})` : "";
  return `${refId}: could not fetch HTML from ${sourceUrl}${detail}; using abstract only.`;
}

function pickExternalId(externalIds, keys) {
  for (const key of keys) {
    const value = asNonEmptyString(externalIds?.[key]);
    if (value) return value;
  }
  return "";
}

function normalizeArxivId(raw) {
  return asNonEmptyString(raw).replace(/^ARXIV:/i, "");
}

function normalizePmid(raw) {
  const value = asNonEmptyString(raw);
  if (!value) return "";
  const match = value.match(/(\d{4,})/);
  return match ? match[1] : "";
}

function normalizeNberId(raw) {
  const value = asNonEmptyString(raw);
  if (!value) return "";
  const match = value.match(/([a-z]\d{3,})/i);
  return match ? match[1].toLowerCase() : "";
}

function extractNberFromDoi(rawDoi) {
  const doi = normalizeDoi(rawDoi);
  const match = doi.match(/^10\.3386\/([a-z]\d{3,})$/i);
  return match ? match[1].toLowerCase() : "";
}

function normalizeDoi(raw) {
  return asNonEmptyString(raw).replace(/^https?:\/\/doi\.org\//i, "");
}

function buildSemanticScholarUrl(paperId) {
  return paperId ? `https://www.semanticscholar.org/paper/${encodeURIComponent(paperId)}` : "";
}

function normalizeYear(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

export const REVIEW_COVERAGE_ABSTRACT_ONLY = COVERAGE_ABSTRACT_ONLY;
export const REVIEW_COVERAGE_HTML_PLUS_ABSTRACT = COVERAGE_HTML_PLUS_ABSTRACT;
