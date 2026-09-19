import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  createAuditService,
  validateInventory,
  validateAssessment,
  selectPassages,
} from "../../lib/auditService.js";
import {
  createAuditSources,
  arxivId,
  matchReference,
} from "../../lib/auditSources.js";
import { readManuscript, extractPdf } from "../../lib/auditDocument.js";
import { createAuditModel } from "../../lib/auditModel.js";
import { requireAuditAccess } from "../../lib/auditAccess.js";
import { createApp } from "../../server/src/index.js";

const quote = "The model achieved 95.3 percent validity.";
const manuscript = `The model achieved 95.3 percent validity [1].\nReferences\n[1] Jindal and Ju. Small Molecular Grammar. arXiv:2605.06322v2.`;
const ref = {
  id: "R1",
  label: "[1]",
  title: "Small Molecular Grammar",
  bibliography:
    "[1] Jindal and Ju. Small Molecular Grammar. arXiv:2605.06322v2.",
  arxiv: "2605.06322v2",
};
const claim = {
  id: "C1",
  text: "The model achieved 95.3 percent validity [1].",
  referenceIds: ["R1"],
};
const inventory = { references: [ref], claims: [claim], warnings: [] };
const source = {
  status: "available",
  title: ref.title,
  pages: [{ page: 3, text: quote }],
  sha256: "hash",
  sourceUrl: "https://arxiv.org/pdf/2605.06322v2",
  warnings: [],
};
const proposed = {
  assessments: [
    {
      referenceId: "R1",
      status: "supported",
      explanation: "The reported result matches.",
      evidence: [{ quote, page: 3 }],
    },
  ],
  combined: {
    status: "supported",
    explanation: "The source supports the reported number.",
  },
};
const packet = { ...source, referenceId: "R1", passages: source.pages };

