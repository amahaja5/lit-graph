import { parseAuditCheckRequest } from './request.js';
import { buildPassageCandidates, packPassages } from './passages.js';
import { validateAssessment } from './assessment.js';
import { inventoryFromTei } from './teiInventory.js';
import { sourceVerdict, combinedVerdict } from './verdicts.js';
import { ProxyHttpError } from "../shared/errors.js";
import { readManuscript } from "../documents/auditDocument.js";
import { createGrobid } from '../citation-import/grobid.js';
import { createAuditSources } from "./auditSources.js";
import { createEvidenceJudgments, createJudgmentBudget } from '../evidence/evidenceJudgments.js';

// Passages judged per cited source; each is one TypeSafe relation question.
const JUDGED_PASSAGES = 8;
const notConfigured = message => new ProxyHttpError({ code: "audit_not_configured", status: 503, message });

export function createAuditService({
  sources = createAuditSources(),
  judgments = createEvidenceJudgments(),
  grobid = createGrobid(),
  minConfidence = Number(process.env.TYPESAFE_VERDICT_MIN_CONFIDENCE || 0.6),
} = {}) {
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) throw new Error('Invalid TYPESAFE_VERDICT_MIN_CONFIDENCE');
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
        extractionConfigured: grobid.configured,
        checkerConfigured: judgments.configured,
        modelConfigured: grobid.configured && judgments.configured,
        model: judgments.configured ? `TypeSafe ${judgments.model}` : "",
        zoteroMode: sources.mode,
        collections,
        zoteroError,
        typesafe: judgments.status,
      };
    },
    async extract(body) {
      if (!grobid.configured) throw notConfigured("Set GROBID_API_URL and EXTRACTION_API_KEY on the server before extracting citations.");
      const manuscript = await readManuscript(body);
      const tei = await grobid.fulltext({ name: manuscript.filename, base64: manuscript.pdfBase64 });
      return {
        schemaVersion: 1,
        manuscript: {
          filename: manuscript.filename,
          sha256: manuscript.sha256,
          pages: manuscript.pages,
        },
        ...inventoryFromTei(tei),
      };
    },
    async check(body, { signal } = {}) {
      if (!judgments.configured) throw notConfigured("Set TYPESAFE_API_KEY on the server before checking citations.");
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
      const assessments = [];
      for (const packet of packets) {
        if (packet.status !== 'available' || !packet.passages.length) continue;
        signal?.throwIfAborted();
        const judged = packet.passages.slice(0, JUDGED_PASSAGES);
        let result;
        try {
          result = await judgments.judgeClaim({ claim: claim.text, passages: judged, budget: createJudgmentBudget(signal, 30_000) });
        } catch (error) {
          signal?.throwIfAborted();
          if (error instanceof ProxyHttpError) throw error;
          throw new ProxyHttpError({ code: "checker_unavailable", status: 502, message: "TypeSafe could not complete the citation check. Retry this passage." });
        }
        assessments.push(sourceVerdict(packet.referenceId, judged, result.scores, minConfidence));
      }
      return {
        ...validateAssessment({ assessments, combined: combinedVerdict(assessments) }, claim, packets),
        model: `TypeSafe ${judgments.model}`,
        checkedAt: new Date().toISOString(),
      };
    },
  };
}
