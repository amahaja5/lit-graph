import { TTLCache, makeCacheKey } from "./cache.js";
import { ProxyHttpError } from "./errors.js";

const NBER_PAGE_URL_BASE = "https://www.nber.org/papers";
const NBER_TITLE_MATCH_FIELDS = [
  "title",
  "year",
  "authors",
  "citationCount",
  "influentialCitationCount",
  "referenceCount",
  "url",
  "venue",
].join(",");

export function createPaperIdResolver({
  s2Client,
  fetchImpl = globalThis.fetch,
  cache = new TTLCache({ ttlMs: 10 * 60 * 1000 }),
  logger = console,
} = {}) {
  return {
    async resolveSeedPaperId(rawInput) {
      const input = String(rawInput || "").trim();
      if (!input) return input;

      const cacheKey = makeCacheKey("resolve-seed-paper-id", { input });
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const parsed = parseNberInput(input);
      if (!parsed) {
        cache.set(cacheKey, input);
        return input;
      }

      let resolvedPaperId;
      if (parsed.seriesPrefix === "w" && parsed.seriesId) {
        // NBER working papers typically use DOI 10.3386/w#####, but S2 does not
        // reliably index every paper by that DOI. Fall back to page/title
        // resolution when the DOI is not found in S2.
        resolvedPaperId = await resolveNberWorkingPaper(parsed, { s2Client, fetchImpl, logger });
      } else {
        resolvedPaperId = await resolveViaNberPage(parsed, { s2Client, fetchImpl, logger });
      }

      cache.set(cacheKey, resolvedPaperId);
      return resolvedPaperId;
    },
    _internals: {
      cache,
    },
  };
}

export function parseNberInput(input) {
  const normalized = String(input || "").trim();
  if (!normalized) return null;

  // Examples:
  // - NBER:w12345
  const namespaced = normalized.match(/^NBER\s*:\s*(.+)$/i);
  if (!namespaced) return null;

  const payload = namespaced[1].trim();
  const fromUrl = parseNberUrl(payload);
  if (fromUrl) {
    return {
      ...fromUrl,
      rawInput: normalized,
    };
  }

  const idMatch = payload.match(/^([A-Za-z]{1,4}\d{3,})$/i);
  if (idMatch) {
    const id = idMatch[1].toLowerCase();
    return {
      type: "nber-paper-id",
      rawInput: normalized,
      seriesId: id,
      seriesPrefix: id[0],
      nberUrl: `${NBER_PAGE_URL_BASE}/${id}`,
    };
  }

  return null;
}

function parseNberUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname !== "nber.org" && hostname !== "www.nber.org") return null;

  const match = url.pathname.match(/^\/papers\/([A-Za-z]{1,4}\d{3,})(?:\/)?$/i);
  if (!match) return null;

  const id = match[1].toLowerCase();
  return {
    type: "nber-url",
    rawInput: value,
    seriesId: id,
    seriesPrefix: id[0],
    nberUrl: `${url.origin}/papers/${id}`,
  };
}

async function resolveViaNberPage(parsed, { s2Client, fetchImpl, logger }) {
  return resolveViaNberPageInternal(parsed, { s2Client, fetchImpl, logger, skipDoiReturn: false });
}

async function resolveNberWorkingPaper(parsed, { s2Client, fetchImpl, logger }) {
  const doiPaperId = `DOI:10.3386/${parsed.seriesId}`;

  if (!s2Client?.getPaper) {
    return doiPaperId;
  }

  try {
    await s2Client.getPaper(doiPaperId, { fields: "title" });
    return doiPaperId;
  } catch (error) {
    if (!isS2NotFoundError(error)) {
      throw error;
    }

    logger?.debug?.("NBER DOI not found in S2, falling back to NBER page/title resolution", {
      nberSeriesId: parsed.seriesId,
      doiPaperId,
    });

    return resolveViaNberPageInternal(parsed, {
      s2Client,
      fetchImpl,
      logger,
      skipDoiReturn: true,
    });
  }
}

