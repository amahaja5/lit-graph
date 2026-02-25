import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeCitationBatch,
  normalizeReferenceBatch,
  normalizePaperRecord,
  toPaperNode,
  candidateToGraphLink,
} from "../../frontend/src/normalize.js";

test("normalizePaperRecord creates null-safe paper node shape", () => {
  const paper = normalizePaperRecord({
    paperId: "p1",
    title: "Example",
    year: 2020,
    authors: [{ authorId: "a1", name: "Jane Doe" }],
    citationCount: 12,
    influentialCitationCount: null,
    referenceCount: 4,
  });

  assert.equal(paper.paperId, "p1");
  assert.equal(paper.title, "Example");
  assert.equal(paper.influentialCitationCount, 0);
  assert.equal(paper.state, "unexplored");
  assert.deepEqual(paper.authors, [{ authorId: "a1", name: "Jane Doe" }]);
});

test("normalize citation and reference batches filter invalid nested papers and detect truncation", () => {
  const citationBatch = normalizeCitationBatch("seed", {
    offset: 0,
    next: 100,
    data: [
      {
        isInfluential: true,
        contexts: ["Context 1"],
        citingPaper: { paperId: "c1", title: "Citing One", citationCount: 5, influentialCitationCount: 1 },
      },
      {
        isInfluential: false,
        citingPaper: { title: "Missing ID" },
      },
    ],
  });

  assert.equal(citationBatch.truncated, true);
  assert.equal(citationBatch.candidates.length, 1);
  assert.equal(citationBatch.candidates[0].relation, "citation");
  assert.equal(citationBatch.candidates[0].targetPaper.paperId, "c1");

  const referenceBatch = normalizeReferenceBatch("seed", {
    data: [
      {
        isInfluential: false,
        contexts: ["A", 4, "B"],
        citedPaper: { paperId: "r1", title: "Ref One", citationCount: 2, influentialCitationCount: 0 },
      },
    ],
  });

  assert.equal(referenceBatch.truncated, false);
  assert.equal(referenceBatch.candidates[0].contexts.length, 2);
  assert.equal(referenceBatch.candidates[0].relation, "reference");
});

test("candidateToGraphLink encodes direction by relation", () => {
  const citationCandidate = {
    relation: "citation",
    sourcePaperId: "seed",
    targetPaper: toPaperNode({ paperId: "citing", title: "Citing" }),
    isInfluential: true,
    contexts: ["x"],
  };
  const citationLink = candidateToGraphLink(citationCandidate);
  assert.equal(citationLink.source, "citing");
  assert.equal(citationLink.target, "seed");
  assert.equal(citationLink.id, "citing->seed:citation");

  const referenceCandidate = {
    relation: "reference",
    sourcePaperId: "seed",
    targetPaper: toPaperNode({ paperId: "cited", title: "Cited" }),
    isInfluential: false,
    contexts: [],
  };
  const referenceLink = candidateToGraphLink(referenceCandidate);
  assert.equal(referenceLink.source, "seed");
  assert.equal(referenceLink.target, "cited");
  assert.equal(referenceLink.id, "seed->cited:reference");
});
