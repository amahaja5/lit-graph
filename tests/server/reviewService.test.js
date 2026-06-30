import test from "node:test";
import assert from "node:assert/strict";

import { TTLCache } from "../../lib/cache.js";
import { createReviewService } from "../../lib/reviewService.js";

test("review service builds numbered references and falls back to abstract-only when HTML is unavailable", async () => {
  const service = createReviewService({
    s2Client: {
      async getPapersBatch() {
        return [
          {
            paperId: "p1",
            title: "Paper One",
            year: 2023,
            abstract: "Abstract one",
            url: "https://www.semanticscholar.org/paper/p1",
            externalIds: { ArXiv: "2501.12345" },
            authors: [{ name: "Author A" }],
            venue: "Venue A",
          },
          {
            paperId: "p2",
            title: "Paper Two",
            year: 2024,
            abstract: "Abstract two",
            url: "https://www.semanticscholar.org/paper/p2",
            externalIds: { DOI: "10.1000/example" },
            authors: [{ name: "Author B" }],
            venue: "Venue B",
          },
        ];
      },
    },
    anthropicClient: {
      model: "claude-test",
      async generateStructuredSynthesis({ allowedReferenceIds }) {
        return {
          model: "claude-test",
          review: {
            corpusOverview: { summary: "Overview", citations: [allowedReferenceIds[0]] },
            themes: [{ title: "Theme", summary: "Summary", citations: [allowedReferenceIds[0], allowedReferenceIds[1]] }],
            methodsEvidence: [],
            agreements: [],
            disagreements: [],
            gaps: [],
            suggestedNextReads: [{ suggestion: "Start with R1", citations: [allowedReferenceIds[0]] }],
            evidenceLimitations: [{ limitation: "One source lacked HTML", citations: [allowedReferenceIds[1]] }],
          },
        };
      },
    },
    fetchImpl: async (url) => {
      if (String(url).includes("arxiv.org")) {
        return createHtmlResponse(`
          <html><body><article>
            <h1>Paper One</h1>
            <p>This article contains enough readable text to count as HTML evidence for the review generator.</p>
            <p>Additional detail ensures we pass the minimum extraction threshold and keep html_plus_abstract coverage.</p>
          </article></body></html>
        `);
      }
      throw new Error("network blocked");
    },
    evidenceCache: new TTLCache({ ttlMs: 60_000 }),
    reviewCache: new TTLCache({ ttlMs: 60_000 }),
  });

  const payload = await service.generateReview({
    paperIds: ["p1", "p2"],
    mode: "html",
    outputShape: "structured_synthesis",
  });

  assert.equal(payload.references[0].refId, "R1");
  assert.equal(payload.references[1].refId, "R2");
  assert.equal(payload.references[0].coverage, "html_plus_abstract");
  assert.equal(payload.references[1].coverage, "abstract_only");
  assert.match(payload.warnings.join("\n"), /R2/);
});

function createHtmlResponse(html, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null;
      },
    },
    async text() {
      return html;
    },
  };
}