function pdfBytes() {
  const stream =
    "BT /F1 12 Tf 30 700 Td (arXiv:2605.06322v2 The model achieved 95.3 percent validity.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
      .join("");
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test("inventory anchors claims and references to manuscript and rejects missing mappings", () => {
  assert.equal(
    validateInventory(inventory, { text: manuscript }).claims.length,
    1,
  );
  assert.throws(() =>
    validateInventory(
      {
        ...inventory,
        claims: [{ ...claim, text: "This invented passage is absent." }],
      },
      { text: manuscript },
    ),
  );
  assert.throws(() =>
    validateInventory(
      {
        ...inventory,
        references: [{ ...ref, bibliography: "Made up reference" }],
      },
      { text: manuscript },
    ),
  );
  assert.throws(() =>
    validateInventory(
      { ...inventory, claims: [{ ...claim, referenceIds: ["missing"] }] },
      { text: manuscript },
    ),
  );
});
test("assessment rejects hallucinated quotes, wrong pages and unavailable sources", () => {
  assert.equal(
    validateAssessment(proposed, claim, [packet]).combined.status,
    "supported",
  );
  for (const evidence of [
    [{ quote: "A fabricated source quote here.", page: 3 }],
    [{ quote, page: 8 }],
    [],
  ]) {
    const value = structuredClone(proposed);
    value.assessments[0].evidence = evidence;
    assert.equal(
      validateAssessment(value, claim, [packet]).assessments[0].status,
      "insufficient_evidence",
    );
  }
  assert.equal(
    validateAssessment(proposed, claim, [
      { ...packet, status: "unavailable", warnings: ["No PDF."] },
    ]).combined.status,
    "insufficient_evidence",
  );
  assert.throws(() =>
    validateAssessment(
      {
        ...proposed,
        assessments: [{ ...proposed.assessments[0], referenceId: "R99" }],
      },
      claim,
      [packet],
    ),
  );
});
test("combined support is conservative when one citation is missing or conflicting", () => {
  const c = { ...claim, referenceIds: ["R1", "R2"] };
  const packets = [packet, { ...packet, referenceId: "R2" }];
  assert.equal(
    validateAssessment(proposed, c, packets).combined.status,
    "insufficient_evidence",
  );
  const value = {
    ...proposed,
    assessments: [
      proposed.assessments[0],
      { ...proposed.assessments[0], referenceId: "R2", status: "contradicted" },
    ],
  };
  assert.equal(
    validateAssessment(value, c, packets).combined.status,
    "partially_supported",
  );
});
test("passage selection finds relevant pages beyond the beginning without fabricating locators", () => {
  const result = selectPassages(
    {
      ...source,
      pages: [{ page: 1, text: "Unrelated introduction" }, ...source.pages],
    },
    claim.text,
  );
  assert.equal(result[0].page, 3);
  assert.equal(result[0].text, quote);
});
test("service expands citations and assesses their evidence with injected model and source reader", async () => {
  let calls = 0;
  const service = createAuditService({
    model: {
      configured: true,
      model: "test",
      json: async () => (++calls === 1 ? inventory : proposed),
    },
    sources: { resolve: async () => source, collections: async () => [] },
  });
  const parsed = await service.extract({ text: manuscript });
  assert.equal(parsed.references.length, 1);
  const checked = await service.check({
    claim: parsed.claims[0],
    references: parsed.references,
  });
  assert.equal(checked.combined.status, "supported");
  assert.equal(checked.assessments[0].evidence[0].sourceSha256, "hash");
  assert.equal(calls, 2);
});
test("service reports missing full text without asking the model to guess", async () => {
  const service = createAuditService({
    model: {
      json: () => {
        throw Error("Must not run");
      },
    },
    sources: {
      resolve: async () => ({
        status: "unavailable",
        warnings: ["Missing PDF"],
      }),
    },
  });
  const r = await service.check({ claim, references: [ref] });
  assert.equal(r.combined.status, "insufficient_evidence");
});
test("document parsing handles PDF bytes and enforces manuscript limits", async () => {
  const pdf = await extractPdf(pdfBytes());
  assert.equal(pdf.pageCount, 1);
  assert.match(pdf.pages[0].text, /95.3 percent/);
  const extracted = await readManuscript({
    file: { name: "paper.pdf", base64: pdfBytes().toString("base64") },
  });
  assert.match(extracted.text, /arXiv/);
  await assert.rejects(
    () => readManuscript({ text: "a".repeat(100001) }),
    /exceeds/,
  );
  await assert.rejects(
    () => readManuscript({ file: { name: "file.exe", base64: "YWJj" } }),
    /Supported files/,
  );
});
test("arXiv URL forms and source identity use exact identifiers/title, not loose matches", () => {
  for (const value of [
    "2605.06322v2",
    "http://arxiv.org/pdf/2605.06322v2",
    "https://arxiv.org/abs/2605.06322v2",
    "10.48550/arXiv.2605.06322v2",
  ])
    assert.equal(arxivId(value), "2605.06322v2");
  assert.equal(
    matchReference(ref, [
      {
        data: {
          title: "Small Molecular Grammar",
          url: "http://arxiv.org/abs/2605.06322",
        },
      },
    ]).length,
    1,
  );
  assert.equal(
    matchReference(ref, [
      {
        data: {
          title: "Small Molecular Grammar",
          url: "http://arxiv.org/abs/2605.09999",
        },
      },
    ]).length,
    0,
  );
  assert.equal(
    matchReference({ title: "Small Molecular Grammar" }, [
      { data: { title: "A related molecular grammar" } },
    ]).length,
    0,
  );
});
test("collection lookup paginates and duplicate sources stay ambiguous", async () => {
  let calls = 0;
  const sources = createAuditSources({
    mode: "local",
    fetchImpl: async (url) => {
      calls++;
      const start = new URL(url).searchParams.get("start");
      const items =
        start === "0"
          ? Array.from({ length: 100 }, (_, i) => ({
              key: "X" + i,
              data: { itemType: "book", title: i < 2 ? ref.title : "Other" },
            }))
          : [];
      return Response.json(items);
    },
  });
  const r = await sources.resolve({ title: ref.title }, "JZPG5AHC");
  assert.equal(r.status, "ambiguous");
  assert.equal(calls, 2);
});
test("public retrieval refuses a PDF whose version differs from cited version", async () => {
  const sources = createAuditSources({
    mode: "web",
    fetchImpl: async () => new Response(pdfBytes()),
  });
  const result = await sources.resolve({ ...ref, arxiv: "2605.06322v1" });
  assert.equal(result.status, "unavailable");
  assert.match(result.warnings.join(" "), /version/);
});
test("model adapter fails clearly without credentials and rejects truncated output", async () => {
  const absent = createAuditModel({ apiKey: "", model: "" });
  await assert.rejects(() => absent.json("test", {}), /Set ANTHROPIC/);
  const truncated = createAuditModel({
    apiKey: "test",
    model: "test",
    fetchImpl: async () => Response.json({ stop_reason: "max_tokens" }),
  });
  await assert.rejects(() => truncated.json("test", {}), /limit/);
});
test("local library access rejects remote peers, DNS rebinding hosts and foreign origins", () => {
  const req = {
    socket: { remoteAddress: "127.0.0.1" },
    headers: { host: "localhost:3001" },
  };
  requireAuditAccess(req);
  assert.throws(() =>
    requireAuditAccess({ ...req, socket: { remoteAddress: "10.0.0.1" } }),
  );
  assert.throws(() =>
    requireAuditAccess({ ...req, headers: { host: "attacker.example" } }),
  );
  assert.throws(() =>
    requireAuditAccess({
      ...req,
      headers: { host: "localhost:3001", origin: "https://attacker.example" },
    }),
  );
});
test("HTTP audit routes run extraction and checking, reject cross-origin access", async (t) => {
  const service = createAuditService({
    model: {
      configured: true,
      model: "test",
      json: async (system) =>
        system.startsWith("Extract") ? inventory : proposed,
    },
    sources: {
      mode: "local",
      collections: async () => [],
      resolve: async () => source,
    },
  });
  const server = createApp({
    auditService: service,
    serveFrontend: false,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = await fetch(base + "/api/audit/status");
  assert.equal(status.status, 200);
  const extract = await fetch(base + "/api/audit/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: manuscript }),
  });
  assert.equal(extract.status, 200);
  const parsed = await extract.json();
  const check = await fetch(base + "/api/audit/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      claim: parsed.claims[0],
      references: parsed.references,
    }),
  });
  assert.equal(check.status, 200);
  assert.equal((await check.json()).combined.status, "supported");
  const forbidden = await fetch(base + "/api/audit/status", {
    headers: { origin: "https://attacker.example" },
  });
  assert.equal(forbidden.status, 401);
});

