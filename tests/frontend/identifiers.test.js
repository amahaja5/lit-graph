import test from "node:test";
import assert from "node:assert/strict";

import { buildIdentifiersText, extractPaperIdentifiers } from "../../frontend/src/identifiers.js";

test("extractPaperIdentifiers uses explicit externalIds when available", () => {
  const row = extractPaperIdentifiers({
    paperId: "abc123",
    title: "Example",
    url: "https://www.semanticscholar.org/paper/abc123",
    externalIds: {
      ArXiv: "2501.12345",
      DOI: "10.3386/w31852",
    },
  });

  assert.equal(row.semanticScholarUrl, "https://www.semanticscholar.org/paper/abc123");
  assert.equal(row.arxivId, "2501.12345");
  assert.equal(row.nberId, "NBER:w31852");
});

test("extractPaperIdentifiers falls back to paperId parsing when external IDs are missing", () => {
  const row = extractPaperIdentifiers({
    paperId: "DOI:10.3386/w12345",
    title: "NBER via DOI",
  });

  assert.match(row.semanticScholarUrl, /semanticscholar\.org\/paper/);
  assert.equal(row.arxivId, "");
  assert.equal(row.nberId, "NBER:w12345");
});

test("buildIdentifiersText creates tab-separated output with header", () => {
  const text = buildIdentifiersText([{
    semanticScholarUrl: "https://www.semanticscholar.org/paper/xyz",
    arxivId: "2501.11111",
    nberId: "NBER:w99999",
    paperId: "xyz",
    title: "My Title",
  }], { generatedAt: "2026-03-03T00:00:00.000Z" });

  assert.match(text, /# LitGraph Identifier Export/);
  assert.match(text, /semanticScholarUrl\tarxiv\tnber\tpaperId\ttitle/);
  assert.match(text, /https:\/\/www\.semanticscholar\.org\/paper\/xyz\t2501\.11111\tNBER:w99999\txyz\tMy Title/);
});
