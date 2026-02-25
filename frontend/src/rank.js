export function rankCandidates(candidates) {
  return [...candidates].sort(compareCandidates);
}

export function selectTopCandidates(candidates, topN) {
  return rankCandidates(candidates).slice(0, Math.max(0, topN));
}

export function compareCandidates(a, b) {
  const influentialDiff = compareNumberDesc(boolToInt(a?.isInfluential), boolToInt(b?.isInfluential));
  if (influentialDiff !== 0) return influentialDiff;

  const infCitationDiff = compareNumberDesc(
    toRankNumber(a?.targetPaper?.influentialCitationCount),
    toRankNumber(b?.targetPaper?.influentialCitationCount),
  );
  if (infCitationDiff !== 0) return infCitationDiff;

  const citationDiff = compareNumberDesc(
    toRankNumber(a?.targetPaper?.citationCount),
    toRankNumber(b?.targetPaper?.citationCount),
  );
  if (citationDiff !== 0) return citationDiff;

  const yearDiff = compareYearDescNullLast(a?.targetPaper?.year, b?.targetPaper?.year);
  if (yearDiff !== 0) return yearDiff;

  return String(a?.targetPaper?.paperId || "").localeCompare(String(b?.targetPaper?.paperId || ""));
}

function boolToInt(value) {
  return value ? 1 : 0;
}

function toRankNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function compareNumberDesc(a, b) {
  return b - a;
}

function compareYearDescNullLast(a, b) {
  const aValid = Number.isInteger(a);
  const bValid = Number.isInteger(b);
  if (aValid && bValid) return b - a;
  if (aValid && !bValid) return -1;
  if (!aValid && bValid) return 1;
  return 0;
}
