import test from "node:test";
import assert from "node:assert/strict";

import {
  BIBTEX_SORT_AUTHOR,
  BIBTEX_SORT_YEAR,
  buildBibtexDocument,
  extractOrBuildBibtexEntry,
  sortReviewNodesForBibtex,
} from "../../frontend/src/bibtex.js";

function node(paperId, { title = "Untitled", year = null, authors = [] } = {}) {
  return { paperId, title, year, authors: authors.map((name) => ({ name })) };
}

test("sortReviewNodesForBibtex sorts by first author name", () => {
  const items = [
    node("p2", { title: "Two", authors: ["Amy Zimmer"], year: 2022 }),
    node("p1", { title: "One", authors: ["Zed Anderson"], year: 2020 }),
    node("p3", { title: "Three", authors: ["Bo Brown"], year: 2021 }),
  ];

  const sorted = sortReviewNodesForBibtex(items, BIBTEX_SORT_AUTHOR);
  assert.deepEqual(sorted.map((item) => item.paperId), ["p1", "p3", "p2"]);
});

test("sortReviewNodesForBibtex sorts by year ascending with unknown years last", () => {
  const items = [
    node("p3", { title: "Three", authors: ["C"], year: null }),
    node("p2", { title: "Two", authors: ["B"], year: 2022 }),
    node("p1", { title: "One", authors: ["A"], year: 2020 }),
  ];

  const sorted = sortReviewNodesForBibtex(items, BIBTEX_SORT_YEAR);
  assert.deepEqual(sorted.map((item) => item.paperId), ["p1", "p2", "p3"]);
});

test("extractOrBuildBibtexEntry prefers citationStyles.bibtex and falls back to generated entry", () => {
  const fromApi = extractOrBuildBibtexEntry({
    citationStyles: { bibtex: "@article{abc, title={Real Entry}}" },
  }, node("pid"));
  assert.equal(fromApi, "@article{abc, title={Real Entry}}");

  const fallback = extractOrBuildBibtexEntry({}, node("paper-123", {
    title: "Fallback Title",
    year: 2024,
    authors: ["Ada Lovelace"],
  }));
  assert.match(fallback, /@misc\{/);
  assert.match(fallback, /Fallback Title/);
  assert.match(fallback, /Ada Lovelace/);
  assert.match(fallback, /2024/);
});

test("buildBibtexDocument joins entries with blank lines", () => {
  const doc = buildBibtexDocument(["@misc{a}", "   ", "@article{b}"]);
  assert.equal(doc, "@misc{a}\n\n@article{b}");
});
