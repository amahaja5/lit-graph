import { ProxyHttpError } from '../shared/errors.js';
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

export function validateAssessment(value, claim, packets) {
  if (!Array.isArray(value?.assessments))
    throw invalid("The checker did not return per-source assessments.");
  if (value.assessments.some(a => !a || typeof a !== 'object' || Array.isArray(a))) throw invalid('Invalid assessment record.');
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
