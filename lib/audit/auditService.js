import { parseAuditCheckRequest } from './request.js';
import { buildPassageCandidates, packPassages } from './passages.js';
import { validateInventory, validateAssessment } from './assessment.js';
import { ProxyHttpError } from "../shared/errors.js";
import { readManuscript } from "../documents/auditDocument.js";
import { createAuditModel } from "../models/auditModel.js";
import { createAuditSources } from "./auditSources.js";
import { createEvidenceJudgments, createJudgmentBudget } from '../evidence/evidenceJudgments.js';

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
      const { claim, refs, collectionKey } = parseAuditCheckRequest(body);
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
