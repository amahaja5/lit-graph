import { createInitialReviewDraftState, getReviewGenerationGate, markReviewDraftStale } from './reviewDraftState.js';
import { formatErrorMessage } from '../shared/errors.js';

// State is owned here: ready always has a payload, error always has a message,
// and idle/loading never retain a result from a different request.
export function createReviewController({ api, getPaperIds, onChange, setStatus, setError, clearError }) {
  let state = createInitialReviewDraftState();
  let requestId = 0;
  let cartRevision = 0;
  const publish = next => { state = Object.freeze(next); onChange(); };
  return {
    getState: () => state,
    reset() {
      requestId++;
      cartRevision++;
      publish(createInitialReviewDraftState());
    },
    cartChanged() {
      cartRevision++;
      publish(markReviewDraftStale(state));
    },
    async generate() {
      if (state.status === 'loading') return;
      const paperIds = [...getPaperIds()];
      const gate = getReviewGenerationGate(paperIds.length);
      if (!gate.canGenerate) { setError(gate.reason); return; }
      const currentRequest = ++requestId;
      const revision = cartRevision;
      clearError();
      setStatus('Generating structured literature synthesis...');
      publish({ status: 'loading' });
      try {
        const payload = await api.generateReview(paperIds, { mode: 'html', outputShape: 'structured_synthesis' });
        if (currentRequest !== requestId) return;
        if (!payload || !Array.isArray(payload.references)) throw new Error('Invalid review response.');
        publish({ status: 'ready', payload, stale: revision !== cartRevision });
        setStatus(`Review generated from ${payload.references.length} paper(s).`);
      } catch (error) {
        if (currentRequest !== requestId) return;
        publish({ status: 'error', errorMessage: `Could not generate review: ${formatErrorMessage(error)}` });
        setError(formatErrorMessage(error));
        setStatus('');
      }
    },
  };
}
