import test from "node:test";
import assert from "node:assert/strict";

import { rankCandidates, selectTopCandidates } from "../../frontend/src/rank.js";

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
