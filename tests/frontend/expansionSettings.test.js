import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_EXPANSION_PAPERS_PER_SIDE,
  MAX_EXPANSION_PAPERS_PER_SIDE,
  normalizeExpansionCount,
} from "../../frontend/src/expansionSettings.js";

test("normalizeExpansionCount clamps to valid positive integer bounds", () => {
  assert.equal(normalizeExpansionCount("12"), 12);
  assert.equal(normalizeExpansionCount(0), 1);
  assert.equal(normalizeExpansionCount(2.8), 2);
  assert.equal(normalizeExpansionCount(500), MAX_EXPANSION_PAPERS_PER_SIDE);
});

test("normalizeExpansionCount falls back for invalid input", () => {
  assert.equal(normalizeExpansionCount(""), DEFAULT_EXPANSION_PAPERS_PER_SIDE);
  assert.equal(normalizeExpansionCount("not-a-number"), DEFAULT_EXPANSION_PAPERS_PER_SIDE);
  assert.equal(normalizeExpansionCount(null), DEFAULT_EXPANSION_PAPERS_PER_SIDE);
});
