// Turns per-passage TypeSafe relation judgments into the audit's per-source and combined verdicts.
// Evidence quotes are the judged passages themselves, so a quote can never be invented.
const LABELS = { supported: 'Supported', partially_supported: 'Partially supported', contradicted: 'Contradicted', insufficient_evidence: 'Insufficient evidence' };
const QUOTE_CHARS = 1500;
const pages = items => [...new Set(items.map(i => i.page))].sort((a, b) => a - b).join(', ');

function quoteOf(text) {
  if (text.length <= QUOTE_CHARS) return text;
  const cut = text.slice(0, QUOTE_CHARS);
  return cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : QUOTE_CHARS);
}

export function sourceVerdict(referenceId, passages, scores, minConfidence) {
  const judged = scores.map(s => ({ ...s, passage: passages[Number(String(s.id).slice(1)) - 1] })).filter(s => s.passage && LABELS[s.choice]);
  const confident = judged.filter(s => s.confidence >= minConfidence).sort((a, b) => b.confidence - a.confidence);
  const of = label => confident.filter(s => s.choice === label);
  const supported = of('supported'), contradicted = of('contradicted'), partial = of('partially_supported');
  let status, used, summary;
  if (supported.length && contradicted.length) {
    status = 'partially_supported'; used = [...supported.slice(0, 2), ...contradicted.slice(0, 2)];
    summary = `Mixed evidence: some passages support the claim and others contradict it (pages ${pages(used.map(u => u.passage))}).`;
  } else if (supported.length) {
    status = 'supported'; used = supported.slice(0, 3);
    summary = `Supported by ${supported.length} passage${supported.length === 1 ? '' : 's'} (page${supported.length === 1 ? '' : 's'} ${pages(supported.map(s => s.passage))}).`;
  } else if (contradicted.length) {
    status = 'contradicted'; used = contradicted.slice(0, 3);
    summary = `Contradicted by ${contradicted.length} passage${contradicted.length === 1 ? '' : 's'} (page${contradicted.length === 1 ? '' : 's'} ${pages(contradicted.map(s => s.passage))}).`;
  } else if (partial.length) {
    status = 'partially_supported'; used = partial.slice(0, 3);
    summary = `The source supports only part of the claim, or a narrower version of it (page${partial.length === 1 ? '' : 's'} ${pages(partial.map(s => s.passage))}).`;
  } else {
    status = 'insufficient_evidence'; used = [];
    const lean = judged.filter(s => s.choice !== 'insufficient_evidence').sort((a, b) => b.confidence - a.confidence)[0];
    summary = `No retrieved passage clearly supports or contradicts the claim at confidence ${minConfidence} or higher.` +
      (lean ? ` The closest passage leaned "${LABELS[lean.choice].toLowerCase()}" (confidence ${lean.confidence.toFixed(2)}, page ${lean.passage.page}).` : '');
  }
  const top = used.length ? ` Highest confidence ${Math.max(...used.map(u => u.confidence)).toFixed(2)}.` : '';
  return {
    referenceId, status,
    explanation: `${summary}${top} Automated judgement: read the quoted passages before relying on it.`,
    evidence: used.map(u => ({ quote: quoteOf(u.passage.text), page: u.passage.page })),
    suggestedRevision: '',
  };
}

export function combinedVerdict(assessments) {
  const statuses = assessments.map(a => a.status);
  if (statuses.length && statuses.every(s => s === 'supported')) return { status: 'supported', explanation: 'Every cited source supports the claim.' };
  if (statuses.includes('contradicted') && !statuses.some(s => s === 'supported' || s === 'partially_supported'))
    return { status: 'contradicted', explanation: 'The cited sources contradict the claim.' };
  if (statuses.some(s => s === 'supported' || s === 'partially_supported')) return { status: 'partially_supported', explanation: 'The cited sources support only part of the claim, or disagree. Review each source below.' };
  return { status: 'insufficient_evidence', explanation: 'None of the cited sources clearly supports the claim.' };
}
