import test from "node:test";
import assert from "node:assert/strict";

import { createPaperIdResolver, extractNberPageMetadata, parseNberInput } from "../../server/src/paperIdResolver.js";
import { ProxyHttpError } from "../../server/src/errors.js";

test("parseNberInput recognizes working-paper shorthand and URLs", () => {
  const canonical = parseNberInput("NBER:w54321");
  assert.equal(canonical.seriesId, "w54321");

  const canonicalSpaced = parseNberInput("NBER: w54321");
  assert.equal(canonicalSpaced.seriesId, "w54321");

  const fromUrl = parseNberInput("NBER:https://www.nber.org/papers/w99999");
  assert.equal(fromUrl.seriesId, "w99999");

  const fromUrlPrefix = parseNberInput("NBER: https://www.nber.org/papers/w10000");
  assert.equal(fromUrlPrefix.seriesId, "w10000");

  assert.equal(parseNberInput("w12345"), null);
  assert.equal(parseNberInput("NBER w54321"), null);
  assert.equal(parseNberInput("https://www.nber.org/papers/w99999"), null);
  assert.equal(parseNberInput("DOI:10.18653/v1/N18-3011"), null);
});

test("extractNberPageMetadata reads DOI and title from common meta tags", () => {
  const html = `
    <html><head>
      <meta name="citation_title" content="A Great NBER Paper | NBER">
      <meta name="citation_doi" content="https://doi.org/10.3386/w12345">
      <title>Fallback Title | NBER</title>
    </head><body></body></html>
  `;

  const metadata = extractNberPageMetadata(html);
  assert.equal(metadata.doi, "10.3386/w12345");
  assert.equal(metadata.title, "A Great NBER Paper");
});

test("resolver maps NBER working-paper shorthand directly to DOI", async () => {
  const resolver = createPaperIdResolver({
    s2Client: {},
    fetchImpl: async () => {
      throw new Error("fetch should not be called for working-paper DOI mapping");
    },
  });

  const resolved = await resolver.resolveSeedPaperId("NBER:w28786");
  assert.equal(resolved, "DOI:10.3386/w28786");
});

test("resolver falls back to NBER page fetch + S2 title match when DOI is missing", async () => {
  const fetchCalls = [];
  const resolver = createPaperIdResolver({
    fetchImpl: async (url) => {
      fetchCalls.push(String(url));
      return {
        ok: true,
        status: 200,
        async text() {
          return `
            <html><head>
              <meta property="og:title" content="An NBER Paper Without DOI - National Bureau of Economic Research">
            </head></html>
          `;
        },
      };
    },
    s2Client: {
      async searchPaperMatch(query, options) {
        assert.match(query, /An NBER Paper Without DOI/);
        assert.equal(typeof options.fields, "string");
        return { data: [{ paperId: "s2-paper-123", title: query }] };
      },
    },
    logger: { debug() {} },
  });

  const resolved = await resolver.resolveSeedPaperId("NBER:https://www.nber.org/papers/si2024");
  assert.equal(resolved, "s2-paper-123");
  assert.equal(fetchCalls.length, 1);
});

test("resolver falls back when NBER working-paper DOI is not found in S2", async () => {
  let getPaperCalls = 0;
  const resolver = createPaperIdResolver({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return `
          <html><head>
            <meta name="citation_title" content="NBER Fallback Working Paper | NBER">
          </head></html>
        `;
      },
    }),
    s2Client: {
      async getPaper(paperId) {
        getPaperCalls += 1;
        assert.equal(paperId, "DOI:10.3386/w31852");
        throw new ProxyHttpError({ code: "not_found", message: "Paper not found", status: 404 });
      },
      async searchPaperMatch(query) {
        assert.match(query, /NBER Fallback Working Paper/);
        return { data: [{ paperId: "s2-w31852" }] };
      },
    },
    logger: { debug() {} },
  });

  const resolved = await resolver.resolveSeedPaperId("NBER:w31852");
  assert.equal(resolved, "s2-w31852");
  assert.equal(getPaperCalls, 1);
});
