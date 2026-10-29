import { createAuditService } from './audit/auditService.js';
import { createAuditSources } from './audit/auditSources.js';
import { createZoteroOAuth, zoteroMode } from './auth/zoteroOAuth.js';
import { TTLCache } from "./shared/cache.js";
import { createS2ProxyClient } from "./papers/s2ProxyClient.js";
import { createPaperIdResolver } from "./papers/paperIdResolver.js";
import { createAnthropicClient } from "./review/anthropicClient.js";
import { createReviewService } from "./review/reviewService.js";
import { createEvidenceJudgments } from './evidence/evidenceJudgments.js';

let evidenceJudgments;
export function getEvidenceJudgments() { return evidenceJudgments ||= createEvidenceJudgments(); }

let s2Client;
let paperIdResolver;
let reviewService;

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
    judgments: getEvidenceJudgments(),
    evidenceCache: new TTLCache({ ttlMs: 10 * 60 * 1000 }),
    reviewCache: new TTLCache({ ttlMs: 10 * 60 * 1000 }),
    logger,
  });
}

export function getS2Client() { return s2Client ||= createDefaultS2Client(); }
export function getPaperIdResolver() { return paperIdResolver ||= createPaperIdResolver({ s2Client: getS2Client() }); }
export function getReviewService() { return reviewService ||= createDefaultReviewService({ s2Client: getS2Client() }); }

function readNonNegativeIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

export function getAuditService(req, { oauth = createZoteroOAuth() } = {}) {
  const session = req && oauth.session(req);
  // A source cache must never be shared across browser connections or accounts.
  const sources = createAuditSources(session
    ? { mode: 'oauth', apiKey: session.apiKey, userId: session.userId, groupId: '' }
    : { mode: zoteroMode(), apiKey: '', userId: '', groupId: process.env.ZOTERO_GROUP_ID });
  return createAuditService({ sources, judgments: getEvidenceJudgments() });
}
