import test from "node:test";
import assert from "node:assert/strict";

import { computeGraphPanelHeight } from "../../frontend/src/graphSizing.js";

test("computeGraphPanelHeight uses the baseline viewport-driven height for smaller graphs", () => {
  const height = computeGraphPanelHeight(12, {
    viewportWidth: 1280,
    viewportHeight: 900,
  });

  assert.equal(height, 630);
});

test("computeGraphPanelHeight grows as node count increases on desktop", () => {
  const compactHeight = computeGraphPanelHeight(24, {
    viewportWidth: 1280,
    viewportHeight: 900,
  });
  const expandedHeight = computeGraphPanelHeight(55, {
    viewportWidth: 1280,
    viewportHeight: 900,
  });

  assert.ok(expandedHeight > compactHeight);
  assert.equal(expandedHeight, 1130);
});

test("computeGraphPanelHeight respects smaller mobile baselines while still expanding", () => {
  const mobileBaseHeight = computeGraphPanelHeight(6, {
    viewportWidth: 480,
    viewportHeight: 780,
  });
  const mobileExpandedHeight = computeGraphPanelHeight(30, {
    viewportWidth: 480,
    viewportHeight: 780,
  });

  assert.equal(mobileBaseHeight, 452);
  assert.ok(mobileExpandedHeight > mobileBaseHeight);
  assert.equal(mobileExpandedHeight, 632);
});

test("computeGraphPanelHeight caps extreme graph growth", () => {
  const height = computeGraphPanelHeight(500, {
    viewportWidth: 1400,
    viewportHeight: 1000,
  });

  assert.equal(height, 1720);
});
