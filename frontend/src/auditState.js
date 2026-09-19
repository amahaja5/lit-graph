export const AUDIT_LABELS = {
  supported: "Supported",
  partially_supported: "Partially supported",
  contradicted: "Contradicted",
  insufficient_evidence: "Insufficient evidence",
};
export function auditSummary(inventory, results) {
  const claims = inventory?.claims || [];
  const summary = {
    total: claims.length,
    checked: 0,
    pending: 0,
    errors: 0,
    supported: 0,
    partially_supported: 0,
    contradicted: 0,
    insufficient_evidence: 0,
  };
  for (const c of claims) {
    const r = results[c.id];
    if (!r) summary.pending++;
    else if (r.error) summary.errors++;
    else {
      summary.checked++;
      summary[r.combined.status]++;
    }
  }
  return summary;
}
export function buildAuditExport(inventory, results) {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    manuscript: inventory.manuscript,
    scope:
      "Directly cited sources; AI-assisted claim support review from retrieved excerpts. PDF page indices are not verified printed page numbers. Scientific experiments are not independently validated.",
    inventoryNotice: inventory.coverageNotice,
    warnings: inventory.warnings,
    references: inventory.references,
    summary: auditSummary(inventory, results),
    claims: inventory.claims.map((c) => ({
      ...c,
      result: results[c.id] || { status: "pending" },
    })),
  };
}
export function auditMarkdown(report) {
  const lines = [
    "# Manuscript citation audit",
    "",
    report.manuscript.filename,
    "",
    report.scope,
    "",
    report.inventoryNotice,
    "",
    `Checked ${report.summary.checked} of ${report.summary.total} passages; ${report.summary.pending} pending; ${report.summary.errors} failed.`,
    "",
  ];
  for (const c of report.claims) {
    lines.push(`## ${c.id}`, "", c.text, "");
    if (c.result.error || c.result.status === "pending") {
      lines.push(c.result.error || "Not checked.", "");
      continue;
    }
    lines.push(
      `**${AUDIT_LABELS[c.result.combined.status]}**`,
      c.result.combined.explanation,
      "",
    );
    for (const a of c.result.assessments) {
      lines.push(
        `### ${a.referenceId}: ${a.source.title || "Unresolved source"}`,
        "",
        AUDIT_LABELS[a.status],
        a.explanation,
        "",
      );
      for (const e of a.evidence)
        lines.push(
          `> ${e.quote}`,
          "",
          `PDF page ${e.page}. ${e.sourceUrl || ""}`,
          "",
        );
      if (a.suggestedRevision)
        lines.push(`Suggested revision: ${a.suggestedRevision}`, "");
      if (a.source.selection && a.source.selection.mode !== 'off') {
        lines.push(`Evidence selection: ${a.source.selection.mode} / ${a.source.selection.status}.`, '');
      }
      for (const warning of a.source.warnings || []) lines.push(`Source limitation: ${warning}`, '');
    }
  }
  return lines.join("\n");
}
