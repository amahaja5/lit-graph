import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TTLCache } from "./cache.js";
import { createS2ProxyClient } from "./s2ProxyClient.js";
import { ProxyHttpError, badRequest, sendError } from "./errors.js";
import { createPaperIdResolver } from "./paperIdResolver.js";
import { createAnthropicClient } from "../../lib/anthropicClient.js";
import { parseReviewGenerateRequestBody } from "../../lib/reviewRequest.js";
import { createReviewService } from "../../lib/reviewService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FRONTEND_DIR = path.resolve(__dirname, "../../frontend");
const DEFAULT_ENV_FILE = path.resolve(__dirname, "../../.env");

loadEnvFile(DEFAULT_ENV_FILE);

const PAPER_QUERY_ALLOWLIST = new Set(["fields"]);
const CITATIONS_QUERY_ALLOWLIST = new Set(["fields", "limit", "offset", "publicationDateOrYear"]);
const REFERENCES_QUERY_ALLOWLIST = new Set(["fields", "limit", "offset"]);

export function createApp({
  s2Client,
  paperIdResolver,
  reviewService,
  serveFrontend = true,
  frontendDir = DEFAULT_FRONTEND_DIR,
  logger = console,
} = {}) {
  const client = s2Client || createDefaultS2Client({ logger });
  const resolver = paperIdResolver || createPaperIdResolver({ s2Client: client, logger });
  const reviews = reviewService || createDefaultReviewService({ s2Client: client, logger });
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/paper/:paperId(*)/citations", async (req, res) => {
    try {
      const paperId = requirePaperId(req.params.paperId);
      const query = sanitizeQuery(req.query, CITATIONS_QUERY_ALLOWLIST);
      validatePagingQuery(query);
      const data = await client.getCitations(paperId, query);
      res.json(data);
    } catch (error) {
      logInternalServerError(logger, req, error);
      sendError(res, error);
    }
  });

  app.get("/api/paper/:paperId(*)/references", async (req, res) => {
    try {
      const paperId = requirePaperId(req.params.paperId);
      const query = sanitizeQuery(req.query, REFERENCES_QUERY_ALLOWLIST);
      validatePagingQuery(query);
      const data = await client.getReferences(paperId, query);
      res.json(data);
    } catch (error) {
      logInternalServerError(logger, req, error);
      sendError(res, error);
    }
  });

  app.get("/api/paper/:paperId(*)", async (req, res) => {
    try {
      const rawPaperId = requirePaperId(req.params.paperId);
      const paperId = await resolver.resolveSeedPaperId(rawPaperId);
      const query = sanitizeQuery(req.query, PAPER_QUERY_ALLOWLIST);
      const data = await client.getPaper(paperId, query);
      res.json(data);
    } catch (error) {
      logInternalServerError(logger, req, error);
      sendError(res, error);
    }
  });

  app.post("/api/review/generate", async (req, res) => {
    try {
      const request = parseReviewGenerateRequestBody(req.body);
      const payload = await reviews.generateReview(request);
      res.json(payload);
    } catch (error) {
      logInternalServerError(logger, req, error);
      sendError(res, error);
    }
  });

  if (serveFrontend) {
    app.use(express.static(frontendDir));

    app.get("*", (_req, res) => {
      res.sendFile(path.join(frontendDir, "index.html"));
    });
  }

  app.use((error, req, res, _next) => {
    logInternalServerError(logger, req, error);
    sendError(res, error);
  });

  return app;
}

export function createDefaultS2Client({ logger = console } = {}) {
  return createS2ProxyClient({
    baseUrl: process.env.S2_API_BASE_URL || "https://api.semanticscholar.org/graph/v1",
    apiKey: process.env.S2_API_KEY,
    cache: new TTLCache({ ttlMs: 10 * 60 * 1000 }),
    minIntervalMs: readNonNegativeIntEnv("S2_MIN_INTERVAL_MS", 1100),
    logger,
  });
}

export function createDefaultReviewService({ s2Client, logger = console } = {}) {
  return createReviewService({
    s2Client: s2Client || createDefaultS2Client({ logger }),
    anthropicClient: createAnthropicClient(),
    evidenceCache: new TTLCache({ ttlMs: 10 * 60 * 1000 }),
    reviewCache: new TTLCache({ ttlMs: 10 * 60 * 1000 }),
    logger,
  });
}

export function sanitizeQuery(rawQuery, allowlist) {
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

export function validatePagingQuery(query) {
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

function requirePaperId(paperId) {
  if (!paperId || !String(paperId).trim()) {
    throw badRequest("paperId is required");
  }
  return String(paperId);
}

export function startServer({ port = Number(process.env.PORT) || 3001 } = {}) {
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`LitGraph server listening on http://localhost:${port}`);
  });
  return server;
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  startServer();
}

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;

  const contents = fs.readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = unwrapQuotedEnvValue(value);
  }
}

function logInternalServerError(logger, req, error) {
  if (!logger?.error) return;
  if (!isInternalServerError(error)) return;

  logger.error("Internal Server Error", {
    method: req?.method,
    path: req?.originalUrl || req?.url,
    code: error?.code || "internal_error",
    status: error instanceof ProxyHttpError ? error.status : 500,
    upstreamStatus: error instanceof ProxyHttpError ? error.upstreamStatus : undefined,
    message: error?.message,
    stack: error?.stack,
  });
}

function isInternalServerError(error) {
  if (!(error instanceof ProxyHttpError) && error?.name !== "ProxyHttpError") {
    return true;
  }
  return Number(error.status) >= 500;
}

function readNonNegativeIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function unwrapQuotedEnvValue(value) {
  if (!value || value.length < 2) return value;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
