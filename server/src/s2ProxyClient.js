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
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required");
  }

  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

  async function getPaper(paperId, query = {}) {
    return requestJson(`/paper/${encodeURIComponent(paperId)}`, query);
  }

  async function getCitations(paperId, query = {}) {
    return requestJson(`/paper/${encodeURIComponent(paperId)}/citations`, query);
  }

  async function getReferences(paperId, query = {}) {
    return requestJson(`/paper/${encodeURIComponent(paperId)}/references`, query);
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

    const response = await fetchWithRetry(url, { headers });
    const contentType = response.headers.get("content-type") || "";
    const bodyText = await response.text();

    if (!response.ok) {
      throw mapUpstreamError({
        status: response.status,
        bodyText,
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
      });
    }

    let data;
    try {
      data = contentType.includes("application/json") ? JSON.parse(bodyText) : JSON.parse(bodyText);
    } catch {
      throw new ProxyHttpError({
        code: "invalid_upstream_response",
        message: "Semantic Scholar API returned invalid JSON",
        status: 502,
        upstreamStatus: response.status,
      });
    }

    cache.set(cacheKey, data);
    return data;
  }

  async function fetchWithRetry(url, options) {
    const first = await fetchImpl(url, options);
    if (!isRetryable(first.status)) {
      return first;
    }

    const retryAfter = parseRetryAfter(first.headers.get("retry-after"));
    const waitMs = retryAfter != null ? retryAfter * 1000 : retryBackoffMs;
    await delay(waitMs);

    return fetchImpl(url, options);
  }

  return {
    getPaper,
    getCitations,
    getReferences,
    _internals: {
      requestJson,
      cache,
      baseUrl: normalizedBaseUrl,
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
