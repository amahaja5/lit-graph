import { badRequest, ProxyHttpError } from "./errors.js";
import { readManuscript, normalizeText } from "./auditDocument.js";
import { createAuditModel } from "./auditModel.js";
import { createAuditSources } from "./auditSources.js";
import { createEvidenceJudgments, createJudgmentBudget } from './evidenceJudgments.js';

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

export function selectPassages(source, claim, maxChars = 14000) {
  return packPassages(buildPassageCandidates(source, claim).sort((a, b) => b.lexical - a.lexical || a.page - b.page), maxChars);
}

export function buildPassageCandidates(source, claim) {
  const words = [
    ...new Set(
      normalizeText(claim)
        .toLowerCase()
        .match(/[\p{L}\p{N}]{4,}/gu) || [],
    ),
  ];
  const candidates = [];
  for (const page of source.pages || []) {
    const text = normalizeText(page.text);
    for (let start = 0; start < text.length; start += 1400) {
      const excerpt = text.slice(start, start + 1800);
      candidates.push({
        id: `P${candidates.length + 1}`,
        page: page.page,
        text: excerpt,
        start,
        end: start + excerpt.length,
        lexical: words.reduce(
          (sum, w) => sum + (excerpt.toLowerCase().includes(w) ? 1 : 0),
          0,
        ),
      });
    }
  }
  return candidates;
}

export function packPassages(candidates, maxChars = 14000, { deduplicate = false, includeOffsets = false } = {}) {
  const selected = [];
  let total = 0;
  for (const c of candidates) {
    let spans = [{ start: c.start, end: c.end }];
    if (deduplicate) for (const previous of selected.filter(p => p.page === c.page)) {
      spans = spans.flatMap(s => {
        if (previous.end <= s.start || previous.start >= s.end) return [s];
        return [{ start: s.start, end: Math.min(s.end, previous.start) }, { start: Math.max(s.start, previous.end), end: s.end }].filter(p => p.end > p.start);
      });
    }
    for (const span of spans) {
      const text = deduplicate ? c.text.slice(span.start - c.start, span.end - c.start) : c.text;
      if (total + text.length > maxChars) continue;
      selected.push({ ...c, ...span, text });
      total += text.length;
      if (selected.length >= 8) break;
    }
    if (selected.length >= 8) break;
  }
  return selected.map(({ id, page, text, start, end }) => includeOffsets ? { id, page, text, start, end } : { page, text });
}

