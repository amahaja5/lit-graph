const normalized = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const doi = value => String(value || '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').replace(/[.,;]+$/, '').toLowerCase();

// Only choose a unique, strongly supported match. Others remain for review.
export function automaticMatch(reference, candidates) {
  const title = normalized(reference.title);
  const bibliography = normalized(reference.bibliography);
  const matches = candidates.map((candidate, index) => {
    const candidateTitle = normalized(candidate.title);
    const titleMatches = candidateTitle.length >= 12 && (title ? title === candidateTitle : bibliography.includes(candidateTitle));
    if (doi(reference.doi)) return doi(reference.doi) === doi(candidate.doi) && titleMatches ? index : -1;
    const year = String(reference.zoteroItem?.date || bibliography).match(/\b(?:18|19|20)\d{2}\b/)?.[0];
    const surname = normalized(candidate.item?.creators?.[0]?.lastName);
    return titleMatches && year && year === String(candidate.year) && surname.length >= 2 && (` ${bibliography} `).includes(` ${surname} `) ? index : -1;
  }).filter(index => index >= 0);
  return matches.length === 1 ? matches[0] : -1;
}
