import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { createS2ProxyClient } from "../../server/src/s2ProxyClient.js";

test("s2 client throttles outbound requests with a global min interval", async () => {
  const startedAt = [];

  const client = createS2ProxyClient({
    baseUrl: "https://example.test/graph/v1",
    minIntervalMs: 25,
    logger: { debug() {} },
    fetchImpl: async () => {
      startedAt.push(performance.now());
      return createJsonResponse({ ok: true });
    },
  });

  await Promise.all([
    client.getPaper("paper-a"),
    client.getPaper("paper-b"),
  ]);

  assert.equal(startedAt.length, 2);
  const deltaMs = startedAt[1] - startedAt[0];
  assert.ok(deltaMs >= 20, `expected throttled spacing >=20ms, got ${deltaMs.toFixed(1)}ms`);
});

function createJsonResponse(payload, { status = 200, headers = {} } = {}) {
  const headerMap = new Map();
  for (const [key, value] of Object.entries({ "content-type": "application/json", ...headers })) {
    headerMap.set(String(key).toLowerCase(), String(value));
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headerMap.get(String(name).toLowerCase()) || null;
      },
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}
