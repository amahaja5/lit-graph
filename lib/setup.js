import { TTLCache } from "./cache.js";
import { createS2ProxyClient } from "./s2ProxyClient.js";
import { createPaperIdResolver } from "./paperIdResolver.js";

let s2Client;
let paperIdResolver;

export function getS2Client() {
  if (!s2Client) {
    const baseUrl = process.env.S2_API_BASE_URL || "https://api.semanticscholar.org/graph/v1";
    const minIntervalMs = readNonNegativeIntEnv("S2_MIN_INTERVAL_MS", 1100);

    console.debug("[litgraph setup] create s2 client", {
      baseUrl,
      hasApiKey: Boolean(process.env.S2_API_KEY),
      minIntervalMs,
    });

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

function readNonNegativeIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}
