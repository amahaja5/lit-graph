import test from "node:test";
import assert from "node:assert/strict";

import { extractReadableTextFromHtml, resolveReviewSourceUrl } from "../../lib/reviewEvidence.js";

test("resolveReviewSourceUrl prioritizes arXiv, then NBER, then PubMed, then DOI", () => {
  assert.equal(resolveReviewSourceUrl({
    paperId: "abc",
    url: "https://www.semanticscholar.org/paper/abc",
    externalIds: { ArXiv: "2501.12345" },
  }), "https://arxiv.org/abs/2501.12345");

  assert.equal(resolveReviewSourceUrl({
    paperId: "DOI:10.3386/w12345",
    url: "https://www.semanticscholar.org/paper/def",
    externalIds: {},
  }), "https://www.nber.org/papers/w12345");

  assert.equal(resolveReviewSourceUrl({
    paperId: "xyz",
    url: "https://www.semanticscholar.org/paper/xyz",
    externalIds: { PubMed: "19872477" },
  }), "https://pubmed.ncbi.nlm.nih.gov/19872477/");

  assert.equal(resolveReviewSourceUrl({
    paperId: "PMID:31452104",
    url: "https://www.semanticscholar.org/paper/xyz",
    externalIds: {},
  }), "https://pubmed.ncbi.nlm.nih.gov/31452104/");

  assert.equal(resolveReviewSourceUrl({
    paperId: "xyz",
    url: "https://www.semanticscholar.org/paper/xyz",
    externalIds: { DOI: "10.1000/example" },
  }), "https://doi.org/10.1000/example");
});

test("extractReadableTextFromHtml strips boilerplate and preserves readable content", () => {
  const html = `
    <html>
      <head>
        <title>Example</title>
        <style>.hidden { display:none; }</style>
      </head>
      <body>
        <nav>Nav links</nav>
        <main>
          <article>
            <h1>Paper Title</h1>
            <p>This is the first paragraph with enough content to survive extraction and be useful for a review generator.</p>
            <p>This second paragraph adds more context, methods, and claims so the text length clears the minimum threshold.</p>
          </article>
        </main>
      </body>
    </html>
  `;

  const text = extractReadableTextFromHtml(html, { maxChars: 1_000 });
  assert.match(text, /Paper Title/);
  assert.match(text, /first paragraph/);
  assert.doesNotMatch(text, /Nav links/);
});
