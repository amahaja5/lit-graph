import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { TTLCache } from "../../server/src/cache.js";
import { createS2ProxyClient } from "../../server/src/s2ProxyClient.js";
import { createApp } from "../../server/src/index.js";

function createMockUpstream() {
  const hitCounts = new Map();
  const retryState = { retry429: 0 };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const count = (hitCounts.get(url.pathname + url.search) || 0) + 1;
    hitCounts.set(url.pathname + url.search, count);

    if (url.pathname.endsWith("/paper/error404")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Missing paper" }));
      return;
    }

    if (url.pathname.endsWith("/paper/retry429")) {
      retryState.retry429 += 1;
      if (retryState.retry429 === 1) {
        res.writeHead(429, { "content-type": "application/json", "retry-after": "0" });
        res.end(JSON.stringify({ message: "Rate limited" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ paperId: "retry429", title: "Recovered" }));
      return;
    }

    if (url.pathname.includes("/citations")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ offset: 0, data: [] }));
      return;
    }

    if (url.pathname.includes("/references")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ offset: 0, data: [] }));
      return;
    }

    const paperId = decodeURIComponent(url.pathname.split("/").pop());
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      paperId,
      title: `Paper ${paperId}`,
      queryEcho: Object.fromEntries(url.searchParams.entries()),
      hitCount: count,
    }));
  });

  return { server, hitCounts };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function buildProxyServer({ upstreamBaseUrl }) {
  const s2Client = createS2ProxyClient({
    baseUrl: `${upstreamBaseUrl}/graph/v1`,
    cache: new TTLCache({ ttlMs: 60_000 }),
    retryBackoffMs: 1,
  });
  const app = createApp({ s2Client, serveFrontend: false, logger: { error() {}, debug() {} } });
  const server = http.createServer(app);
  return listen(server);
}

test("proxy rejects unsupported query params", async (t) => {
  const upstream = createMockUpstream();
  const upstreamHandle = await listen(upstream.server);
  const proxyHandle = await buildProxyServer({ upstreamBaseUrl: upstreamHandle.baseUrl });

  t.after(async () => {
    await proxyHandle.close();
    await upstreamHandle.close();
  });

  const response = await fetch(`${proxyHandle.baseUrl}/api/paper/test?foo=bar`);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "bad_request");
  assert.match(body.error.message, /Unsupported query parameter/);
});

test("proxy maps upstream 404 to standardized envelope", async (t) => {
  const upstream = createMockUpstream();
  const upstreamHandle = await listen(upstream.server);
  const proxyHandle = await buildProxyServer({ upstreamBaseUrl: upstreamHandle.baseUrl });

  t.after(async () => {
    await proxyHandle.close();
    await upstreamHandle.close();
  });

  const response = await fetch(`${proxyHandle.baseUrl}/api/paper/error404`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, "not_found");
  assert.equal(body.error.upstreamStatus, 404);
  assert.match(body.error.message, /Missing paper/);
});

test("proxy caches successful paper fetches", async (t) => {
  const upstream = createMockUpstream();
  const upstreamHandle = await listen(upstream.server);
  const proxyHandle = await buildProxyServer({ upstreamBaseUrl: upstreamHandle.baseUrl });

  t.after(async () => {
    await proxyHandle.close();
    await upstreamHandle.close();
  });

  const url = `${proxyHandle.baseUrl}/api/paper/cache-me?fields=title`;
  const first = await fetch(url);
  const firstBody = await first.json();
  const second = await fetch(url);
  const secondBody = await second.json();

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(firstBody.paperId, "cache-me");
  assert.equal(secondBody.paperId, "cache-me");
  assert.equal(firstBody.hitCount, 1);
  assert.equal(secondBody.hitCount, 1);
});

test("proxy retries one time on 429 and succeeds", async (t) => {
  const upstream = createMockUpstream();
  const upstreamHandle = await listen(upstream.server);
  const proxyHandle = await buildProxyServer({ upstreamBaseUrl: upstreamHandle.baseUrl });

  t.after(async () => {
    await proxyHandle.close();
    await upstreamHandle.close();
  });

  const response = await fetch(`${proxyHandle.baseUrl}/api/paper/retry429`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.paperId, "retry429");
});

test("proxy route supports DOI-like IDs with slashes", async (t) => {
  const upstream = createMockUpstream();
  const upstreamHandle = await listen(upstream.server);
  const proxyHandle = await buildProxyServer({ upstreamBaseUrl: upstreamHandle.baseUrl });

  t.after(async () => {
    await proxyHandle.close();
    await upstreamHandle.close();
  });

  const encoded = encodeURIComponent("DOI:10.18653/v1/N18-3011");
  const response = await fetch(`${proxyHandle.baseUrl}/api/paper/${encoded}?fields=title`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.paperId, "DOI:10.18653/v1/N18-3011");
  assert.deepEqual(body.queryEcho, { fields: "title" });
});
