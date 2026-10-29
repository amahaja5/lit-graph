import { badRequest, ProxyHttpError } from '../shared/errors.js';
import { normalizeText } from '../documents/auditDocument.js';

const outcomes = new Set([
  "supported",
  "partially_supported",
  "contradicted",
  "insufficient_evidence",
]);
const string = (value, max = 2000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const invalid = (message) =>
  new ProxyHttpError({ code: "audit_invalid_response", status: 502, message });

export function validateInventory(value, manuscript) {
  if (!Array.isArray(value?.references) || !Array.isArray(value?.claims))
    throw invalid(
      "Could not extract a citation inventory. Retry with the bibliography included.",
    );
  if (value.references.length > 80 || value.claims.length > 150)
    throw badRequest(
      "This manuscript exceeds 80 references or 150 cited passages. Audit a section with its bibliography.",
    );
  if (value.references.some(r => !r || typeof r !== 'object' || Array.isArray(r)) ||
      value.claims.some(c => !c || typeof c !== 'object' || Array.isArray(c))) {
    throw invalid('Invalid reference or claim record in model response.');
  }
  const text = normalizeText(manuscript.text);
  const references = value.references.map((r, i) => ({
    id: string(r.id, 40),
    label: string(r.label, 150) || `Reference ${i + 1}`,
    title: string(r.title, 500),
    bibliography: string(r.bibliography, 4000),
    doi: string(r.doi, 200),
    arxiv: string(r.arxiv, 100),
  }));
  const ids = new Set(references.map((r) => r.id));
  if (ids.size !== references.length || references.some((r) => !r.id))
    throw invalid("Duplicate or missing reference identifiers.");
  for (const ref of references) {
    if (ref.bibliography && !text.includes(normalizeText(ref.bibliography)))
      throw invalid(
        "An extracted bibliography entry could not be located in the manuscript. Retry with plain text.",
      );
  }
  const claims = value.claims.map((c, i) => {
    if (
      typeof c.text !== "string" ||
      c.text.trim().length < 10 ||
      c.text.length > 5000 ||
      !text.includes(normalizeText(c.text))
    )
      throw invalid(
        "An extracted cited passage could not be located in the manuscript.",
      );
    if (
      !Array.isArray(c.referenceIds) ||
      c.referenceIds.some((id) => !ids.has(id))
    )
      throw invalid(
        "A citation could not be mapped to the extracted reference list.",
      );
    const referenceIds = [...new Set(c.referenceIds)];
    return {
      id: `C${i + 1}`,
      text: c.text.trim(),
      marker: string(c.marker, 300),
      referenceIds,
    };
  });
  return {
    references,
    claims,
    warnings: (Array.isArray(value.warnings) ? value.warnings : []).map((w) =>
      string(w, 1000),
    ),
    coverageNotice:
      "This is an AI-extracted inventory. Review it for missed or incorrectly mapped citations before auditing.",
  };
}

export function validateAssessment(value, claim, packets) {
  if (!Array.isArray(value?.assessments))
    throw invalid("The model did not return per-source assessments.");
  if (value.assessments.some(a => !a || typeof a !== 'object' || Array.isArray(a))) throw invalid('Invalid assessment record in model response.');
  const byId = new Map(value.assessments.map((a) => [a.referenceId, a]));
  if (
    byId.size !== value.assessments.length ||
    value.assessments.some((a) => !claim.referenceIds.includes(a.referenceId))
  )
    throw invalid("Unexpected source identifiers in assessment.");
  const assessments = packets.map((packet) => {
    const proposed = byId.get(packet.referenceId);
    const evidence = [];
    for (const e of Array.isArray(proposed?.evidence)
      ? proposed.evidence
      : []) {
      if (!e || typeof e !== 'object') continue;
      const quote = string(e.quote, 2000);
      if (
        quote.length >= 15 &&
        Number.isInteger(e.page) &&
        packet.passages.some(
          (p) =>
            p.page === e.page &&
            normalizeText(p.text).includes(normalizeText(quote)),
        )
      ) {
        evidence.push({
          quote,
          page: e.page,
          sourceSha256: packet.sha256,
          sourceUrl: packet.sourceUrl,
          locatorType: "PDF page (printed pagination not verified)",
        });
      }
    }
    let status = outcomes.has(proposed?.status)
      ? proposed.status
      : "insufficient_evidence";
    let explanation =
      string(proposed?.explanation, 4000) ||
      "No reliable assessment was returned.";
    if (packet.status !== "available") {
      status = "insufficient_evidence";
      explanation = packet.warnings.join(" ");
    } else if (status !== "insufficient_evidence" && !evidence.length) {
      status = "insufficient_evidence";
      explanation =
        "The proposed conclusion had no exact, page-bound source passage. It was not accepted.";
    }
    return {
      referenceId: packet.referenceId,
      status,
      explanation,
      evidence,
      suggestedRevision:
        status === "insufficient_evidence"
          ? ""
          : string(proposed?.suggestedRevision, 3000),
      source: {
        title: packet.title,
        status: packet.status,
        sourceUrl: packet.sourceUrl || "",
        retrieval: packet.retrieval || "",
        version: packet.version || "",
        sha256: packet.sha256 || "",
        itemKey: packet.itemKey || "",
        attachmentKey: packet.attachmentKey || "",
        pagesConsidered: [...new Set(packet.passages.map((p) => p.page))],
        warnings: packet.warnings,
        selection: packet.selection,
      },
    };
  });
  let combinedStatus = outcomes.has(value.combined?.status)
    ? value.combined.status
    : "insufficient_evidence";
  let combinedExplanation =
    string(value.combined?.explanation, 4000) ||
    "Review the per-source results.";
  // Missing or rejected evidence prevents claiming complete combined verification.
  if (
    assessments.some((a) => a.status === "insufficient_evidence") ||
    !assessments.length
  ) {
    combinedStatus = "insufficient_evidence";
    combinedExplanation =
      "One or more cited sources remain unverified. Review the individual findings below.";
  } else if (
    combinedStatus === "supported" &&
    assessments.some((a) => a.status === "contradicted")
  ) {
    combinedStatus = "partially_supported";
    combinedExplanation =
      "The cited sources include conflicting evidence. Review the individual findings below.";
  }
  return {
    claimId: claim.id,
    claim: claim.text,
    combined: { status: combinedStatus, explanation: combinedExplanation },
    assessments,
  };
}
