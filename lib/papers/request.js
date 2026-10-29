import { badRequest } from '../shared/errors.js';

const QUERIES = {
  paper: new Set(['fields']),
  citations: new Set(['fields', 'limit', 'offset', 'publicationDateOrYear']),
  references: new Set(['fields', 'limit', 'offset']),
};

export function parsePaperRequest(kind, rawPaperId, rawQuery) {
  if (Array.isArray(rawPaperId) && rawPaperId.length === 1) rawPaperId = rawPaperId[0];
  if (typeof rawPaperId !== 'string' || !rawPaperId.trim()) throw badRequest('paperId must be a non-empty string');
  const query = sanitizeQuery(rawQuery, QUERIES[kind]);
  validatePagingQuery(query);
  return { paperId: rawPaperId.trim(), query };
}

export function sanitizeQuery(rawQuery, allowlist) {
  const query = {};
  for (const [key, value] of Object.entries(rawQuery || {})) {
    if (!allowlist?.has(key)) throw badRequest(`Unsupported query parameter: ${key}`);
    if (typeof value !== 'string' && value != null) throw badRequest(`Query parameter must be a single string: ${key}`);
    if (value == null || value === '') continue;
    query[key] = value;
  }
  return query;
}

export function validatePagingQuery(query) {
  for (const [key, min, max] of [['limit', 1, 1000], ['offset', 0, Number.MAX_SAFE_INTEGER]]) {
    if (query[key] == null) continue;
    const value = Number(query[key]);
    if (!/^\d+$/.test(query[key]) || !Number.isSafeInteger(value) || value < min || value > max) {
      throw badRequest(key === 'limit' ? 'limit must be an integer between 1 and 1000' : 'offset must be a non-negative integer');
    }
  }
}
