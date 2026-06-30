export const REVIEW_MIN_PAPERS = 2;
export const REVIEW_MAX_PAPERS = 10;

export function createInitialReviewDraftState() {
  return {
    status: "idle",
    stale: false,
    errorMessage: "",
    payload: null,
  };
}

export function getReviewGenerationGate(reviewCount, { minPapers = REVIEW_MIN_PAPERS, maxPapers = REVIEW_MAX_PAPERS } = {}) {
  const count = Number(reviewCount) || 0;
  if (count < minPapers) {
    return {
      canGenerate: false,
      reason: `Add at least ${minPapers} papers to the review cart to generate a review.`,
    };
  }
  if (count > maxPapers) {
    return {
      canGenerate: false,
      reason: `Review generation is limited to ${maxPapers} papers. Narrow the review cart and try again.`,
    };
  }
  return {
    canGenerate: true,
    reason: "",
  };
}

export function markReviewDraftStale(state) {
  if (!state?.payload) {
    return {
      ...(state || createInitialReviewDraftState()),
      stale: false,
    };
  }
  return {
    ...state,
    stale: true,
  };
}
