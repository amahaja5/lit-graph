import { TTLCache, makeCacheKey } from "./cache.js";
import { ProxyHttpError, mapUpstreamError } from "./errors.js";

const DEFAULT_BASE_URL = "https://api.semanticscholar.org/graph/v1";

export function createS2ProxyClient({
  baseUrl = DEFAULT_BASE_URL,
  apiKey = process.env.S2_API_KEY,
  fetchImpl = globalThis.fetch,
  cache = new TTLCache(),
  logger = console,
  retryBackoffMs = 300,
  minIntervalMs = 0,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required");
  }

  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const normalizedMinIntervalMs = normalizeMinInterval(minIntervalMs);
  let fetchQueue = Promise.resolve();
  let nextFetchAllowedAt = 0;

  async function getPaper(paperId, query = {}) {
    return requestJson(`/paper/${encodeURIComponent(paperId)}`, query);
  }

  async function getCitations(paperId, query = {}) {
    return requestJson(`/paper/${encodeURIComponent(paperId)}/citations`, query);
  }

  async function getReferences(paperId, query = {}) {
    return requestJson(`/paper/${encodeURIComponent(paperId)}/references`, query);
  }

  async function searchPaperMatch(queryText, query = {}) {
    return requestJson("/paper/search/match", {
      query: queryText,
      ...query,
    });
  }

  async function requestJson(pathname, query = {}) {
    const cacheKey = makeCacheKey(pathname, query);
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      logger?.debug?.(`cache hit ${cacheKey}`);
      return cached;
    }

    const url = new URL(`${normalizedBaseUrl}${pathname}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }

    const headers = {
      accept: "application/json",
    };
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    logger?.debug?.("[litgraph s2] request", {
      url: url.toString(),
      hasApiKey: Boolean(apiKey),
    });

    const response = await fetchWithRetry(url, { headers });
    const contentType = response.headers.get("content-type") || "";
    const bodyText = await response.text();

    if (!response.ok) {
      const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
      logger?.error?.("[litgraph s2] upstream error", {
        url: url.toString(),
        status: response.status,
        contentType,
        retryAfterSeconds,
        bodyPreview: summarizeBodyText(bodyText),
      });
      throw mapUpstreamError({
        status: response.status,
        bodyText,
        retryAfterSeconds,
      });
    }

    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      logger?.error?.("[litgraph s2] invalid json", {
        url: url.toString(),
        status: response.status,
        contentType,
        bodyPreview: summarizeBodyText(bodyText),
      });
      throw new ProxyHttpError({
        code: "invalid_upstream_response",
        message: "Semantic Scholar API returned invalid JSON",
        status: 502,
        upstreamStatus: response.status,
      });
    }

    logger?.debug?.("[litgraph s2] response", {
      url: url.toString(),
      status: response.status,
      contentType,
    });

    cache.set(cacheKey, data);
    return data;
  }

  async function fetchWithRetry(url, options) {
    const first = await throttledFetch(url, options);
    if (!isRetryable(first.status)) {
      return first;
    }

    const retryAfter = parseRetryAfter(first.headers.get("retry-after"));
    const waitMs = retryAfter != null ? retryAfter * 1000 : retryBackoffMs;

    logger?.debug?.("[litgraph s2] retry", {
      url: url.toString(),
      status: first.status,
      waitMs,
    });

    await delay(waitMs);

    return throttledFetch(url, options);
  }

  async function throttledFetch(url, options) {
    if (!normalizedMinIntervalMs) {
      return fetchImpl(url, options);
    }

    const scheduled = fetchQueue.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, nextFetchAllowedAt - now);
      if (waitMs > 0) {
        logger?.debug?.(`s2 throttle wait ${waitMs}ms`);
        await delay(waitMs);
      }

      nextFetchAllowedAt = Date.now() + normalizedMinIntervalMs;
      return fetchImpl(url, options);
    });

    // Keep the queue alive even if an upstream request fails.
    fetchQueue = scheduled.then(
      () => undefined,
      () => undefined,
    );

    return scheduled;
  }

  return {
    getPaper,
    getCitations,
    getReferences,
    searchPaperMatch,
    _internals: {
      requestJson,
      cache,
      baseUrl: normalizedBaseUrl,
      minIntervalMs: normalizedMinIntervalMs,
    },
  };
}

function isRetryable(status) {
  return status === 429 || status >= 500;
}

function parseRetryAfter(value) {
  if (!value) return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.floor(asNumber);
  }
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    const delta = Math.ceil((dateMs - Date.now()) / 1000);
    return Math.max(0, delta);
  }
  return null;
}

function delay(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMinInterval(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function summarizeBodyText(value, maxLength = 400) {
  if (!value) return "";
  const compact = String(value).replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength)}...`;
}
