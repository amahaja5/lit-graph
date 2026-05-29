import { getS2Client } from "../../../lib/setup.js";
import { badRequest, sendError } from "../../../lib/errors.js";

const REFERENCES_QUERY_ALLOWLIST = new Set(["fields", "limit", "offset"]);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { paperId } = req.query;
    const rawPaperId = requirePaperId(paperId);

    const client = getS2Client();
    const query = sanitizeQuery(req.query, REFERENCES_QUERY_ALLOWLIST);
    validatePagingQuery(query);
    const data = await client.getReferences(rawPaperId, query);

    res.json(data);
  } catch (error) {
    sendError(res, error);
  }
}

function requirePaperId(paperId) {
  if (!paperId || !String(paperId).trim()) {
    throw badRequest("paperId is required");
  }
  return String(paperId);
}

function sanitizeQuery(rawQuery, allowlist) {
  const sanitized = {};
  for (const [key, value] of Object.entries(rawQuery || {})) {
    if (!allowlist.has(key)) {
      throw badRequest(`Unsupported query parameter: ${key}`);
    }
    if (Array.isArray(value)) {
      throw badRequest(`Repeated query parameter is not supported: ${key}`);
    }
    if (value === undefined || value === null || value === "") continue;
    sanitized[key] = String(value);
  }
  return sanitized;
}

function validatePagingQuery(query) {
  if (query.limit != null) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
      throw badRequest("limit must be an integer between 1 and 1000");
    }
  }
  if (query.offset != null) {
    const offset = Number(query.offset);
    if (!Number.isInteger(offset) || offset < 0) {
      throw badRequest("offset must be a non-negative integer");
    }
  }
}
