export class ProxyHttpError extends Error {
  constructor({ code, message, status = 500, upstreamStatus, retryAfterSeconds } = {}) {
    super(message || code || "Proxy error");
    this.name = "ProxyHttpError";
    this.code = code || "internal_error";
    this.status = status;
    this.upstreamStatus = upstreamStatus;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function badRequest(message) {
  return new ProxyHttpError({
    code: "bad_request",
    message,
    status: 400,
  });
}

export function mapUpstreamError({ status, bodyText = "", retryAfterSeconds }) {
  let message = "Semantic Scholar API request failed";
  let code = "upstream_error";
  let responseStatus = 502;

  if (status === 400) {
    code = "upstream_bad_request";
    message = "Semantic Scholar API rejected the request";
    responseStatus = 400;
  } else if (status === 401) {
    code = "upstream_unauthorized";
    message = "Semantic Scholar API authentication failed (check x-api-key)";
    responseStatus = 401;
  } else if (status === 403) {
    code = "upstream_forbidden";
    message = "Semantic Scholar API request is forbidden (check API key permissions or quotas)";
    responseStatus = 403;
  } else if (status === 404) {
    code = "not_found";
    message = "Paper not found";
    responseStatus = 404;
  } else if (status === 429) {
    code = "rate_limited";
    message = "Semantic Scholar API rate limit reached";
    responseStatus = 429;
  } else if (status >= 500) {
    code = "upstream_unavailable";
    message = "Semantic Scholar API is temporarily unavailable";
    responseStatus = 502;
  } else if (status >= 400 && status < 500) {
    code = "upstream_client_error";
    message = "Semantic Scholar API rejected the request";
    responseStatus = status;
  }

  const parsedMessage = extractMessageFromBody(bodyText);
  if (parsedMessage) {
    message = parsedMessage;
  }

  return new ProxyHttpError({
    code,
    message,
    status: responseStatus,
    upstreamStatus: status,
    retryAfterSeconds,
  });
}

function extractMessageFromBody(bodyText) {
  if (!bodyText) return "";
  try {
    const json = JSON.parse(bodyText);
    return json.error || json.message || "";
  } catch {
    return bodyText.length > 200 ? bodyText.slice(0, 200) : bodyText;
  }
}

export function sendError(res, error) {
  const normalized = isProxyLikeError(error)
    ? normalizeProxyLikeError(error)
    : new ProxyHttpError({
        code: "internal_error",
        message: error?.message || "Unexpected server error",
        status: 500,
      });

  const payload = {
    error: {
      code: normalized.code,
      message: normalized.message,
    },
  };

  if (normalized.upstreamStatus != null) {
    payload.error.upstreamStatus = normalized.upstreamStatus;
  }
  if (normalized.retryAfterSeconds != null) {
    payload.error.retryAfterSeconds = normalized.retryAfterSeconds;
    res.setHeader("Retry-After", String(normalized.retryAfterSeconds));
  }

  res.status(normalized.status).json(payload);
}

function isProxyLikeError(error) {
  return Boolean(
    error
    && typeof error === "object"
    && (error instanceof ProxyHttpError || error.name === "ProxyHttpError")
    && typeof error.status === "number",
  );
}

function normalizeProxyLikeError(error) {
  if (error instanceof ProxyHttpError) {
    return error;
  }

  return new ProxyHttpError({
    code: error.code,
    message: error.message,
    status: error.status,
    upstreamStatus: error.upstreamStatus,
    retryAfterSeconds: error.retryAfterSeconds,
  });
}
