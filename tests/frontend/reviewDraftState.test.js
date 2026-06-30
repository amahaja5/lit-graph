import test from "node:test";
import assert from "node:assert/strict";

import {
  createInitialReviewDraftState,
  getReviewGenerationGate,
  markReviewDraftStale,
} from "../../frontend/src/reviewDraftState.js";

test("getReviewGenerationGate enforces the 2-10 paper window", () => {
  assert.equal(getReviewGenerationGate(1).canGenerate, false);
  assert.equal(getReviewGenerationGate(2).canGenerate, true);
  assert.equal(getReviewGenerationGate(10).canGenerate, true);
  assert.equal(getReviewGenerationGate(11).canGenerate, false);
});

test("markReviewDraftStale only marks existing drafts stale", () => {
  const initial = createInitialReviewDraftState();
  assert.equal(markReviewDraftStale(initial).stale, false);

  const withPayload = {
    ...initial,
    payload: { review: {} },
  };
  assert.equal(markReviewDraftStale(withPayload).stale, true);
});
