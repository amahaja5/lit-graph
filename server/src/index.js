import { handleAudit } from '../../lib/audit/handler.js';
import { createPaperHandler } from '../../lib/papers/handler.js';
import { createDefaultS2Client, createDefaultReviewService, getAuditService } from '../../lib/setup.js';
import { createZoteroOAuth } from '../../lib/auth/zoteroOAuth.js';
import { requestSignal } from '../../lib/http/requestSignal.js';
import { requireAppAccess } from '../../lib/auth/appAccess.js';
import { handleCitationImport } from '../../lib/citation-import/citationImportHandler.js';
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProxyHttpError } from "../../lib/shared/errors.js";
import { sendError } from "../../lib/http/errors.js";
import { createPaperIdResolver } from "../../lib/papers/paperIdResolver.js";
import { parseReviewGenerateRequestBody } from "../../lib/review/reviewRequest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FRONTEND_DIR = path.resolve(__dirname, "../../frontend");
const DEFAULT_ENV_FILE = path.resolve(__dirname, "../../.env");


export function createApp({
  s2Client,
  paperIdResolver,
  reviewService,
  auditService,
  zoteroOAuth,
  citationImport,
  serveFrontend = true,
  frontendDir = DEFAULT_FRONTEND_DIR,
  logger = console,
} = {}) {
  const client = s2Client || createDefaultS2Client({ logger });
  const resolver = paperIdResolver || createPaperIdResolver({ s2Client: client, logger });
  const reviews = reviewService || createDefaultReviewService({ s2Client: client, logger });
  const app = express();
  app.use('/api/import', (req, res, next) => {
    try { requireAppAccess(req, { oauth: zoteroOAuth }); next(); } catch (error) { sendError(res, error); }
  });
  app.use('/api/import', express.json({ limit: '4.2mb' }));
  app.use('/api/audit', (req, res, next) => {
    try { requireAppAccess(req, { oauth: zoteroOAuth }); next(); } catch (error) { sendError(res, error); }
  });
  app.use('/api/audit', express.json({ limit: '4.2mb' }));
  app.use(express.json({ limit: "1mb" }));
  app.all('/api/import/:action', (req, res) => handleCitationImport(req, res, req.params.action, { oauth: zoteroOAuth || createZoteroOAuth(), service: citationImport }));
  app.all('/api/zotero/:action', (req, res) =>
    (zoteroOAuth || createZoteroOAuth()).handle(req, res, req.params.action));
  app.all('/api/audit/:action', (req, res) => handleAudit(req, res, req.params.action, {
    oauth: zoteroOAuth,
    getService: request => auditService || getAuditService(request, { oauth: zoteroOAuth }),
  }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  for (const kind of ['citations', 'references', 'paper']) {
    const handler = createPaperHandler(kind, { client, resolver, logger });
    const route = `/api/paper/:paperId(*)${kind === 'paper' ? '' : `/${kind}`}`;
    app.all(route, (req, res) => handler(req, res, req.params.paperId, req.query));
  }

  app.post("/api/review/generate", async (req, res) => {
    try {
      const request = parseReviewGenerateRequestBody(req.body);
      const payload = await reviews.generateReview(request, { signal: requestSignal(req, res) });
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
    if (error.type === 'entity.too.large') error = new ProxyHttpError({code:'payload_too_large', status:413, message:'Upload is too large. Maximum manuscript file size is 3 MB.'});
    sendError(res, error);
  });

  return app;
}

export function startServer({ port } = {}) {
  loadEnvFile(DEFAULT_ENV_FILE);
  port ??= Number(process.env.PORT) || 3001;
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
  if (!(error instanceof ProxyHttpError)) {
    return true;
  }
  return Number(error.status) >= 500;
}

function unwrapQuotedEnvValue(value) {
  if (!value || value.length < 2) return value;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
