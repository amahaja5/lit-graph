import { badRequest } from '../shared/errors.js';

export function parseObjectBody(body) {
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { throw badRequest('Request body must be valid JSON.'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Request body must be a JSON object.');
  }
  return body;
}
