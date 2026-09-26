import { createAuditService } from './auditService.js';
import { createAuditSources } from './auditSources.js';
import { createZoteroOAuth, zoteroMode } from './zoteroOAuth.js';
import { TTLCache } from "./cache.js";
import { createS2ProxyClient } from "./s2ProxyClient.js";
import { createPaperIdResolver } from "./paperIdResolver.js";
import { createAnthropicClient } from "./anthropicClient.js";
import { createReviewService } from "./reviewService.js";
import { createEvidenceJudgments } from './evidenceJudgments.js';

let evidenceJudgments;
export function getEvidenceJudgments() { return evidenceJudgments ||= createEvidenceJudgments(); }

let s2Client;
let paperIdResolver;
let reviewService;

export function getS2Client() {
  if (!s2Client) {
    const baseUrl = process.env.S2_API_BASE_URL || "https://api.semanticscholar.org/graph/v1";
    const minIntervalMs = readNonNegativeIntEnv("S2_MIN_INTERVAL_MS", 1100);

    s2Client = createS2ProxyClient({
      baseUrl,
      apiKey: process.env.S2_API_KEY,
      cache: new TTLCache({ ttlMs: 10 * 60 * 1000 }),
      minIntervalMs,
    });
  }
  return s2Client;
}

export function getPaperIdResolver() {
  if (!paperIdResolver) {
    paperIdResolver = createPaperIdResolver({
      s2Client: getS2Client(),
    });
  }
  return paperIdResolver;
}

export function getReviewService() {
  if (!reviewService) {
    reviewService = createReviewService({
      s2Client: getS2Client(),
      anthropicClient: createAnthropicClient(),
      judgments: getEvidenceJudgments(),
      evidenceCache: new TTLCache({ ttlMs: 10 * 60 * 1000 }),
      reviewCache: new TTLCache({ ttlMs: 10 * 60 * 1000 }),
    });
  }
  return reviewService;
}

function readNonNegativeIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

export function getAuditService(req) {
  const session = req && createZoteroOAuth().session(req);
  // A source cache must never be shared across browser connections or accounts.
  const sources = createAuditSources(session
    ? { mode: 'oauth', apiKey: session.apiKey, userId: session.userId, groupId: '' }
    : { mode: zoteroMode(), apiKey: '', userId: '', groupId: process.env.ZOTERO_GROUP_ID });
  return createAuditService({ sources, judgments: getEvidenceJudgments() });
}
