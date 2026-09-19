import test from "node:test";
import assert from "node:assert/strict";
import {
  auditSummary,
  buildAuditExport,
  auditMarkdown,
} from "../../frontend/src/auditState.js";

test("partial audit exports account for all checked, failed and pending passages", () => {
  const inventory = {
    manuscript: { filename: "test.docx" },
    references: [],
    claims: [
      { id: "C1", text: "Claim 1" },
      { id: "C2", text: "Claim 2" },
      { id: "C3", text: "Claim 3" },
    ],
    warnings: [],
    coverageNotice: "Review inventory.",
  };
  const results = {
    C1: {
      combined: { status: "supported", explanation: "Evidence" },
      assessments: [],
    },
    C2: { error: "Provider unavailable" },
  };
  assert.deepEqual(auditSummary(inventory, results), {
    total: 3,
    checked: 1,
    pending: 1,
    errors: 1,
    supported: 1,
    partially_supported: 0,
    contradicted: 0,
    insufficient_evidence: 0,
  });
  const report = buildAuditExport(inventory, results);
  assert.equal(report.claims.length, 3);
  const md = auditMarkdown(report);
  assert.match(md, /1 of 3/);
  assert.match(md, /Provider unavailable/);
  assert.match(md, /Not checked/);
});