async function resolveViaNberPageInternal(parsed, { s2Client, fetchImpl, logger, skipDoiReturn = false }) {
  if (typeof fetchImpl !== "function") {
    throw new ProxyHttpError({
      code: "resolver_unavailable",
      message: "Server cannot resolve NBER input (fetch unavailable)",
      status: 500,
    });
  }

  const response = await fetchImpl(parsed.nberUrl, {
    headers: {
      "user-agent": "LitGraph/0.1 (+NBER resolver)",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new ProxyHttpError({
      code: response.status === 404 ? "nber_not_found" : "nber_fetch_failed",
      message: response.status === 404 ? "NBER paper page not found" : "Failed to fetch NBER paper page",
      status: response.status === 404 ? 404 : 502,
      upstreamStatus: response.status,
    });
  }

  const html = await response.text();
  const metadata = extractNberPageMetadata(html);

  if (metadata.doi && !skipDoiReturn) {
    return `DOI:${metadata.doi}`;
  }

  const title = metadata.title;
  if (title && s2Client?.searchPaperMatch) {
    try {
      const match = await s2Client.searchPaperMatch(title, { fields: NBER_TITLE_MATCH_FIELDS });
      const paper = extractFirstTitleMatch(match);
      if (paper?.paperId) {
        logger?.debug?.("Resolved NBER via title match", {
          nberSeriesId: parsed.seriesId,
          title,
          paperId: paper.paperId,
        });
        return paper.paperId;
      }
    } catch (error) {
      logger?.debug?.("NBER title match fallback failed", {
        nberSeriesId: parsed.seriesId,
        title,
        message: error?.message,
      });
      throw error;
    }
  }

  throw new ProxyHttpError({
    code: "nber_unresolved",
    message: "Could not resolve NBER paper to a Semantic Scholar paper",
    status: 404,
  });
}

export function extractNberPageMetadata(html) {
  const meta = parseMetaTags(html);
  const doi = normalizeDoi(
    firstNonEmpty(
      meta.get("citation_doi"),
      meta.get("dc.identifier"),
      meta.get("dc.identifier.doi"),
      meta.get("doi"),
    ),
  );

  const title = normalizeTitle(
    firstNonEmpty(
      meta.get("citation_title"),
      meta.get("og:title"),
      meta.get("twitter:title"),
      extractTitleTag(html),
    ),
  );

  return { doi, title };
}

function parseMetaTags(html) {
  const map = new Map();
  if (typeof html !== "string" || !html) return map;

  const tagRegex = /<meta\b[^>]*>/gi;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const tag = match[0];
    const attrs = parseHtmlAttributes(tag);
    const key = String(attrs.name || attrs.property || attrs["http-equiv"] || "").trim().toLowerCase();
    const content = String(attrs.content || "").trim();
    if (!key || !content) continue;
    if (!map.has(key)) {
      map.set(key, content);
    }
  }

  return map;
}

function parseHtmlAttributes(tag) {
  const attrs = {};
  const attrRegex = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = attrRegex.exec(tag)) !== null) {
    const name = match[1].toLowerCase();
    const value = htmlDecode(match[2] ?? match[3] ?? match[4] ?? "");
    attrs[name] = value;
  }
  return attrs;
}

function extractTitleTag(html) {
  if (typeof html !== "string" || !html) return null;
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlDecode(match[1]).trim() : null;
}

function normalizeDoi(value) {
  if (!value) return null;
  let doi = String(value).trim();
  doi = doi.replace(/^https?:\/\/doi\.org\//i, "");
  doi = doi.replace(/^doi:\s*/i, "");
  doi = doi.trim();
  if (!doi) return null;

  const direct = doi.match(/10\.[0-9]{4,9}\/\S+/i);
  return direct ? direct[0].replace(/[)>.,;\s]+$/g, "") : null;
}

function normalizeTitle(value) {
  if (!value) return null;
  let title = String(value).replace(/\s+/g, " ").trim();
  title = title.replace(/\s*\|\s*NBER\s*$/i, "").trim();
  title = title.replace(/\s*-\s*National Bureau of Economic Research\s*$/i, "").trim();
  return title || null;
}

function extractFirstTitleMatch(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (Array.isArray(payload.data)) return payload.data[0] || null;
  if (payload.paperId) return payload;
  return null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function htmlDecode(value) {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/");
}

function isS2NotFoundError(error) {
  return error instanceof ProxyHttpError && error.status === 404;
}
