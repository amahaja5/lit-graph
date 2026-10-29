import { ProxyHttpError, badRequest } from "../shared/errors.js";

export function sendError(res, error) {
  const normalized = error?.type === "entity.parse.failed"
    ? badRequest("Request body must be valid JSON.")
    : error instanceof ProxyHttpError
    ? error
    : new ProxyHttpError({
        code: "internal_error",
        message: "Unexpected server error",
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