test("arXiv manuscript input fetches only the fixed public host and obeys size limits", async () => {
  let requested;
  const parsed = await readManuscript(
    { arxiv: "https://arxiv.org/abs/2605.06322v2" },
    {
      fetchImpl: async (url) => {
        requested = url;
        return new Response(pdfBytes());
      },
    },
  );
  assert.equal(requested, "https://arxiv.org/pdf/2605.06322v2");
  assert.match(parsed.text, /95.3 percent/);
  await assert.rejects(
    () => readManuscript({ arxiv: "http://127.0.0.1/private" }),
    /arXiv/,
  );
  await assert.rejects(
    () =>
      readManuscript(
        { arxiv: "2605.06322v2" },
        {
          fetchImpl: async () =>
            new Response(Buffer.alloc(3 * 1024 * 1024 + 1)),
        },
      ),
    /exceeds/,
  );
});

test("explicit source identifiers never degrade to title-only matches", () => {
  assert.equal(
    matchReference({ title: ref.title, doi: "10.1234/specific" }, [
      { data: { title: ref.title } },
    ]).length,
    0,
  );
  assert.equal(
    matchReference({ title: ref.title, arxiv: "2605.06322v2" }, [
      { data: { title: ref.title } },
    ]).length,
    0,
  );
});

test("a single title match without author/year evidence remains unverified", async () => {
  const sources = createAuditSources({
    mode: "local",
    fetchImpl: async () =>
      Response.json([
        {
          key: "ABCDEFGH",
          data: {
            itemType: "book",
            title: ref.title,
            creators: [{ lastName: "Someone Else" }],
            date: "2025",
          },
        },
      ]),
  });
  const result = await sources.resolve(
    { title: ref.title, bibliography: "Jindal and Ju, 2026." },
    "JZPG5AHC",
  );
  assert.equal(result.status, "unavailable");
  assert.match(result.warnings.join(" "), /author and year/);
});
