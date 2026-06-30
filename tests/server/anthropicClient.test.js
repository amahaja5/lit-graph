import test from "node:test";
import assert from "node:assert/strict";

import { createAnthropicClient, validateStructuredReview } from "../../lib/anthropicClient.js";

test("validateStructuredReview rejects citations outside the supplied reference set", () => {
  assert.throws(() => validateStructuredReview({
    corpusOverview: { summary: "Summary", citations: ["R1"] },
    themes: [{ title: "Theme", summary: "Theme summary", citations: ["R9"] }],
    methodsEvidence: [],
    agreements: [],
    disagreements: [],
    gaps: [],
    suggestedNextReads: [],
    evidenceLimitations: [],
  }, ["R1", "R2"]), /unknown reference ID/i);
});

test("Anthropic client parses JSON review payload from a text block", async () => {
  const requests = [];
  const client = createAnthropicClient({
    apiKey: "test-key",
    model: "claude-test",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return createJsonResponse({
        content: [{
          type: "text",
          text: JSON.stringify({
            corpusOverview: { summary: "Overview", citations: ["R1"] },
            themes: [{ title: "Theme", summary: "Summary", citations: ["R1"] }],
            methodsEvidence: [],
            agreements: [],
            disagreements: [],
            gaps: [],
            suggestedNextReads: [{ suggestion: "Read R1 first", citations: ["R1"] }],
            evidenceLimitations: [{ limitation: "Only one paper", citations: ["R1"] }],
          }),
        }],
      });
    },
  });

  const result = await client.generateStructuredSynthesis({
    corpusPacket: "R1\nTitle: Example",
    allowedReferenceIds: ["R1"],
  });

  assert.equal(result.model, "claude-test");
  assert.equal(result.review.corpusOverview.summary, "Overview");
  assert.equal(result.review.themes.length, 1);
  assert.equal(requests.length, 1);
  const payload = JSON.parse(requests[0].options.body);
  assert.equal("temperature" in payload, false);
});

function createJsonResponse(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type" ? "application/json" : null;
      },
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}
