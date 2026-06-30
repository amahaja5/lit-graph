export const SEED_FIELDS = [
  "title",
  "authors",
  "year",
  "abstract",
  "citationCount",
  "influentialCitationCount",
  "referenceCount",
  "url",
  "venue",
].join(",");

export const BIBTEX_FIELDS = [
  "title",
  "authors",
  "year",
  "citationStyles",
].join(",");

export const IDENTIFIER_FIELDS = [
  "title",
  "paperId",
  "url",
  "externalIds",
].join(",");

export const CITATION_FIELDS = [
  "isInfluential",
  "contexts",
  // For /citations and /references, paper fields are requested flat and returned
  // nested under citingPaper/citedPaper by the API.
  "title",
  "authors",
  "year",
  "abstract",
  "citationCount",
  "influentialCitationCount",
  "referenceCount",
  "url",
  "venue",
].join(",");

export const REFERENCE_FIELDS = [
  "isInfluential",
  "contexts",
  "title",
  "authors",
  "year",
  "abstract",
  "citationCount",
  "influentialCitationCount",
  "referenceCount",
  "url",
  "venue",
].join(",");

export const DEFAULT_EXPANSION_LIMIT = 100;

export class ApiError extends Error {
  constructor(message, { code = "api_error", status, retryAfterSeconds } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function createApiClient({ baseUrl = "" } = {}) {
  return {
    async fetchPaper(paperId) {
      return requestJson(buildUrl(`${baseUrl}/api/paper/${encodePathParam(paperId)}`, {
        fields: SEED_FIELDS,
      }));
    },

    async fetchPaperBibtex(paperId) {
      return requestJson(buildUrl(`${baseUrl}/api/paper/${encodePathParam(paperId)}`, {
        fields: BIBTEX_FIELDS,
      }));
    },

    async fetchPaperIdentifiers(paperId) {
      return requestJson(buildUrl(`${baseUrl}/api/paper/${encodePathParam(paperId)}`, {
        fields: IDENTIFIER_FIELDS,
      }));
    },

    async fetchCitations(paperId, { limit = DEFAULT_EXPANSION_LIMIT, offset = 0 } = {}) {
      return requestJson(buildUrl(`${baseUrl}/api/paper/${encodePathParam(paperId)}/citations`, {
        fields: CITATION_FIELDS,
        limit,
        offset,
      }));
    },

    async fetchReferences(paperId, { limit = DEFAULT_EXPANSION_LIMIT, offset = 0 } = {}) {
      return requestJson(buildUrl(`${baseUrl}/api/paper/${encodePathParam(paperId)}/references`, {
        fields: REFERENCE_FIELDS,
        limit,
        offset,
      }));
    },

    async fetchExpansion(paperId, options) {
      const [citations, references] = await Promise.all([
        this.fetchCitations(paperId, options),
        this.fetchReferences(paperId, options),
      ]);
      return { citations, references };
    },
  };
}

function buildUrl(pathname, query = {}) {
  const url = new URL(pathname, window.location.origin);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

function encodePathParam(value) {
  return encodeURIComponent(String(value).trim());
}

async function requestJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });

  const text = await response.text();
  let data;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError("Server returned invalid JSON", { status: response.status });
    }
  } else {
    data = null;
  }

  if (!response.ok) {
    const errorBody = data?.error;
    throw new ApiError(
      errorBody?.message || `Request failed with status ${response.status}`,
      {
        code: errorBody?.code || "api_error",
        status: response.status,
        retryAfterSeconds: errorBody?.retryAfterSeconds,
      },
    );
  }

  return data;
}
