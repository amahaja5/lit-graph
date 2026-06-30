import { getS2Client, getPaperIdResolver } from "../../lib/setup.js";
import { badRequest, sendError } from "../../lib/errors.js";

const PAPER_QUERY_ALLOWLIST = new Set(["fields"]);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const split = splitRouteQuery(req.query);
    const rawPaperId = requirePaperId(split.paperId);
    const rawQuery = split.query;

    const client = getS2Client();
    const resolver = getPaperIdResolver();

    const resolvedPaperId = await resolver.resolveSeedPaperId(rawPaperId);
    const query = sanitizeQuery(rawQuery, PAPER_QUERY_ALLOWLIST);
    const data = await client.getPaper(resolvedPaperId, query);

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

function splitRouteQuery(rawQuery = {}) {
  const { paperId, ...query } = rawQuery || {};
  return {
    paperId: unwrapSingleValue(paperId),
    query,
  };
}

function unwrapSingleValue(value) {
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw badRequest("Repeated paperId route parameter is not supported");
    }
    return value[0];
  }
  return value;
}