export function validateAssessment(value, claim, packets) {
  if (!Array.isArray(value?.assessments))
    throw invalid("The model did not return per-source assessments.");
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

export function createAuditService({
  model = createAuditModel(),
  sources = createAuditSources(),
  judgments = createEvidenceJudgments(),
} = {}) {
  return {
    async status() {
      let collections = [],
        zoteroError = "";
      try {
        collections = await sources.collections();
      } catch (e) {
        zoteroError = e.message;
      }
      return {
        modelConfigured: model.configured,
        model: model.model || "",
        zoteroMode: sources.mode,
        collections,
        zoteroError,
        typesafe: judgments.status,
      };
    },
    async extract(body) {
      if (!model.configured)
        throw new ProxyHttpError({
          code: "audit_not_configured",
          status: 503,
          message:
            "Set ANTHROPIC_API_KEY and ANTHROPIC_MODEL on the server before extracting citations.",
        });
      const manuscript = await readManuscript(body);
      const extracted = await model.json(
        `Extract all citation-bearing passages and the bibliography from the manuscript. Do not judge claims yet. Include numbered, author-year, and footnote citations. Preserve each passage and bibliography entry VERBATIM (whitespace differences allowed). Each passage includes its citation marker and enough context to assess its claim. Map every cited source to a stable reference ID. For a missing bibliography entry create a reference with blank bibliography/title and its citation label. Preserve arXiv versions. Include uncited bibliography entries too. Return {references:[{id,label,title,bibliography,doi,arxiv}],claims:[{text,marker,referenceIds:[]}],warnings:[]}. Never silently omit citations to meet a limit. Limits: 80 references, 150 passages.`,
        { manuscript: manuscript.text },
      );
      return {
        schemaVersion: 1,
        manuscript: {
          filename: manuscript.filename,
          sha256: manuscript.sha256,
          pages: manuscript.pages,
        },
        ...validateInventory(extracted, manuscript),
      };
    },
    async check(body, { signal } = {}) {
      const budget = createJudgmentBudget(signal);
      const claim = body?.claim;
      const refs = body?.references;
      if (
        !claim ||
        typeof claim.id !== "string" ||
        typeof claim.text !== "string" ||
        claim.text.length < 10 ||
        claim.text.length > 5000 ||
        !Array.isArray(claim.referenceIds) ||
        !Array.isArray(refs)
      )
        throw badRequest(
          "A cited passage and reference inventory are required.",
        );
      if (refs.length > 80 || claim.referenceIds.length > 8)
        throw badRequest(
          "Audit at most 8 sources per passage and 80 references per inventory.",
        );
      const ids = new Set(refs.map((r) => r.id));
      if (
        ids.size !== refs.length ||
        claim.referenceIds.some((id) => !ids.has(id))
      )
        throw badRequest("Reference identifiers are missing or duplicated.");
      for (const ref of refs)
        if (
          !ref ||
          typeof ref.id !== "string" ||
          JSON.stringify(ref).length > 8000
        )
          throw badRequest("Invalid reference record.");
      const collectionKey = string(body.collectionKey, 20);
      if (collectionKey && !/^[A-Z0-9]{8}$/.test(collectionKey))
        throw badRequest("Invalid collection key.");
      const packets = [];
      for (const id of [...new Set(claim.referenceIds)]) {
        signal?.throwIfAborted();
        const reference = refs.find((r) => r.id === id);
        const source = await sources.resolve(reference, collectionKey);
        const candidates = buildPassageCandidates(source, claim.text);
        const selection = source.status === 'available' && judgments.auditMode !== 'off'
          ? await judgments.rankPassages({ candidates, claim: claim.text, sourceHash: source.sha256, budget })
          : { diagnostics: { mode: judgments.auditMode, status: 'disabled' }, warnings: [] };
        const semantic = judgments.auditMode === 'on' && Boolean(selection.ranked);
        const chosen = packPassages(semantic ? selection.ranked : candidates.sort((a, b) => b.lexical - a.lexical || a.page - b.page), 14000, { deduplicate: semantic, includeOffsets: true });
        const passages = chosen.map(({ page, text }) => ({ page, text }));
        packets.push({
          ...source,
          referenceId: id,
          passages,
          selection: { ...selection.diagnostics, selectedSpans: chosen.map(({ id, page, start, end }) => ({ id, page, start, end })), offsetBasis: 'Whitespace-normalized PDF page text' },
          pages: undefined,
          warnings: [
            ...(source.warnings || []),
            ...selection.warnings,
            ...(source.emptyPages?.length
              ? [
                  "Some source pages have no extracted text; OCR/visual review may be needed.",
                ]
              : []),
          ],
        });
      }
      if (!packets.some((p) => p.status === "available" && p.passages.length))
        return validateAssessment({ assessments: [] }, claim, packets);
      signal?.throwIfAborted();
      const proposed = await model.json(
        `Audit this manuscript passage against each cited source and then their combined support. Assess the actual claim, qualifiers, numbers and experimental scope. Status: supported, partially_supported, contradicted, insufficient_evidence. Absence from excerpts is insufficient evidence, never contradiction. Sources are retrieved excerpts, not necessarily complete text. Each non-insufficient verdict MUST include exact source quotes and the supplied PDF page numbers. Do not infer printed pagination. Do not silently correct the manuscript. Suggest a minimal revision only when supported. Distinguish a source reporting an experiment from proving scientific truth. Return {assessments:[{referenceId,status,explanation,evidence:[{quote,page}],suggestedRevision}],combined:{status,explanation}}. Include every reference ID.`,
        { claim, sources: packets.map(({ selection, ...packet }) => packet) },
      );
      return {
        ...validateAssessment(proposed, claim, packets),
        model: model.model,
        checkedAt: new Date().toISOString(),
      };
    },
  };
}
