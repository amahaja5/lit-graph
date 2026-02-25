import test from "node:test";
import assert from "node:assert/strict";

import { GraphStore } from "../../frontend/src/graphStore.js";
import { toPaperNode } from "../../frontend/src/normalize.js";

function makeCandidate({ relation, sourcePaperId, targetId, title, isInfluential = false }) {
  return {
    relation,
    sourcePaperId,
    targetPaper: toPaperNode({
      paperId: targetId,
      title,
      citationCount: 3,
      influentialCitationCount: 1,
      year: 2021,
    }),
    isInfluential,
    contexts: ["ctx"],
  };
}

test("GraphStore root/select/review/export workflow", () => {
  const store = new GraphStore();
  store.setRoot(
    toPaperNode({
      paperId: "seed",
      title: "Seed Paper",
      citationCount: 10,
      influentialCitationCount: 2,
      referenceCount: 5,
    }, { isRoot: true }),
  );

  assert.equal(store.seedPaperId, "seed");
  assert.equal(store.snapshot().nodes.length, 1);

  store.setNodeState("seed", "loading");
  const result = store.mergeExpansion("seed", [
    makeCandidate({ relation: "citation", sourcePaperId: "seed", targetId: "c1", title: "Citing" }),
    makeCandidate({ relation: "reference", sourcePaperId: "seed", targetId: "r1", title: "Ref" }),
    makeCandidate({ relation: "reference", sourcePaperId: "seed", targetId: "r1", title: "Ref Duplicate" }),
  ]);

  assert.equal(result.nodesAdded, 2);
  assert.equal(result.linksAdded, 2);
  assert.equal(store.getNode("seed").state, "expanded");

  store.setSelectedNode("c1");
  assert.equal(store.getNode("c1").isSelected, true);
  assert.equal(store.getNode("seed").isSelected, false);

  assert.equal(store.toggleReviewCart("c1"), true);
  const exported = store.toReviewExport();
  assert.equal(exported.schemaVersion, 1);
  assert.deepEqual(exported.selectedPaperIds, ["c1"]);
  assert.equal(exported.papers.length, 1);
  assert.equal(exported.links.length, 1);
});

test("GraphStore canExpand only allows unexplored or error", () => {
  const store = new GraphStore();
  store.setRoot(toPaperNode({ paperId: "seed", title: "Seed" }, { isRoot: true }));
  assert.equal(store.canExpand("seed"), true);
  store.setNodeState("seed", "loading");
  assert.equal(store.canExpand("seed"), false);
  store.setNodeState("seed", "expanded");
  assert.equal(store.canExpand("seed"), false);
  store.setNodeState("seed", "error", { errorMessage: "boom" });
  assert.equal(store.canExpand("seed"), true);
});
