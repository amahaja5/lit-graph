export const EXPANSION_MODE_RELEVANCE = "relevance";
export const EXPANSION_MODE_LESSER_KNOWN_SAMPLE = "lesser_known_sample";

export function rankCandidates(candidates) {
  return [...candidates].sort(compareCandidates);
}

export function selectTopCandidates(candidates, topN) {
  return rankCandidates(candidates).slice(0, Math.max(0, topN));
}

export function selectCandidatesForMode(candidates, topN, { mode = EXPANSION_MODE_RELEVANCE, rng = Math.random } = {}) {
  const limit = Math.max(0, Number(topN) || 0);
  if (limit === 0) return [];

  if (mode === EXPANSION_MODE_LESSER_KNOWN_SAMPLE) {
    return selectLesserKnownSample(candidates, limit, { rng });
  }

  return selectTopCandidates(candidates, limit);
}

export function getExpansionModeLabel(mode) {
  if (mode === EXPANSION_MODE_LESSER_KNOWN_SAMPLE) return "Lesser-known sample";
  return "Top relevance";
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

function selectLesserKnownSample(candidates, topN, { rng = Math.random } = {}) {
  const ranked = rankCandidates(candidates);
  if (ranked.length <= topN) {
    return weightedSampleWithoutReplacement(ranked, ranked.length, lesserKnownWeight, rng);
  }

  // Skip the most relevance-dominant head when we have enough data so the mode
  // genuinely explores the long tail instead of reproducing top relevance.
  const headExclusion = ranked.length >= topN * 2 ? Math.min(10, Math.floor(ranked.length * 0.2)) : 0;
  const tailPool = ranked.slice(headExclusion);
  const sample = weightedSampleWithoutReplacement(tailPool, Math.min(topN, tailPool.length), lesserKnownWeight, rng);

  if (sample.length >= topN) return sample;

  const selectedIds = new Set(sample.map((item) => item?.targetPaper?.paperId));
  const fallbackPool = ranked.filter((item) => !selectedIds.has(item?.targetPaper?.paperId));
  const fallback = weightedSampleWithoutReplacement(fallbackPool, topN - sample.length, lesserKnownWeight, rng);
  return [...sample, ...fallback];
}

function weightedSampleWithoutReplacement(items, count, weightFn, rng) {
  const remaining = [...items];
  const selected = [];
  const targetCount = Math.min(Math.max(0, count), remaining.length);

  for (let i = 0; i < targetCount; i += 1) {
    const weights = remaining.map((item) => sanitizeWeight(weightFn(item)));
    const total = weights.reduce((sum, value) => sum + value, 0);

    let index = 0;
    if (total > 0) {
      let threshold = clampRandom(rng()) * total;
      for (let j = 0; j < remaining.length; j += 1) {
        threshold -= weights[j];
        if (threshold <= 0) {
          index = j;
          break;
        }
      }
    } else {
      index = Math.floor(clampRandom(rng()) * remaining.length);
      if (index >= remaining.length) index = remaining.length - 1;
    }

    selected.push(remaining.splice(index, 1)[0]);
  }

  return selected;
}

function lesserKnownWeight(candidate) {
  const citations = Math.max(0, toRankNumber(candidate?.targetPaper?.citationCount));
  const influentialCitations = Math.max(0, toRankNumber(candidate?.targetPaper?.influentialCitationCount));
  const isInfluential = Boolean(candidate?.isInfluential);
  const hasYear = Number.isInteger(candidate?.targetPaper?.year);

  const citationFactor = 1 / Math.sqrt(citations + 1);
  const influentialFactor = 1 / Math.sqrt(influentialCitations + 1);
  const influenceBias = isInfluential ? 0.65 : 1.45;
  const yearBias = hasYear ? 1 : 1.08;

  return Math.max(1e-6, citationFactor * influentialFactor * influenceBias * yearBias);
}

function sanitizeWeight(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num;
}

function clampRandom(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.5;
  if (num <= 0) return 0;
  if (num >= 1) return 0.999999999;
  return num;
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
