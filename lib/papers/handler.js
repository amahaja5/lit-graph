import { parsePaperRequest } from './request.js';
import { sendError } from '../http/errors.js';

// Hosts supply route parameters explicitly; domain code never reads framework query conventions.
export function createPaperHandler(kind, { client, resolver, logger } = {}) {
  const methods = { paper: 'getPaper', citations: 'getCitations', references: 'getReferences' };
  if (!methods[kind]) throw new Error(`Unknown paper operation: ${kind}`);
  return async (req, res, rawPaperId, rawQuery) => {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Method not allowed' } });
    }
    try {
      const request = parsePaperRequest(kind, rawPaperId, rawQuery);
      const paperId = kind === 'paper' ? await resolver.resolveSeedPaperId(request.paperId) : request.paperId;
      res.json(await client[methods[kind]](paperId, request.query));
    } catch (error) {
      if (!error.status || error.status >= 500) logger?.error('Paper request failed', { code: error.code || 'internal_error' });
      sendError(res, error);
    }
  };
}
