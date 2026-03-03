import test from "node:test";
import assert from "node:assert/strict";

import {
  EXPANSION_MODE_LESSER_KNOWN_SAMPLE,
  EXPANSION_MODE_RELEVANCE,
  rankCandidates,
  selectCandidatesForMode,
  selectTopCandidates,
} from "../../frontend/src/rank.js";

function candidate(id, { isInfluential = false, inf = 0, citations = 0, year = null } = {}) {
  return {
    isInfluential,
    targetPaper: {
      paperId: id,
      influentialCitationCount: inf,
      citationCount: citations,
      year,
    },
  };
}

test("rankCandidates sorts by influence metrics then year then paperId", () => {
  const candidates = [
    candidate("b", { isInfluential: true, inf: 1, citations: 4, year: 2020 }),
    candidate("a", { isInfluential: true, inf: 1, citations: 4, year: 2020 }),
    candidate("c", { isInfluential: false, inf: 10, citations: 100, year: 2024 }),
    candidate("d", { isInfluential: true, inf: 2, citations: 1, year: null }),
    candidate("e", { isInfluential: true, inf: 2, citations: 1, year: 2022 }),
  ];

  const rankedIds = rankCandidates(candidates).map((item) => item.targetPaper.paperId);
  assert.deepEqual(rankedIds, ["e", "d", "a", "b", "c"]);
});

test("selectTopCandidates returns deterministic prefix", () => {
  const ranked = selectTopCandidates([
    candidate("z", { citations: 1 }),
    candidate("x", { citations: 10 }),
    candidate("y", { citations: 5 }),
  ], 2);

  assert.deepEqual(ranked.map((item) => item.targetPaper.paperId), ["x", "y"]);
});

test("selectCandidatesForMode uses top relevance mode by default", () => {
  const candidates = [
    candidate("a", { citations: 100 }),
    candidate("b", { citations: 10 }),
    candidate("c", { citations: 1 }),
  ];

  const selected = selectCandidatesForMode(candidates, 2, { mode: EXPANSION_MODE_RELEVANCE });
  assert.deepEqual(selected.map((item) => item.targetPaper.paperId), ["a", "b"]);
});

test("lesser-known sample avoids the most relevance-dominant head when pool is large", () => {
  const candidates = Array.from({ length: 20 }, (_, index) => {
    const rank = index + 1;
    return candidate(`p${String(rank).padStart(2, "0")}`, {
      citations: 1000 - index * 40,
      inf: 100 - index,
      year: 2024 - (index % 5),
      isInfluential: index < 3,
    });
  });

  const selected = selectCandidatesForMode(candidates, 5, {
    mode: EXPANSION_MODE_LESSER_KNOWN_SAMPLE,
    rng: () => 0,
  });
  const selectedIds = selected.map((item) => item.targetPaper.paperId);

  // Top relevance would be p01..p05. Lesser-known mode should skip the top head.
  assert.equal(selectedIds.includes("p01"), false);
  assert.equal(selectedIds.includes("p02"), false);
  assert.equal(selected.length, 5);
});
