import { normalizeText } from '../documents/auditDocument.js';

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
